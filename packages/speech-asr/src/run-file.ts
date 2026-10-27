import sherpa from "sherpa-onnx-node"
import { freemem } from "node:os"
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
import { runVadFile } from "../../speech-vad/src/run-file.ts"
import { GIGAAM_MODEL_ID } from "./paths.ts"
import { createGigaamRecognizer } from "./recognize.ts"

export interface RunAsrFileOptions {
  wavPath: string
  modelDir: string
  sileroPath: string
  db: SqlDatabase
  jobId?: string
  /** Для тестов; по умолчанию os.freemem(). */
  freeMemoryBytes?: number
  device?: {
    deviceModel: string
    osName: string
    osVersion: string
  }
}

export interface AsrFileResult {
  jobId: string
  text: string
  segments: number
  chunks: number
}

/**
 * VAD → куски → GigaAM → сегменты в SQLite.
 * Курсор распознавания — last_committed_sample.
 */
export function runAsrFile(options: RunAsrFileOptions): AsrFileResult {
  const device = options.device ?? {
    deviceModel: "node-harness",
    osName: "node",
    osVersion: process.versions.node,
  }
  migrate(options.db)
  assertCanStartRecognition(options.freeMemoryBytes ?? freemem())
  const jobId = options.jobId ?? `asr-${Date.now()}`

  createJob(options.db, {
    id: jobId,
    source: "file",
    modelId: GIGAAM_MODEL_ID,
    modelVersion: GIGAAM_MODEL_ID,
    audioPath: options.wavPath,
  })
  setJobState(options.db, jobId, "recognizing", "resume", device)

  runVadFile({
    wavPath: options.wavPath,
    modelPath: options.sileroPath,
    db: options.db,
    jobId,
    modelId: GIGAAM_MODEL_ID,
    modelVersion: GIGAAM_MODEL_ID,
    resume: true,
    device,
  })

  const wave = sherpa.readWave(options.wavPath)
  if (wave.sampleRate !== SAMPLE_RATE_HZ) {
    throw new Error(`Нужен ${SAMPLE_RATE_HZ} Гц`)
  }

  const intervals = listVadIntervals(options.db, jobId)
  const chunks = buildSpeechChunks(intervals, wave.samples.length)
  const fromSample = pendingChunkStart(options.db, jobId)
  const pending = chunks.filter((chunk) => chunk.endSample > fromSample)

  const recognizer = createGigaamRecognizer(options.modelDir)
  const transcripts: ChunkTranscript[] = []
  try {
    for (const chunk of pending) {
      const samples = wave.samples.subarray(chunk.startSample, chunk.endSample)
      const transcript = recognizer.decodeChunk(chunk, samples)
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

export async function ensureSilero(path = SILERO_MODEL_PATH): Promise<string> {
  return ensureFile(path, SILERO_MODEL_URL)
}

export { VAD_FIXTURE }
