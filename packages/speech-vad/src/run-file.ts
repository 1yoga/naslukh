import sherpa from "sherpa-onnx-node"
import {
  SAMPLE_RATE_HZ,
  buildSpeechChunks,
  planVadCommit,
} from "../../speech-core/src/index.ts"
import type { SampleRange } from "../../speech-core/src/index.ts"
import {
  commitVad,
  createJob,
  listVadIntervals,
  migrate,
  resumeVadJob,
  setJobState,
} from "../../speech-store/src/index.ts"
import type { SqlDatabase } from "../../speech-store/src/index.ts"
import { SILERO_MODEL_ID } from "./paths.ts"

const WINDOW = 512

export interface VadFileResult {
  jobId: string
  totalSamples: number
  intervals: SampleRange[]
  chunks: ReturnType<typeof buildSpeechChunks>
  commits: number
}

export interface RunVadFileOptions {
  wavPath: string
  modelPath: string
  db: SqlDatabase
  jobId?: string
  /** Продолжить существующее задание с курсора. */
  resume?: boolean
  device?: {
    deviceModel: string
    osName: string
    osVersion: string
  }
}

function createVad(modelPath: string) {
  return new sherpa.Vad(
    {
      sileroVad: {
        model: modelPath,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        windowSize: WINDOW,
        maxSpeechDuration: 20,
      },
      sampleRate: SAMPLE_RATE_HZ,
      debug: false,
      numThreads: 1,
    },
    60,
  )
}

/**
 * Один проход Silero по файлу: интервалы и курсор пишутся в SQLite пакетами.
 * Уже записанные интервалы после resume не пересчитываются.
 */
export function runVadFile(options: RunVadFileOptions): VadFileResult {
  const device = options.device ?? {
    deviceModel: "node-harness",
    osName: "node",
    osVersion: process.versions.node,
  }
  const wave = sherpa.readWave(options.wavPath)
  if (wave.sampleRate !== SAMPLE_RATE_HZ) {
    throw new Error(`Нужен ${SAMPLE_RATE_HZ} Гц, в файле ${wave.sampleRate}`)
  }

  migrate(options.db)
  const jobId = options.jobId ?? `vad-${Date.now()}`

  let job
  if (options.resume) {
    job = resumeVadJob(options.db, jobId, SILERO_MODEL_ID)
  } else {
    createJob(options.db, {
      id: jobId,
      source: "file",
      modelId: SILERO_MODEL_ID,
      modelVersion: SILERO_MODEL_ID,
      audioPath: options.wavPath,
    })
    job = setJobState(options.db, jobId, "recognizing", "resume", device)
  }

  const cursor = job.vadCursorSample
  const vad = createVad(options.modelPath)
  const pending: SampleRange[] = []
  let commits = 0
  let lastCommitted = cursor
  let scanned = cursor

  // Смещение start у sherpa считается от начала потока acceptWaveform.
  const offset = cursor
  const samples = wave.samples.subarray(cursor)

  for (let pos = 0; pos + WINDOW <= samples.length; pos += WINDOW) {
    vad.acceptWaveform(samples.subarray(pos, pos + WINDOW))
    scanned = cursor + pos + WINDOW
    drain(vad, pending, offset)
    const batch = planVadCommit({
      scannedSample: scanned,
      lastCommittedSample: lastCommitted,
      pendingIntervals: pending,
      atEnd: false,
    })
    if (batch && !vad.isDetected()) {
      commitVad(options.db, {
        jobId,
        intervals: batch.intervals.filter((item) => item.endSample > lastCommitted),
        cursorSample: batch.cursorSample,
        device,
      })
      pending.length = 0
      lastCommitted = batch.cursorSample
      commits += 1
    }
  }

  const rem = samples.length % WINDOW
  if (rem > 0) {
    const tail = new Float32Array(WINDOW)
    tail.set(samples.subarray(samples.length - rem))
    vad.acceptWaveform(tail)
  }
  vad.flush()
  scanned = wave.samples.length
  drain(vad, pending, offset)

  const finalBatch = planVadCommit({
    scannedSample: scanned,
    lastCommittedSample: lastCommitted,
    pendingIntervals: pending,
    atEnd: true,
  })
  if (finalBatch) {
    commitVad(options.db, {
      jobId,
      intervals: finalBatch.intervals,
      cursorSample: finalBatch.cursorSample,
      device,
    })
    commits += 1
  }

  const intervals = listVadIntervals(options.db, jobId)
  return {
    jobId,
    totalSamples: wave.samples.length,
    intervals,
    chunks: buildSpeechChunks(intervals, wave.samples.length),
    commits,
  }
}

function drain(
  vad: { isEmpty: () => boolean; front: () => { start: number; samples: Float32Array }; pop: () => void },
  pending: SampleRange[],
  offset: number,
): void {
  while (!vad.isEmpty()) {
    const segment = vad.front()
    vad.pop()
    const startSample = offset + segment.start
    const endSample = startSample + segment.samples.length
    pending.push({ startSample, endSample })
  }
}
