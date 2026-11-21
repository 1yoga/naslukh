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
  /** Идентификатор вызова: тот же sessionId приходит в onAudioLevel / onSpeechPause / onSpeechResume. */
  sessionId?: string
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
  /** Уровень сигнала во время listenOnce (addAudioLevelListener). С 0.2.0. */
  audioLevel: boolean
  /** Пауза внутри реплики (speechPauseMs, addSpeechPauseListener). С 0.2.0. */
  speechPause: boolean
  /** Монитор речи во время воспроизведения (monitorSpeech). С 0.2.0. */
  speechMonitor: boolean
  /** Устройство даёт AcousticEchoCanceler для echoCancellation. */
  echoCancellation: boolean
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
  /**
   * Период события onAudioLevel, мс (50–1000). По умолчанию 66 (≈15 событий/с), если есть подписчик
   * addAudioLevelListener, иначе события не шлются. 0 — выключить.
   */
  audioLevelIntervalMs?: number
  /**
   * Пауза внутри реплики, мс (100–5000), после которой приходит onSpeechPause. Реплика при этом
   * не завершается. Должна быть меньше vadMinSilenceSec. Не задано — событий нет.
   */
  speechPauseMs?: number
  /**
   * Захват с эхоподавлением: VOICE_COMMUNICATION + AcousticEchoCanceler/NoiseSuppressor, где они есть.
   * Нужен, если во время прослушивания телефон сам воспроизводит звук. По умолчанию false (VOICE_RECOGNITION).
   */
  echoCancellation?: boolean
  /** Продолжить реплику с захвата монитора речи (SpeechMonitor.id): микрофон и начало фразы не теряются. */
  continueFromMonitor?: string
}

/** Уровень сигнала во время listenOnce. */
export interface AudioLevelEvent {
  sessionId: string
  /** RMS окна, dBFS (−90…0). */
  rmsDbfs: number
  /** Пик окна, 0…1. */
  peak: number
  /** Решение Silero VAD для последнего окна. */
  speech: boolean
  /** От начала захвата, мс. */
  timestampMs: number
}

/** Тишина внутри реплики достигла speechPauseMs; реплика продолжается. */
export interface SpeechPauseEvent {
  sessionId: string
  silenceMs: number
  /** Длительность реплики до паузы, мс. */
  utteranceMs: number
}

/** После onSpeechPause речь возобновилась. */
export interface SpeechResumeEvent {
  sessionId: string
}

/** Монитор услышал речь пользователя. */
export interface MonitorSpeechEvent {
  monitorId: string
  speechMs: number
}

export interface MonitorSpeechOptions {
  /** Порог Silero; по умолчанию 0,6 — строже, чем у listenOnce, чтобы не ловить остаток эха. */
  vadThreshold?: number
  /** Минимальная речь до срабатывания, мс; по умолчанию 300. */
  minSpeechMs?: number
  /** Сколько звука до срабатывания передать в listenOnce, мс; по умолчанию 600. */
  prerollMs?: number
  /** Эхоподавление; по умолчанию true. */
  echoCancellation?: boolean
}

export interface SpeechMonitor {
  readonly id: string
  /** Пользователь заговорил. Обработчик вызывается один раз на монитор. */
  onSpeech(handler: (event: MonitorSpeechEvent) => void): () => void
  /** Остановить и освободить микрофон. После listenOnce({ continueFromMonitor }) ничего не делает. */
  stop(): Promise<void>
}

export type Unsubscribe = () => void

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
  /** Уровень сигнала во время listenOnce. С 0.2.0. */
  addAudioLevelListener(listener: (event: AudioLevelEvent) => void): Unsubscribe
  /** Пауза внутри реплики (нужен speechPauseMs в listenOnce). С 0.2.0. */
  addSpeechPauseListener(listener: (event: SpeechPauseEvent) => void): Unsubscribe
  /** Речь возобновилась после паузы. С 0.2.0. */
  addSpeechResumeListener(listener: (event: SpeechResumeEvent) => void): Unsubscribe
  /**
   * Слушать микрофон, пока приложение воспроизводит речь, и сообщить, когда пользователь заговорил.
   * Одновременно с listenOnce не работает: listenOnce({ continueFromMonitor }) забирает захват монитора. С 0.2.0.
   */
  monitorSpeech(options?: MonitorSpeechOptions): Promise<SpeechMonitor>
}

export const GIGAAM_MODEL_ID = "gigaam-v3-e2e-rnnt-int8"
