import { mkdirSync } from "node:fs"
import { freemem } from "node:os"
import { join } from "node:path"
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
} from "../../speech-core/src/index.ts"
import { listSegments } from "../../speech-store/src/index.ts"
import type { SqlDatabase } from "../../speech-store/src/index.ts"
import { ensureGigaamModel } from "./download.ts"
import { runImportPipeline } from "./pipeline.ts"
import { GIGAAM_MODEL_ID } from "./paths.ts"
import { ensureSilero } from "./run-file.ts"

export interface NodeEngineOptions {
  db: SqlDatabase
  /** Каталог для .nsop импорта. */
  audioDir: string
  /** Готовый каталог GigaAM; иначе скачается при ensureModel. */
  modelDir?: string
  sileroPath?: string
  freeMemoryBytes?: number
  device?: {
    deviceModel: string
    osName: string
    osVersion: string
  }
}

type HandlerMap = {
  progress: JobHandler<Progress>[]
  segment: JobHandler<Segment>[]
  state: JobHandler<JobState>[]
}

type JobRunner = (hooks: {
  onState: (state: JobState) => void
  onProgress: (progress: Progress) => void
  onSegment: (segment: Segment) => void
  isCancelled: () => boolean
}) => Promise<TranscriptionResult>

class NodeFileJob implements TranscriptionJob {
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
  private readonly run: JobRunner

  constructor(run: JobRunner) {
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
    await this.execute()
  }

  async pause(): Promise<void> {
    throw new Error("Пауза файла в Node-харнессе пока не поддерживается")
  }

  async resume(): Promise<void> {
    throw new Error("Пауза файла в Node-харнессе пока не поддерживается")
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
      void this.start().catch(() => {
        /* ошибка уйдёт в resultPromise */
      })
    }
    return this.resultPromise
  }

  private async execute(): Promise<void> {
    try {
      const value = await this.run({
        onState: (state) => this.emitState(state),
        onProgress: (progress) => {
          for (const handler of this.handlers.progress) handler(progress)
        },
        onSegment: (segment) => {
          for (const handler of this.handlers.segment) handler(segment)
        },
        isCancelled: () => this.cancelled,
      })
      if (this.cancelled) {
        this.emitState("cancelled")
        this.rejectResult(new Error("Задание отменено"))
        return
      }
      this.resolveResult(value)
    } catch (error) {
      this.emitState("failed")
      this.rejectResult(error)
    }
  }

  private emitState(state: JobState): void {
    for (const handler of this.handlers.state) handler(state)
  }
}

/**
 * Node-оболочка контракта SpeechEngine поверх импорт-пайплайна.
 * Микрофон не пишет — только файл. Пауза длинного файла — в speech-rn.
 */
export function createNodeEngine(options: NodeEngineOptions): SpeechEngine {
  mkdirSync(options.audioDir, { recursive: true })
  let modelDir = options.modelDir ?? null
  let sileroPath = options.sileroPath ?? null
  let jobSeq = 0

  return {
    capabilities(): SpeechCapabilities {
      return {
        recording: false,
        fileTranscription: true,
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
      modelDir = await ensureGigaamModel()
      sileroPath = await ensureSilero()
    },

    transcribeFile(source: FileSource): TranscriptionJob {
      if (source.language !== "ru") {
        throw new Error("Поддерживается только language: \"ru\"")
      }
      const jobId = `engine-${Date.now()}-${++jobSeq}`
      const wavPath = source.uri

      return new NodeFileJob(async (hooks) => {
        if (!modelDir || !sileroPath) {
          modelDir = await ensureGigaamModel()
          sileroPath = await ensureSilero()
        }
        if (hooks.isCancelled()) throw new Error("Задание отменено")

        const pipeline = await runImportPipeline({
          wavPath,
          modelDir,
          sileroPath,
          db: options.db,
          audioDir: options.audioDir,
          jobId,
          freeMemoryBytes: options.freeMemoryBytes ?? freemem(),
          device: options.device,
          hooks: {
            onState: hooks.onState,
            onProgress: hooks.onProgress,
            onSegment: hooks.onSegment,
          },
        })

        const segments = listSegments(options.db, pipeline.jobId).map(
          (row) =>
            ({
              startSample: row.startSample,
              endSample: row.endSample,
              text: row.text,
              status: row.status,
              modelVersion: row.modelVersion,
            }) satisfies Segment,
        )

        return {
          text: pipeline.text || segments.map((segment) => segment.text).join(""),
          segments,
        }
      })
    },

    record(_options?: { language: "ru" }): Recording {
      throw new Error("Node-харнесс не пишет с микрофона; используйте speech-rn")
    },
  }
}

/** Удобный путь к NSOP внутри audioDir движка. */
export function engineAudioPath(audioDir: string, jobId: string): string {
  return join(audioDir, `${jobId}.nsop`)
}
