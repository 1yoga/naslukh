import { mkdirSync, writeFileSync } from "node:fs"
import { freemem } from "node:os"
import { join } from "node:path"
import {
  assertCanStartRecognition,
  fingerprintKey,
} from "../../speech-core/src/index.ts"
import {
  createJob,
  findJobByFingerprint,
  migrate,
  setJobAudio,
} from "../../speech-store/src/index.ts"
import type { JobRow, SqlDatabase } from "../../speech-store/src/index.ts"
import { OPUS_CONTAINER } from "./container.ts"
import { fingerprintBuffer, fingerprintFile } from "./fingerprint.ts"
import { encodeOpus } from "./opus.ts"
import { readWavPcm16 } from "./wav.ts"

export interface ImportWavOptions {
  wavPath: string
  db: SqlDatabase
  /** Каталог для .nsop; файл = <jobId>.nsop */
  audioDir: string
  jobId?: string
  modelId: string
  modelVersion: string
  /** Если отпечаток исходника уже есть — вернуть старое задание. */
  reuseFingerprint?: boolean
  /** Для тестов; по умолчанию os.freemem(). */
  freeMemoryBytes?: number
}

export interface ImportWavResult {
  job: JobRow
  reused: boolean
  sourceFingerprint: { size: number; sha256: string; key: string }
  storedFingerprint: { size: number; sha256: string; key: string }
  samples: number
}

/**
 * Импорт WAV: отпечаток исходника → Opus NSOP → задание в store.
 * Повторный импорт того же файла (по SHA-256 исходника) переиспользует job.
 */
export async function importWavFile(
  options: ImportWavOptions,
): Promise<ImportWavResult> {
  migrate(options.db)
  assertCanStartRecognition(options.freeMemoryBytes ?? freemem())
  const sourceFingerprint = await fingerprintFile(options.wavPath)

  if (options.reuseFingerprint !== false) {
    const existing = findJobByFingerprint(
      options.db,
      sourceFingerprint.size,
      sourceFingerprint.sha256,
    )
    if (existing) {
      return {
        job: existing,
        reused: true,
        sourceFingerprint,
        storedFingerprint: {
          size: existing.fingerprintSize ?? sourceFingerprint.size,
          sha256: existing.fingerprintSha256 ?? sourceFingerprint.sha256,
          key: fingerprintKey(
            existing.fingerprintSize ?? sourceFingerprint.size,
            existing.fingerprintSha256 ?? sourceFingerprint.sha256,
          ),
        },
        samples: 0,
      }
    }
  }

  const { samples } = readWavPcm16(options.wavPath)
  const encoded = encodeOpus(samples)
  const storedFingerprint = fingerprintBuffer(encoded)

  const jobId = options.jobId ?? `import-${Date.now()}`
  mkdirSync(options.audioDir, { recursive: true })
  const audioPath = join(options.audioDir, `${jobId}.nsop`)
  writeFileSync(audioPath, encoded)

  // В fingerprint_* храним отпечаток исходника (для дедупа импорта).
  // Путь указывает на NSOP на диске.
  createJob(options.db, {
    id: jobId,
    source: "file",
    modelId: options.modelId,
    modelVersion: options.modelVersion,
    audioPath,
  })
  const job = setJobAudio(options.db, jobId, {
    path: audioPath,
    container: OPUS_CONTAINER,
    fingerprintSize: sourceFingerprint.size,
    fingerprintSha256: sourceFingerprint.sha256,
  })

  return {
    job,
    reused: false,
    sourceFingerprint,
    storedFingerprint,
    samples: samples.length,
  }
}
