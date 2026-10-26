declare module 'piper-tts-web' {
  export class OnnxWebRuntime {
    constructor(options?: { numThreads?: number; basePath?: string })
  }

  export class PiperWebEngine {
    constructor(options?: { onnxRuntime?: OnnxWebRuntime })
    generate(
      text: string,
      voice: string,
      speaker?: number,
    ): Promise<{
      file: Blob
      duration: number
    }>
    destroy(): void
  }
}
