import { Platform } from "react-native"
import { requireOptionalNativeModule } from "expo-modules-core"
import type {
  AudioLevelEvent,
  FileSource,
  JobHandler,
  JobState,
  ListenOnceOptions,
  ListenOnceResult,
  ListenSegmentEvent,
  ListenTimings,
  MonitorSpeechEvent,
  MonitorSpeechOptions,
  Progress,
  Recording,
  Segment,
  SpeechCapabilities,
  SpeechEngine,
  SpeechMonitor,
  SpeechPauseEvent,
  SpeechResumeEvent,
  TranscriptionJob,
  TranscriptionResult,
} from "./types"
import { correctAsrText } from "./corrector"
import { addNativeEventListener } from "./events"
import { joinSegmentTexts } from "./join"
import type { SegmentBoundary } from "./join"
import { GIGAAM_MODEL_ID } from "./types"

type NativeSpeech = {
  ensureModel(modelId: string): Promise<string>
  listenOnce(
    options?: Record<string, unknown>,
  ): Promise<{
    sessionId?: string
    text: string
    segments: (Segment & { boundary?: SegmentBoundary })[]
    durationMs: number
    audioUri: string | null
    timings?: Partial<Record<keyof ListenTimings, number>>
  }>
  cancelListenOnce(): Promise<boolean>
  stopListenOnce(): Promise<boolean>
  startSpeechMonitor?(options?: Record<string, unknown>): Promise<string>
  stopSpeechMonitor?(monitorId: string | null): Promise<boolean>
  isEchoCancellationAvailable?(): boolean
  transcribeFile(
    uri: string,
    options?: Record<string, unknown>,
  ): Promise<{
    text: string
    segments: Segment[]
    jobId?: string
    resumed?: boolean
    fromCache?: boolean
  }>
}

const native = requireOptionalNativeModule<NativeSpeech>("NaslukhSpeech")

/** onAudioLevel шлётся, только если на него кто-то подписан (или audioLevelIntervalMs задан явно). */
let audioLevelListeners = 0
const DEFAULT_AUDIO_LEVEL_INTERVAL_MS = 66

/** Пост-правка текста события куска теми же опциями, что у текущего listenOnce. */
let activeListenCorrect: ((text: string) => string) | null = null

function echoCancellationAvailable(): boolean {
  try {
    return Boolean(native?.isEchoCancellationAvailable?.())
  } catch {
    return false
  }
}

class NativeSpeechMonitor implements SpeechMonitor {
  private stopped = false

  constructor(readonly id: string) {}

