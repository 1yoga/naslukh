export type AsrProgress = {
  status: string
  file: string
  loaded: number
  total: number
  progress: number
}

type WorkerResponse =
  | ({ type: 'progress' } & AsrProgress)
  | { type: 'ready' }
  | { type: 'working'; id: number }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; message: string }

type Pending = {
  resolve: (text: string) => void
  reject: (error: Error) => void
  onProgress?: (progress: AsrProgress) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/asr.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    if (message.type === 'progress') {
      for (const job of pending.values()) job.onProgress?.(message)
      return
    }
    if (message.type === 'ready') return
    if (message.type === 'working') {
      pending.get(message.id)?.onProgress?.({
        status: 'working',
        file: '',
        loaded: 0,
        total: 0,
        progress: 100,
      })
      return
    }
    const job = pending.get(message.id)
    if (!job) return
    pending.delete(message.id)
    if (message.type === 'result') job.resolve(message.text)
    else job.reject(new Error(message.message))
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Сбой распознавания')
    for (const [id, job] of pending) {
      pending.delete(id)
      job.reject(error)
    }
  }
  return worker
}

export function transcribeOnDevice(
  audio: Float32Array,
  onProgress?: (progress: AsrProgress) => void,
): Promise<string> {
  const id = nextId
  nextId += 1
  const copy = new Float32Array(audio)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ type: 'transcribe', id, audio: copy }, [copy.buffer])
  })
}
