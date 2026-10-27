import type { Segment, SegmentStatus } from "../../speech-core/src/index.ts"
import { getJob } from "./jobs.ts"
import type { SqlDatabase } from "./types.ts"

export interface SegmentCommitInput {
  jobId: string
  vadIntervalId?: number | null
  startSample: number
  endSample: number
  text: string
  status: SegmentStatus
  modelVersion: string
  /** Курсор распознавания: обычно endSample куска. */
  committedSample: number
  now?: number
}

export interface StoredSegment extends Segment {
  id: number
  vadIntervalId: number | null
}

/** Сегмент и last_committed_sample — одна транзакция. */
export function commitSegment(db: SqlDatabase, input: SegmentCommitInput): StoredSegment {
  const job = getJob(db, input.jobId)
  if (input.committedSample < job.lastCommittedSample) {
    throw new Error("Курсор распознавания не может идти назад")
  }
  if (input.endSample <= input.startSample) {
    throw new Error("Сегмент пустой")
  }
  const now = input.now ?? Date.now()
  db.exec("BEGIN")
  try {
    db.prepare(
      `INSERT INTO segments (
        job_id, vad_interval_id, start_sample, end_sample, text, status, model_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.jobId,
      input.vadIntervalId ?? null,
      input.startSample,
      input.endSample,
      input.text,
      input.status,
      input.modelVersion,
    )
    db.prepare(
      "UPDATE jobs SET last_committed_sample = ?, updated_at = ? WHERE id = ?",
    ).run(input.committedSample, now, input.jobId)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  const rows = listSegments(db, input.jobId)
  const last = rows[rows.length - 1]
  if (!last) throw new Error("Сегмент не записался")
  return last
}

export function listSegments(db: SqlDatabase, jobId: string): StoredSegment[] {
  return db
    .prepare(
      `SELECT id, vad_interval_id, start_sample, end_sample, text, status, model_version
       FROM segments WHERE job_id = ? ORDER BY start_sample`,
    )
    .all(jobId)
    .map((row) => ({
      id: Number(row.id),
      vadIntervalId: row.vad_interval_id === null ? null : Number(row.vad_interval_id),
      startSample: Number(row.start_sample),
      endSample: Number(row.end_sample),
      text: String(row.text),
      status: String(row.status) as SegmentStatus,
      modelVersion: String(row.model_version),
    }))
}

/** Куски, чей конец ещё не закрыт курсором распознавания. */
export function pendingChunkStart(db: SqlDatabase, jobId: string): number {
  return getJob(db, jobId).lastCommittedSample
}