  onSpeech(handler: (event: MonitorSpeechEvent) => void): () => void {
    let fired = false
    return addNativeEventListener<MonitorSpeechEvent>("onMonitorSpeech", (event) => {
      if (fired || event.monitorId !== this.id) return
      fired = true
      handler({ monitorId: event.monitorId, speechMs: Number(event.speechMs) || 0 })
    })
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await native?.stopSpeechMonitor?.(this.id)
  }
}

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
        partialResults: Boolean(native?.listenOnce),
        tts: false,
        audioLevel: Boolean(native?.listenOnce),
        speechPause: Boolean(native?.listenOnce),
        speechMonitor: Boolean(native?.startSpeechMonitor),
        echoCancellation: echoCancellationAvailable(),
        incrementalDecode: Boolean(native?.listenOnce),
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
        throw new Error(
          "NaslukhSpeech не в APK: expo prebuild + JitPack (см. @naslukh/speech-rn README)",
        )
      }
    },

    transcribeFile(source: FileSource): TranscriptionJob {
      if (source.language !== "ru") {
        throw new Error('Поддерживается только language: "ru"')
      }
      return new FileJob(async () => {
        const opts = source.options ?? {}
        if (native?.transcribeFile) {
          const result = await native.transcribeFile(source.uri, {
            ignoreCache: Boolean(opts.ignoreCache),
            vadThreshold: opts.vadThreshold ?? 0.15,
            vadMinSpeechSec: opts.vadMinSpeechSec ?? 0.25,
            vadMinSilenceSec: opts.vadMinSilenceSec ?? 0.25,
            numThreads: opts.numThreads ?? 2,
            hotwords: opts.hotwords ?? [],
          })
          const rawText = result.text ?? ""
          const text = correctAsrText(rawText, {
            enabled: Boolean(opts.correctorEnabled),
            brands: opts.hotwords ?? [],
            brandMinScore: opts.brandMinScore ?? 0.72,
          })
          const segments = (result.segments ?? []).map((s) => {
            const segText = correctAsrText(s.text ?? "", {
              enabled: Boolean(opts.correctorEnabled),
              brands: opts.hotwords ?? [],
              brandMinScore: opts.brandMinScore ?? 0.72,
            })
            return {
              startSample: s.startSample,
              endSample: s.endSample,
              text: segText,
              status: s.status ?? "done",
              modelVersion: s.modelVersion ?? GIGAAM_MODEL_ID,
            }
          })
          return {
            text,
            jobId: result.jobId,
            resumed: result.resumed,
            fromCache: result.fromCache,
            segments,
          }
        }
        if (!allowStub) {
          throw new Error(
            "NaslukhSpeech не в APK: expo prebuild + JitPack (см. @naslukh/speech-rn README)",
          )
        }
        await delay(800)
        return {
          text: "[заглушка ASR] Нативный модуль не слинкован — соберите Android с NaslukhSpeech.",
          segments: [
            {
              startSample: 0,
              endSample: 16000,
              text: "[заглушка ASR] Нативный модуль не слинкован — соберите Android с NaslukhSpeech.",
              status: "done",
              modelVersion: GIGAAM_MODEL_ID,
            },
          ],
        }
      })
    },

    async listenOnce(options: ListenOnceOptions = {}): Promise<ListenOnceResult> {
      if (options.language && options.language !== "ru") {
        throw new Error('Поддерживается только language: "ru"')
      }
      if (Platform.OS !== "android") {
        throw new Error("listenOnce пока поддерживается только на Android")
      }
      if (!native?.listenOnce) {
        throw new Error(
          "NaslukhSpeech не в APK: соберите Android с нативным модулем (см. @naslukh/speech-rn README)",
        )
      }
      const brands = options.hotwords ?? []
      const correct = (text: string) =>
        correctAsrText(text ?? "", {
          enabled: Boolean(options.correctorEnabled),
          brands,
          brandMinScore: options.brandMinScore ?? 0.72,
        })
      activeListenCorrect = correct
      let result: Awaited<ReturnType<NativeSpeech["listenOnce"]>>
      try {
        result = await native.listenOnce({
          vadThreshold: options.vadThreshold ?? 0.5,
          vadMinSpeechSec: options.vadMinSpeechSec ?? 0.25,
          vadMinSilenceSec: options.vadMinSilenceSec ?? 1.0,
          numThreads: options.numThreads ?? 2,
          startTimeoutSec: options.startTimeoutSec ?? 15,
          maxDurationSec: options.maxDurationSec ?? 30,
          saveAudio: options.saveAudio ?? false,
          audioLevelIntervalMs:
            options.audioLevelIntervalMs ?? (audioLevelListeners > 0 ? DEFAULT_AUDIO_LEVEL_INTERVAL_MS : 0),
          speechPauseMs: options.speechPauseMs ?? 0,
          echoCancellation: options.echoCancellation ?? false,
          continueFromMonitor: options.continueFromMonitor ?? null,
          incrementalDecode: options.incrementalDecode ?? true,
          incrementalPauseMs: options.incrementalPauseMs ?? 400,
          maxSegmentSec: options.maxSegmentSec ?? 8,
          minSegmentSec: options.minSegmentSec ?? 2,
        })
      } finally {
        activeListenCorrect = null
      }
      const pieces = result.segments ?? []
      // Куски склеиваются здесь, затем корректор идёт по склеенному тексту целиком.
      const joined = pieces.length > 1 ? joinSegmentTexts(pieces) : result.text
      const timings = result.timings
      return {
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        text: correct(joined),
        durationMs: result.durationMs,
        ...(result.audioUri ? { audioUri: result.audioUri } : {}),
        ...(timings
          ? {
              timings: {
                finalizeMs: Number(timings.finalizeMs) || 0,
                tailDecodeMs: Number(timings.tailDecodeMs) || 0,
                totalDecodeMs: Number(timings.totalDecodeMs) || 0,
                segments: Number(timings.segments) || pieces.length,
                endSilenceMs: Number(timings.endSilenceMs) || 0,
              },
            }
          : {}),
        segments: pieces.map((segment) => ({
          startSample: segment.startSample,
          endSample: segment.endSample,
          text: correct(segment.text),
          status: segment.status ?? "done",
          modelVersion: segment.modelVersion ?? GIGAAM_MODEL_ID,
        })),
      }
    },

    async cancelListenOnce(): Promise<void> {
      if (!native?.cancelListenOnce) return
      await native.cancelListenOnce()
    },

    async stopListenOnce(): Promise<void> {
      if (!native?.stopListenOnce) return
      await native.stopListenOnce()
    },

    record(_options?: { language: "ru" }): Recording {
      throw new Error("Запись микрофона — в приложении, не в speech-rn")
    },

    addAudioLevelListener(listener: (event: AudioLevelEvent) => void): () => void {
      audioLevelListeners += 1
      const remove = addNativeEventListener<AudioLevelEvent>("onAudioLevel", listener)
      let active = true
      return () => {
        if (!active) return
        active = false
        audioLevelListeners -= 1
        remove()
      }
    },

    addSpeechPauseListener(listener: (event: SpeechPauseEvent) => void): () => void {
      return addNativeEventListener<SpeechPauseEvent>("onSpeechPause", listener)
    },

    addSpeechResumeListener(listener: (event: SpeechResumeEvent) => void): () => void {
      return addNativeEventListener<SpeechResumeEvent>("onSpeechResume", listener)
    },

    addListenSegmentListener(listener: (event: ListenSegmentEvent) => void): () => void {
      return addNativeEventListener<ListenSegmentEvent>("onListenSegment", (event) => {
        const correct = activeListenCorrect
        listener({
          sessionId: String(event.sessionId),
          index: Number(event.index) || 0,
          text: correct ? correct(String(event.text ?? "")) : String(event.text ?? ""),
          startMs: Number(event.startMs) || 0,
          endMs: Number(event.endMs) || 0,
        })
      })
    },

    async monitorSpeech(options: MonitorSpeechOptions = {}): Promise<SpeechMonitor> {
      if (Platform.OS !== "android") {
        throw new Error("monitorSpeech пока поддерживается только на Android")
      }
      if (!native?.startSpeechMonitor) {
        throw new Error(
          "NaslukhSpeech без монитора речи: обновите нативную сборку до @naslukh/speech-rn 0.2.0",
        )
      }
      const id = await native.startSpeechMonitor({
        vadThreshold: options.vadThreshold ?? 0.6,
        minSpeechMs: options.minSpeechMs ?? 300,
        prerollMs: options.prerollMs ?? 600,
        echoCancellation: options.echoCancellation ?? true,
      })
      return new NativeSpeechMonitor(id)
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
