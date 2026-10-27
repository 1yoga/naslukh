import {
  CHECKPOINT_FORMAT,
  PIPELINE_VERSION,
  VAD_COMMIT_SAMPLES,
} from "./limits.ts"
import type { SampleRange } from "./chunk.ts"

export interface VadCommit {
  /** Новые интервалы с прошлого коммита; пишутся в той же транзакции, что и курсор. */
  intervals: SampleRange[]
  cursorSample: number
}

export interface CheckpointIdentity {
  modelVersion: string
  pipelineVersion: number
  checkpointFormat: number
}

/** Продолжение только при совпадении модели, пайплайна и формата чекпоинта. */
export function canResumeCheckpoint(
  saved: CheckpointIdentity,
  currentModelVersion: string,
): boolean {
  return (
    saved.modelVersion === currentModelVersion &&
    saved.pipelineVersion === PIPELINE_VERSION &&
    saved.checkpointFormat === CHECKPOINT_FORMAT
  )
}

export function shouldCommitVad(
  scannedSample: number,
  lastCommittedSample: number,
  atEnd: boolean,
): boolean {
  if (scannedSample < lastCommittedSample) {
    throw new Error("Курсор VAD не может идти назад")
  }
  if (scannedSample === lastCommittedSample) return false
  if (atEnd) return true
  return scannedSample - lastCommittedSample >= VAD_COMMIT_SAMPLES
}

/**
 * Раз в 60 с просмотренного звука (или в конце файла) отдаёт пакет
 * «интервалы + курсор». Иначе null — в базу ещё ничего не пишем.
 */
export function planVadCommit(args: {
  scannedSample: number
  lastCommittedSample: number
  pendingIntervals: readonly SampleRange[]
  atEnd: boolean
}): VadCommit | null {
  if (
    !shouldCommitVad(args.scannedSample, args.lastCommittedSample, args.atEnd)
  ) {
    return null
  }
  return {
    intervals: args.pendingIntervals.map((item) => ({ ...item })),
    cursorSample: args.scannedSample,
  }
}
