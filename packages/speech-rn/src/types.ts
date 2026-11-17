import type { TranscribeOptions } from "./options"

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
  /** SQLite job id (Android checkpoint). */
  jobId?: string
  resumed?: boolean
  fromCache?: boolean
}

export interface ListenOnceResult {
  text: string
  segments: Segment[]
  /** Полная длительность захваченного utterance в миллисекундах. */
  durationMs: number
  /** Локальный WAV в кэше приложения, если запрошен saveAudio. */
  audioUri?: string
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
  options?: import("./options").TranscribeOptions
}

export interface ListenOnceOptions extends TranscribeOptions {
  language?: "ru"
  /** Сколько ждать начала речи, прежде чем вернуть ошибку. */
  startTimeoutSec?: number
  /** Лимит фразы 2–30 с; по умолчанию 30 с. */
  maxDurationSec?: number
  /** Сохранить захваченную фразу в WAV для прослушивания (по умолчанию false). */
  saveAudio?: boolean
}

export interface SpeechEngine {
  capabilities(): SpeechCapabilities
  ensureModel(id: string): Promise<void>
  transcribeFile(source: FileSource): TranscriptionJob
  listenOnce(options?: ListenOnceOptions): Promise<ListenOnceResult>
  /** Ручное завершение текущей фразы с распознаванием захваченного звука. */
  stopListenOnce(): Promise<void>
  /** Отмена без результата. */
  cancelListenOnce(): Promise<void>
  record(options?: { language: "ru" }): Recording
}

export const GIGAAM_MODEL_ID = "gigaam-v3-e2e-rnnt-int8"
