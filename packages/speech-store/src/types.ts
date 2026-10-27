import type {
  AudioSource,
  JobState,
  JournalEventName,
} from "../../speech-core/src/index.ts"
import type { SampleRange } from "../../speech-core/src/index.ts"

export interface JobRow {
  id: string
  state: JobState
  source: AudioSource
  modelId: string
  modelVersion: string
  pipelineVersion: number
  checkpointFormat: number
  language: "ru"
  audioPath: string | null
  vadCursorSample: number
  lastCommittedSample: number
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

export interface CreateJobInput {
  id: string
  source: AudioSource
  modelId: string
  modelVersion: string
  audioPath?: string | null
  now?: number
}

export interface VadCommitInput {
  jobId: string
  intervals: readonly SampleRange[]
  cursorSample: number
  device: {
    deviceModel: string
    osName: string
    osVersion: string
  }
  now?: number
}

export interface JournalWrite {
  ts: number
  event: JournalEventName
  jobId: string | null
  stateFrom: JobState | null
  stateTo: JobState | null
  modelVersion: string
  pipelineVersion: number
  checkpointFormat: number
  deviceModel: string
  osName: string
  osVersion: string
  libraryVersion: string
}

/** Минимальный SQL-адаптер: Node, RN и WASM подставляют свой движок. */
export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
}

export interface SqlStatement {
  run(...params: SqlValue[]): void
  get(...params: SqlValue[]): Record<string, SqlValue> | undefined
  all(...params: SqlValue[]): Record<string, SqlValue>[]
}

export type SqlValue = string | number | null | bigint
