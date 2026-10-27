declare module "onnxruntime-web" {
  export class Tensor {
    constructor(
      type: string,
      data: Float32Array | BigInt64Array | Int32Array,
      dims: number[],
    )
    readonly dims: readonly number[]
    readonly data: Float32Array | BigInt64Array | Int32Array
  }

  export class InferenceSession {
    static create(
      model: Uint8Array | string,
      options?: { executionProviders?: string[] },
    ): Promise<InferenceSession>
    readonly inputNames: string[]
    readonly outputNames: string[]
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>
  }

  const ort: {
    Tensor: typeof Tensor
    InferenceSession: typeof InferenceSession
    env: {
      wasm: {
        numThreads: number
        wasmPaths: string
      }
    }
  }
  export default ort
}
