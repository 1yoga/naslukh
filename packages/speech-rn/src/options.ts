/** Опции прогона ASR (стенд / приложение). */
export interface TranscribeOptions {
  /** Не брать готовое задание из SQLite по отпечатку. */
  ignoreCache?: boolean
  /** Порог Silero 0…1 (меньше — чувствительнее). */
  vadThreshold?: number
  vadMinSpeechSec?: number
  vadMinSilenceSec?: number
  /** Потоки ONNX (1–4). */
  numThreads?: number
  /**
   * Каталог брендов / hotwords.
   * Сейчас: пост-правка + запись в лог; native beam-bias — по мере поддержки JNI.
   */
  hotwords?: string[]
  /** Включить лёгкий post-ASR corrector. */
  correctorEnabled?: boolean
  brandMinScore?: number
}
