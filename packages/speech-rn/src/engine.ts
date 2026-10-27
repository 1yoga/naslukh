import { NativeModules, Platform } from "react-native"
import type {
  FileSource,
  JobHandler,
  JobState,
  Progress,
  Recording,
  Segment,
  SpeechCapabilities,
  SpeechEngine,
  TranscriptionJob,
  TranscriptionResult,
} from "./types"
import { GIGAAM_MODEL_ID } from "./types"

type NativeSpeech = {
  ensureModel(modelId: string): Promise<string>
  transcribeFile(uri: string): Promise<{ text: string; segments: Segment[] }>
}

const native: NativeSpeech | undefined = NativeModules.NaslukhSpeech

type HandlerMap = {
  progress: JobHandler<Progress>[]
  segment: JobHandler<Segment>[]
  state: JobHandler<JobState>[]
}

class FileJob implements TranscriptionJob {
  private readonly handlers: HandlerMap = {
    progress: [],
    segment: [],
    state: [],
  }
  private started = false
  private cancelled = false
  private readonly resultPromise: Promise<TranscriptionResult>
  private resolveResult!: (value: TranscriptionResult) => void
  private rejectResult!: (error: unknown) => void
  private readonly run: () => Promise<TranscriptionResult>

  constructor(run: () => Promise<TranscriptionResult>) {
    this.run = run
    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
  }

  on(event: "progress", handler: JobHandler<Progress>): void
  on(event: "segment", handler: JobHandler<Segment>): void
  on(event: "state", handler: JobHandler<JobState>): void
  on(
    event: "progress" | "segment" | "state",
    handler: JobHandler<Progress> | JobHandler<Segment> | JobHandler<JobState>,
  ): void {
    this.handlers[event].push(handler as never)
  }

  async start(): Promise<void> {
    if (this.cancelled) throw new Error("Задание отменено")
    if (this.started) return
    this.started = true
    try {
      this.emitState("recognizing")
      this.emitProgress({
        processedSamples: 0,
        totalSamples: null,
        state: "recognizing",
      })
      const value = await this.run()
      if (this.cancelled) {
        this.emitState("cancelled")
        this.rejectResult(new Error("Задание отменено"))
        return
      }
      for (const segment of value.segments) {
        for (const handler of this.handlers.segment) handler(segment)
      }
      this.emitState("done")
      this.emitProgress({
        processedSamples: 1,
        totalSamples: 1,
        state: "done",
      })
      this.resolveResult(value)
    } catch (error) {
      this.emitState("failed")
      this.rejectResult(error)
    }
  }

  async pause(): Promise<void> {
    throw new Error("Пауза файла пока не поддерживается")
  }

  async resume(): Promise<void> {
    throw new Error("Пауза файла пока не поддерживается")
  }

  async cancel(): Promise<void> {
    this.cancelled = true
    if (!this.started) {
      this.emitState("cancelled")
      this.rejectResult(new Error("Задание отменено"))
    }
  }

  result(): Promise<TranscriptionResult> {
    if (!this.started && !this.cancelled) {
      void this.start().catch(() => undefined)
    }
    return this.resultPromise
  }

  private emitState(state: JobState): void {
    for (const handler of this.handlers.state) handler(state)
  }

  private emitProgress(progress: Progress): void {
    for (const handler of this.handlers.progress) handler(progress)
  }
}

export interface CreateSpeechEngineOptions {
  /** Если нет нативного модуля — имитировать распознавание (только отладка UI). */
  allowStub?: boolean
}

declare const __DEV__: boolean | undefined

/**
 * Android SpeechEngine: ensureModel + transcribeFile.
 * Запись микрофона остаётся в приложении (D11).
 */
export function createSpeechEngine(
  options: CreateSpeechEngineOptions = {},
): SpeechEngine {
  const allowStub = options.allowStub ?? Boolean(__DEV__)

  return {
    capabilities(): SpeechCapabilities {
      return {
        recording: false,
        fileTranscription: Platform.OS === "android" || allowStub,
        background: false,
        reliableStorage: true,
        threads: 1,
        maxRecommendedDurationSec: 10 * 60 * 60,
        models: [GIGAAM_MODEL_ID],
        partialResults: false,
        tts: false,
      }
    },

    async ensureModel(id: string): Promise<void> {
      if (id !== GIGAAM_MODEL_ID) {
        throw new Error(`Неизвестная модель: ${id}`)
      }
      if (native?.ensureModel) {
        await native.ensureModel(id)
        return
      }
      if (!allowStub) {
        throw new Error("Нативный модуль NaslukhSpeech не подключён")
      }
    },

    transcribeFile(source: FileSource): TranscriptionJob {
      if (source.language !== "ru") {
        throw new Error('Поддерживается только language: "ru"')
      }
      return new FileJob(async () => {
        if (native?.transcribeFile) {
          const result = await native.transcribeFile(source.uri)
          return {
            text: result.text,
            segments: result.segments ?? [],
          }
        }
        if (!allowStub) {
          throw new Error("Нативный модуль NaslukhSpeech не подключён")
        }
        await delay(800)
        return {
          text: "[заглушка ASR] Локальная модель ещё не ответила — проверьте сборку с NaslukhSpeech.",
          segments: [
            {
              startSample: 0,
              endSample: 16000,
              text: "[заглушка ASR] Локальная модель ещё не ответила — проверьте сборку с NaslukhSpeech.",
              status: "done",
              modelVersion: GIGAAM_MODEL_ID,
            },
          ],
        }
      })
    },

    record(_options?: { language: "ru" }): Recording {
      throw new Error("Запись микрофона — в приложении, не в speech-rn")
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
