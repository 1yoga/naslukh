import { requireOptionalNativeModule } from "expo-modules-core"

type ProgressPayload = {
  phase: string
  progress: number
  message: string
}

type ProgressListener = (payload: ProgressPayload) => void

type NativeWithEvents = {
  addListener: (
    eventName: "onProgress",
    listener: (event: ProgressPayload) => void,
  ) => { remove: () => void }
}

function normalize(payload: ProgressPayload | Record<string, unknown>): ProgressPayload {
  const p = payload as ProgressPayload
  return {
    phase: String(p.phase ?? ""),
    progress: typeof p.progress === "number" ? p.progress : Number(p.progress) || 0,
    message: String(p.message ?? ""),
  }
}

/** Подписка на любое событие нативного модуля NaslukhSpeech. */
export function addNativeEventListener<T>(
  eventName: string,
  listener: (payload: T) => void,
): () => void {
  const native = requireOptionalNativeModule("NaslukhSpeech") as {
    addListener?: (name: string, listener: (event: T) => void) => { remove: () => void }
  } | null
  if (!native?.addListener) return () => undefined
  const sub = native.addListener(eventName, listener)
  return () => {
    try {
      sub.remove()
    } catch {
      /* ignore */
    }
  }
}

/** Подписка на прогресс скачивания / ASR с нативного модуля. */
export function addNaslukhProgressListener(listener: ProgressListener): () => void {
  const native = requireOptionalNativeModule("NaslukhSpeech") as NativeWithEvents | null
  if (!native?.addListener) return () => undefined
  const sub = native.addListener("onProgress", (raw) => {
    listener(normalize(raw))
  })
  return () => {
    try {
      sub.remove()
    } catch {
      /* ignore */
    }
  }
}
