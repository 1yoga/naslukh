import { readFileSync } from "node:fs"
import { decodeOpus, importWavFile } from "../../speech-audio/src/index.ts"
import { listSegments } from "../../speech-store/src/index.ts"
import type { SqlDatabase } from "../../speech-store/src/index.ts"
import { GIGAAM_MODEL_ID } from "./paths.ts"
import { runAsrSamples } from "./run-file.ts"
import type { AsrFileResult, AsrRunHooks } from "./run-file.ts"

export interface RunImportPipelineOptions {
  wavPath: string
  modelDir: string
  sileroPath: string
  db: SqlDatabase
  audioDir: string
  jobId?: string
  freeMemoryBytes?: number
  device?: {
    deviceModel: string
    osName: string
    osVersion: string
  }
  hooks?: AsrRunHooks
}

export interface ImportPipelineResult extends AsrFileResult {
  reusedImport: boolean
  audioPath: string
  container: string | null
}

/**
 * Импорт WAV → NSOP → декод → VAD → GigaAM → сегменты.
 */
export async function runImportPipeline(
  options: RunImportPipelineOptions,
): Promise<ImportPipelineResult> {
  const imported = await importWavFile({
    wavPath: options.wavPath,
    db: options.db,
    audioDir: options.audioDir,
    jobId: options.jobId,
    modelId: GIGAAM_MODEL_ID,
    modelVersion: GIGAAM_MODEL_ID,
    freeMemoryBytes: options.freeMemoryBytes,
  })

  const audioPath = imported.job.audioPath
  if (!audioPath) throw new Error("У задания нет пути к NSOP")

  // Повторный импорт уже мог быть распознан.
  if (imported.reused && imported.job.state === "done") {
    const segments = listSegments(options.db, imported.job.id)
    options.hooks?.onState?.("done")
    for (const segment of segments) {
      options.hooks?.onSegment?.({
        startSample: segment.startSample,
        endSample: segment.endSample,
        text: segment.text,
        status: segment.status,
        modelVersion: segment.modelVersion,
      })
    }
    options.hooks?.onProgress?.({
      processedSamples: 1,
      totalSamples: 1,
      state: "done",
    })
    return {
      jobId: imported.job.id,
      text: segments.map((segment) => segment.text).join(""),
      segments: segments.length,
      chunks: segments.length,
      reusedImport: true,
      audioPath,
      container: imported.job.audioContainer,
    }
  }

  const decoded = decodeOpus(readFileSync(audioPath))
  const result = runAsrSamples({
    samples: decoded.samples,
    modelDir: options.modelDir,
    sileroPath: options.sileroPath,
    db: options.db,
    jobId: imported.job.id,
    existingJob: true,
    audioPath,
    freeMemoryBytes: options.freeMemoryBytes,
    device: options.device,
    hooks: options.hooks,
  })

  return {
    ...result,
    reusedImport: imported.reused,
    audioPath,
    container: imported.job.audioContainer,
  }
}
