import type { SpeechCapabilities } from "./types.ts"

const NO_EXTRAS = { partialResults: false as const, tts: false as const }

/** Телефонное приложение. Десять часов — условие выпуска, не испытание на сутки. */
export function nativeAppCapabilities(models: string[]): SpeechCapabilities {
  return {
    recording: true,
    fileTranscription: true,
    background: false,
    reliableStorage: true,
    threads: 2,
    maxRecommendedDurationSec: 10 * 60 * 60,
    models,
    ...NO_EXTRAS,
  }
}

export function desktopWebCapabilities(input: {
  models: string[]
  wasmOk: boolean
  threads: 1 | 2
  storageOk: boolean
}): SpeechCapabilities {
  return {
    recording: false,
    fileTranscription: input.wasmOk && input.storageOk,
    background: false,
    reliableStorage: input.storageOk,
    threads: input.threads,
    maxRecommendedDurationSec: input.wasmOk && input.storageOk ? 2 * 60 * 60 : 0,
    models: input.wasmOk ? input.models : [],
    ...NO_EXTRAS,
  }
}

export function phoneWebCapabilities(input: {
  models: string[]
  probeOk: boolean
}): SpeechCapabilities {
  return {
    recording: false,
    fileTranscription: input.probeOk,
    background: false,
    reliableStorage: false,
    threads: 1,
    maxRecommendedDurationSec: input.probeOk ? 5 * 60 : 0,
    models: input.probeOk ? input.models : [],
    ...NO_EXTRAS,
  }
}

/** Мини-апп и любая среда, где локальная модель не помещается. */
export function unavailableCapabilities(): SpeechCapabilities {
  return {
    recording: false,
    fileTranscription: false,
    background: false,
    reliableStorage: false,
    threads: 1,
    maxRecommendedDurationSec: 0,
    models: [],
    ...NO_EXTRAS,
  }
}
