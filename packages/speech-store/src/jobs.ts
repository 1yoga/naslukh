import {
  CHECKPOINT_FORMAT,
  LIBRARY_VERSION,
  PIPELINE_VERSION,
  assertTransition,
  canResumeCheckpoint,
} from "../../speech-core/src/index.ts"
import type {
  JobState,
  JournalEventName,
  SampleRange,
} from "../../speech-core/src/index.ts"
import type {
  CreateJobInput,
  JobRow,
  JournalWrite,
  SqlDatabase,
  VadCommitInput,
} from "./types.ts"

function mapJob(row: Record<string, string | number | null | bigint>): JobRow {
  return {
    id: String(row.id),
    state: String(row.state) as JobState,
    source: String(row.source) as JobRow["source"],
    modelId: String(row.model_id),
    modelVersion: String(row.model_version),
    pipelineVersion: Number(row.pipeline_version),
    checkpointFormat: Number(row.checkpoint_format),
    language: "ru",
    audioPath: row.audio_path === null ? null : String(row.audio_path),
    vadCursorSample: Number(row.vad_cursor_sample),
    lastCommittedSample: Number(row.last_committed_sample),
    errorMessage: row.error_message === null ? null : String(row.error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function createJob(db: SqlDatabase, input: CreateJobInput): JobRow {
  const now = input.now ?? Date.now()
  db.prepare(
    `INSERT INTO jobs (
      id, state, source, model_id, model_version, pipeline_version, checkpoint_format,
      language, audio_path, vad_cursor_sample, last_committed_sample, error_message,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ru', ?, 0, 0, NULL, ?, ?)`,
  ).run(
    input.id,
    "queued",
    input.source,
    input.modelId,
    input.modelVersion,
    PIPELINE_VERSION,
    CHECKPOINT_FORMAT,
    input.audioPath ?? null,
    now,
    now,
  )
  writeJournal(db, {
    ts: now,
    event: "start",
    jobId: input.id,
    stateFrom: null,
    stateTo: "queued",
    modelVersion: input.modelVersion,
    pipelineVersion: PIPELINE_VERSION,
    checkpointFormat: CHECKPOINT_FORMAT,
    deviceModel: "unknown",
    osName: "unknown",
    osVersion: "unknown",
    libraryVersion: LIBRARY_VERSION,
  })
  return getJob(db, input.id)
}

export function getJob(db: SqlDatabase, jobId: string): JobRow {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId)
  if (!row) throw new Error(`Задание ${jobId} не найдено`)
  return mapJob(row)
}

export function setJobState(
  db: SqlDatabase,
  jobId: string,
  to: JobState,
  event: JournalEventName,
  device: VadCommitInput["device"],
  now = Date.now(),
): JobRow {
  const job = getJob(db, jobId)
  assertTransition(job.state, to)
  db.prepare("UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?").run(to, now, jobId)
  writeJournal(db, {
    ts: now,
    event,
    jobId,
    stateFrom: job.state,
    stateTo: to,
    modelVersion: job.modelVersion,
    pipelineVersion: job.pipelineVersion,
    checkpointFormat: job.checkpointFormat,
    deviceModel: device.deviceModel,
    osName: device.osName,
    osVersion: device.osVersion,
    libraryVersion: LIBRARY_VERSION,
  })
  return getJob(db, jobId)
}

/**
 * Открывает задание для продолжения VAD.
 * Курсор и уже записанные интервалы не пересчитываются.
 */
export function resumeVadJob(db: SqlDatabase, jobId: string, modelVersion: string): JobRow {
  const job = getJob(db, jobId)
  if (
    !canResumeCheckpoint(
      {
        modelVersion: job.modelVersion,
        pipelineVersion: job.pipelineVersion,
        checkpointFormat: job.checkpointFormat,
      },
      modelVersion,
    )
  ) {
    throw new Error("Чекпоинт нельзя продолжить: другая модель или версия пайплайна")
  }
  if (job.state !== "recognizing" && job.state !== "paused" && job.state !== "sealed") {
    throw new Error(`VAD не продолжается из состояния ${job.state}`)
  }
  return job
}

/** Интервалы и курсор — одна транзакция. */
export function commitVad(db: SqlDatabase, input: VadCommitInput): JobRow {
  const job = getJob(db, input.jobId)
  if (
    !canResumeCheckpoint(
      {
        modelVersion: job.modelVersion,
        pipelineVersion: job.pipelineVersion,
        checkpointFormat: job.checkpointFormat,
      },
      job.modelVersion,
    )
  ) {
    throw new Error("Чекпоинт повреждён")
  }
  if (input.cursorSample < job.vadCursorSample) {
    throw new Error("Курсор VAD не может идти назад")
  }
  const now = input.now ?? Date.now()
  db.exec("BEGIN")
  try {
    for (const interval of input.intervals) {
      // Lookback Silero может начать интервал чуть левее курсора; целиком
      // слева от курсора повторно не пишем.
      if (interval.endSample <= job.vadCursorSample) {
        throw new Error("Интервал левее курсора уже должен быть в базе")
      }
      const startSample = Math.max(interval.startSample, job.vadCursorSample)
      db.prepare(
        "INSERT INTO vad_intervals (job_id, start_sample, end_sample) VALUES (?, ?, ?)",
      ).run(input.jobId, startSample, interval.endSample)
    }
    db.prepare(
      "UPDATE jobs SET vad_cursor_sample = ?, updated_at = ? WHERE id = ?",
    ).run(input.cursorSample, now, input.jobId)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  return getJob(db, input.jobId)
}

export function listVadIntervals(db: SqlDatabase, jobId: string): SampleRange[] {
  return db
    .prepare(
      "SELECT start_sample, end_sample FROM vad_intervals WHERE job_id = ? ORDER BY start_sample",
    )
    .all(jobId)
    .map((row) => ({
      startSample: Number(row.start_sample),
      endSample: Number(row.end_sample),
    }))
}

function writeJournal(db: SqlDatabase, entry: JournalWrite): void {
  db.prepare(
    `INSERT INTO journal (
      ts, event, job_id, state_from, state_to, model_version, pipeline_version,
      checkpoint_format, device_model, os_name, os_version, library_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.ts,
    entry.event,
    entry.jobId,
    entry.stateFrom,
    entry.stateTo,
    entry.modelVersion,
    entry.pipelineVersion,
    entry.checkpointFormat,
    entry.deviceModel,
    entry.osName,
    entry.osVersion,
    entry.libraryVersion,
  )
}
