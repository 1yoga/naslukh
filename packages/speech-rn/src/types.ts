export type JobState =
  | "queued"
  | "recording"
  | "sealed"
  | "recognizing"
  | "paused"
  | "done"
  | "failed"
  | "cancelled"

export interface Segment {
  startSample: number
  endSample: number
  text: string
  status: "done" | "incomplete"
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

export const GIGAAM_MODEL_ID = "gigaam-v3-e2e-rnnt-int8"
