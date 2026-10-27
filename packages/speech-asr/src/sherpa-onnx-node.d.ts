declare module "sherpa-onnx-node" {
  export interface WaveData {
    sampleRate: number
    samples: Float32Array
  }

  export interface OfflineRecognizerResult {
    text: string
    tokens?: string[]
    timestamps?: number[]
  }

  export interface OfflineStream {
    acceptWaveform(data: { samples: Float32Array; sampleRate: number }): void
  }

  export interface OfflineRecognizer {
    createStream(): OfflineStream
    decode(stream: OfflineStream): void
    getResult(stream: OfflineStream): OfflineRecognizerResult
  }

  export interface OfflineRecognizerConstructor {
    new (config: Record<string, unknown>): OfflineRecognizer
  }

  export interface VadSegment {
    start: number
    samples: Float32Array
  }

  export class Vad {
    constructor(config: Record<string, unknown>, bufferSizeInSeconds: number)
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
    OfflineRecognizer: OfflineRecognizerConstructor
    readWave: typeof readWave
    writeWave: typeof writeWave
  }
  export default sherpa
}
