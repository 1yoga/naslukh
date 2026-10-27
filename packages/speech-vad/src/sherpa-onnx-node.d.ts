declare module "sherpa-onnx-node" {
  export interface WaveData {
    sampleRate: number
    samples: Float32Array
  }

  export interface VadSegment {
    start: number
    samples: Float32Array
  }

  export interface SileroVadConfig {
    model: string
    threshold?: number
    minSpeechDuration?: number
    minSilenceDuration?: number
    windowSize?: number
    maxSpeechDuration?: number
  }

  export interface VadConfig {
    sileroVad: SileroVadConfig
    sampleRate: number
    debug?: boolean
    numThreads?: number
  }

  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number)
    acceptWaveform(samples: Float32Array): void
    isDetected(): boolean
    isEmpty(): boolean
    front(): VadSegment
    pop(): void
    flush(): void
  }

  export function readWave(filename: string): WaveData
  export function writeWave(
    filename: string,
    data: { samples: Float32Array; sampleRate: number },
  ): void

  const sherpa: {
    Vad: typeof Vad
    readWave: typeof readWave
    writeWave: typeof writeWave
  }
  export default sherpa
}
