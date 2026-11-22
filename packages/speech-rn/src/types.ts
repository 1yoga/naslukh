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
  /** Задержка и расшифровка по кускам; на Android приходит всегда. С 0.3.0. */
  timings?: ListenTimings
}

/** Измерения `listenOnce()` для расчёта задержки без догадок. С 0.3.0. */
export interface ListenTimings {
  /** От решения VAD «реплика кончилась» до готового текста, мс. Главная цифра. Считается в нативной части, без пост-правки корректором в JS. */
  finalizeMs: number
  /** Расшифровка последнего куска, мс; 0, если хвост состоял из тишины. */
  tailDecodeMs: number
  /** Сумма расшифровки всех кусков, мс. */
  totalDecodeMs: number
  /** Сколько кусков. */
  segments: number
  /** Сколько тишины ждали до решения VAD, мс (≈ vadMinSilenceSec). */
  endSilenceMs: number
}

/** Кусок реплики расшифрован, реплика ещё идёт. Текст черновой: окончательный — в результате. С 0.3.0. */
export interface ListenSegmentEvent {
  sessionId: string
  /** Номер куска с нуля. */
  index: number
  text: string
  /** Границы куска от начала захвата, мс. */
  startMs: number
  endMs: number
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
  /** Есть событие куска addListenSegmentListener. С 0.3.0 — true (в 0.2.0 было false). */
  partialResults: boolean
  tts: false
  /** Уровень сигнала во время listenOnce (addAudioLevelListener). С 0.2.0. */
  audioLevel: boolean
  /** Пауза внутри реплики (speechPauseMs, addSpeechPauseListener). С 0.2.0. */
  speechPause: boolean
  /** Монитор речи во время воспроизведения (monitorSpeech). С 0.2.0. */
  speechMonitor: boolean
  /** Устройство даёт AcousticEchoCanceler для echoCancellation. */
  echoCancellation: boolean
  /** Расшифровка реплики по ходу записи (incrementalDecode). С 0.3.0. */
  incrementalDecode: boolean
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
  /**
   * Расшифровывать реплику по ходу записи: куски режутся по паузам внутри реплики и расшифровываются
   * в фоне, после конца речи остаётся только последний кусок. `false` — вся реплика одним куском
   * после конца речи, как в 0.2.0. По умолчанию true. С 0.3.0.
   */
  incrementalDecode?: boolean
  /**
   * Пауза внутри реплики, по которой режется кусок, мс (200–2000). По умолчанию 400.
   * Не меньше `vadMinSilenceSec`·1000 — расшифровка по ходу реплики для этого вызова выключается.
   */
  incrementalPauseMs?: number
  /** Принудительный рез сплошной речи без пауз, с (3–30). По умолчанию 8. */
  maxSegmentSec?: number
  /** Кусок короче не режем, копим дальше, с (0,5–10). По умолчанию 2. */
  minSegmentSec?: number
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
   * Кусок реплики расшифрован, реплика ещё идёт (нужен incrementalDecode). Текст черновой.
   * После cancelListenOnce() события этой сессии не приходят. С 0.3.0.
   */
  addListenSegmentListener(listener: (event: ListenSegmentEvent) => void): Unsubscribe
  /**
   * Слушать микрофон, пока приложение воспроизводит речь, и сообщить, когда пользователь заговорил.
   * Одновременно с listenOnce не работает: listenOnce({ continueFromMonitor }) забирает захват монитора. С 0.2.0.
   */
  monitorSpeech(options?: MonitorSpeechOptions): Promise<SpeechMonitor>
}

export const GIGAAM_MODEL_ID = "gigaam-v3-e2e-rnnt-int8"
