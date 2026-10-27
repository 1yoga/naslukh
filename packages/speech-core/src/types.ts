import type { CHECKPOINT_FORMAT, PIPELINE_VERSION } from "./limits.ts"

export type JobState =
  | "queued"
  | "recording"
  | "sealed"
  | "recognizing"
  | "paused"
  | "done"
  | "failed"
  | "cancelled"

export type AudioSource = "microphone" | "file"

export type SegmentStatus = "done" | "incomplete"

export type JournalEventName =
  | "start"
  | "pause"
  | "resume"
  | "interrupt"
  | "error"
  | "complete"
  | "cancel"

/** В манифесте нет серверного рантайма: окружение не подменяет локальную модель. */
export type ModelRuntime = "native" | "wasm"

export type ModelKind = "stt" | "tts" | "vad"

export type ModelRole = "batch" | "utterance" | "vad" | "tts"

export interface ModelFile {
  path: string
  size: number
  sha256: string
}

export interface SpeechModel {
  id: string
  kind: ModelKind
  role: ModelRole
  language: string
  enabled: boolean
  runtime: ModelRuntime
  files: ModelFile[]
  init?: {
    featureDim: number
    modelType: string
  }
}

export interface ModelManifest {
  version: 1
  models: SpeechModel[]
}

export interface Segment {
  startSample: number
  endSample: number
  text: string
  status: SegmentStatus
  modelVersion: string
}

export interface TranscriptionResult {
  text: string
  segments: Segment[]
}

export interface Progress {
  processedSamples: number
  totalSamples: number | null
  state: JobState
}

export type JobHandler<T> = (payload: T) => void

export interface TranscriptionJob {
  start(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(): Promise<void>
  result(): Promise<TranscriptionResult>
  on(event: "progress", handler: JobHandler<Progress>): void
  on(event: "segment", handler: JobHandler<Segment>): void
  on(event: "state", handler: JobHandler<JobState>): void
}

export interface Recording {
  stop(): Promise<TranscriptionJob>
  cancel(): Promise<void>
}

/**
 * partialResults и tts в первой поставке всегда false.
 * listen() объявлен заранее и не реализован, пока не принят длинный архив.
 */
export interface SpeechCapabilities {
  recording: boolean
  fileTranscription: boolean
  background: boolean
  reliableStorage: boolean
  threads: 1 | 2
  maxRecommendedDurationSec: number
  models: string[]
  partialResults: false
  tts: false
}

export interface FileSource {
  uri: string
  language: "ru"
}

export interface SpeechEngine {
  capabilities(): SpeechCapabilities
  ensureModel(id: string): Promise<void>
  transcribeFile(source: FileSource): TranscriptionJob
  record(options?: { language: "ru" }): Recording
}

export interface JournalEntry {
  ts: number
  event: JournalEventName
  jobId: string | null
  stateFrom: JobState | null
  stateTo: JobState | null
  modelVersion: string
  pipelineVersion: typeof PIPELINE_VERSION
  checkpointFormat: typeof CHECKPOINT_FORMAT
  deviceModel: string
  osName: string
  osVersion: string
  libraryVersion: string
}
