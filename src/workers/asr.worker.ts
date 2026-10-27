import { env, pipeline } from '@huggingface/transformers'

const MODEL_ID = 'onnx-community/whisper-base'

type Incoming = {
  type: 'transcribe'
  id: number
  audio: Float32Array
}

type ProgressEvent = {
  status?: string
  file?: string
  loaded?: number
  total?: number
  progress?: number
}

type Transcriber = (
  audio: Float32Array,
  options: {
    language: string
    task: string
    chunk_length_s?: number
    stride_length_s?: number
  },
) => Promise<{ text: string } | Array<{ text: string }>>

let transcriber: Transcriber | null = null
const downloads = new Map<string, { loaded: number; total: number }>()

function post(message: Record<string, unknown>) {
  self.postMessage(message)
}

function configureRuntime() {
  env.allowLocalModels = false
  const wasm = env.backends.onnx?.wasm
  if (!wasm) return
  wasm.wasmPaths = `${self.location.origin}/asr-wasm/`
  wasm.numThreads = 1
}

async function loadModel() {
  if (transcriber) return
  configureRuntime()
  const created = await pipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (event: ProgressEvent) => {
      if (!event.file) return
      if (event.status === 'progress') {
        downloads.set(event.file, {
          loaded: event.loaded ?? 0,
          total: event.total ?? 0,
        })
      }
      let loaded = 0
      let total = 0
      for (const item of downloads.values()) {
        loaded += item.loaded
        total += item.total
      }
      post({
        type: 'progress',
        status: event.status ?? 'progress',
        file: event.file,
        loaded,
        total,
        progress: total > 0 ? Math.min(100, (loaded / total) * 100) : (event.progress ?? 0),
      })
    },
  })
  transcriber = created as Transcriber
  post({ type: 'ready' })
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const { id, audio } = event.data
  try {
    if (!self.crossOriginIsolated) {
      throw new Error(
        'Браузер не изолировал страницу, поэтому модель не может запустить потоки. Обновите вкладку.',
      )
    }
    await loadModel()
    post({ type: 'working', id })
    const seconds = audio.length / 16_000
    const result = await transcriber!(audio, {
      language: 'russian',
      task: 'transcribe',
      ...(seconds > 28 ? { chunk_length_s: 20, stride_length_s: 3 } : {}),
    })
    const text = Array.isArray(result) ? result.map((item) => item.text).join(' ') : result.text
    post({ type: 'result', id, text: text.trim() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось распознать речь'
    post({ type: 'error', id, message })
  }
}
