import { freemem } from "node:os"
import sherpa from "sherpa-onnx-node"
import {
  SAMPLE_RATE_HZ,
  assertCanStartRecognition,
  buildSpeechChunks,
  stitchByTokenCenters,
} from "../../speech-core/src/index.ts"
import type { ChunkTranscript } from "../../speech-core/src/index.ts"
import {
  commitSegment,
  createJob,
  getJob,
  listSegments,
  listVadIntervals,
  migrate,
  pendingChunkStart,
  setJobState,
} from "../../speech-store/src/index.ts"
import type { SqlDatabase } from "../../speech-store/src/index.ts"
import { ensureFile } from "../../speech-vad/src/download.ts"
import {
  FIXTURE_WAV_PATH as VAD_FIXTURE,
  SILERO_MODEL_PATH,
  SILERO_MODEL_URL,
} from "../../speech-vad/src/paths.ts"
import { runVadSamples } from "../../speech-vad/src/run-file.ts"
import { GIGAAM_MODEL_ID } from "./paths.ts"
import { createGigaamRecognizer } from "./recognize.ts"

export interface RunAsrSamplesOptions {
  samples: Float32Array
  modelDir: string
  sileroPath: string
  db: SqlDatabase
  jobId?: string
  /** Задание уже создано (например импортом). */
  existingJob?: boolean
  audioPath?: string | null
  freeMemoryBytes?: number
  device?: {
    deviceModel: string
    osName: string
    osVersion: string
  }
}

export type RunAsrFileOptions = Omit<
  RunAsrSamplesOptions,
  "samples" | "existingJob" | "audioPath"
> & {
  wavPath: string
}

export interface AsrFileResult {
  jobId: string
  text: string
  segments: number
  chunks: number
}

/**
 * VAD → куски → GigaAM → сегменты.
 * Вход — PCM 16 кГц (из WAV или декода NSOP).
 */
export function runAsrSamples(options: RunAsrSamplesOptions): AsrFileResult {
  const device = options.device ?? {
    deviceModel: "node-harness",
    osName: "node",
    osVersion: process.versions.node,
  }
  migrate(options.db)
  assertCanStartRecognition(options.freeMemoryBytes ?? freemem())
  const jobId = options.jobId ?? `asr-${Date.now()}`

  if (options.existingJob) {
    const job = getJob(options.db, jobId)
    if (job.state === "queued" || job.state === "sealed" || job.state === "paused") {
      setJobState(options.db, jobId, "recognizing", "resume", device)
    }
  } else {
    createJob(options.db, {
      id: jobId,
      source: "file",
      modelId: GIGAAM_MODEL_ID,
      modelVersion: GIGAAM_MODEL_ID,
      audioPath: options.audioPath ?? null,
    })
    setJobState(options.db, jobId, "recognizing", "resume", device)
  }

  runVadSamples({
    samples: options.samples,
    modelPath: options.sileroPath,
    db: options.db,
    jobId,
    modelId: GIGAAM_MODEL_ID,
    modelVersion: GIGAAM_MODEL_ID,
    resume: true,
    audioPath: options.audioPath ?? null,
    freeMemoryBytes: options.freeMemoryBytes,
    device,
  })

  const intervals = listVadIntervals(options.db, jobId)
  const chunks = buildSpeechChunks(intervals, options.samples.length)
  const fromSample = pendingChunkStart(options.db, jobId)
  const pending = chunks.filter((chunk) => chunk.endSample > fromSample)

  const recognizer = createGigaamRecognizer(options.modelDir)
  const transcripts: ChunkTranscript[] = []
  try {
    for (const chunk of pending) {
      const slice = options.samples.subarray(chunk.startSample, chunk.endSample)
      const transcript = recognizer.decodeChunk(chunk, slice)
      transcripts.push(transcript)
      commitSegment(options.db, {
        jobId,
        startSample: chunk.startSample,
        endSample: chunk.endSample,
        text: transcript.tokens.map((token) => token.token).join(""),
        status: "done",
        modelVersion: GIGAAM_MODEL_ID,
        committedSample: chunk.endSample,
      })
    }
  } finally {
    recognizer.close()
  }

  const text = stitchByTokenCenters(transcripts).text
  setJobState(options.db, jobId, "done", "complete", device)
  return {
    jobId,
    text,
    segments: listSegments(options.db, jobId).length,
    chunks: chunks.length,
  }
}

export function runAsrFile(options: RunAsrFileOptions): AsrFileResult {
  const wave = sherpa.readWave(options.wavPath)
  if (wave.sampleRate !== SAMPLE_RATE_HZ) {
    throw new Error(`Нужен ${SAMPLE_RATE_HZ} Гц`)
  }
  return runAsrSamples({
    ...options,
    samples: wave.samples,
    audioPath: options.wavPath,
  })
}

export async function ensureSilero(path = SILERO_MODEL_PATH): Promise<string> {
  return ensureFile(path, SILERO_MODEL_URL)
}

export { VAD_FIXTURE }
