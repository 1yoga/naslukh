import { OnnxWebRuntime, PiperWebEngine } from 'piper-tts-web'

export const VOICE_ID = 'ru_RU-irina-medium'
export const VOICE_BYTES = 63_201_294

let engine: PiperWebEngine | null = null

function getEngine(): PiperWebEngine {
  if (engine) return engine
  const cores = navigator.hardwareConcurrency || 2
  engine = new PiperWebEngine({
    onnxRuntime: new OnnxWebRuntime({
      numThreads: self.crossOriginIsolated ? Math.min(4, cores) : 1,
    }),
  })
  return engine
}

export async function synthesizeRussian(text: string): Promise<Blob> {
  const spoken = text.trim()
  if (!spoken) throw new Error('Нечего произносить')
  if (!self.crossOriginIsolated) {
    throw new Error('Браузер не изолировал страницу, поэтому голос не запускается. Обновите вкладку.')
  }
  const result = await getEngine().generate(spoken, VOICE_ID, 0)
  return result.file
}
