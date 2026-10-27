import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import ort from "onnxruntime-web"
import {
  GIGAAM_FEATURE_DIM,
  WASM_PROBE_SEC,
} from "../../speech-core/src/index.ts"
import { GIGAAM_DIR, ORT_WASM_DIR, REPO_ROOT } from "./paths.ts"

export interface WasmProbeResult {
  ok: boolean
  runtime: "onnxruntime-web-wasm"
  modelId: string
  loadMs: number
  encoderRunMs: number | null
  probeBudgetSec: typeof WASM_PROBE_SEC
  inputs: {
    encoder: string[]
    decoder: string[]
    joiner: string[]
  }
  encoderOutputDims: number[] | null
  error: string | null
  at: string
}

/**
 * Ворота D6: грузит encoder/decoder/joiner GigaAM в ORT WASM
 * и гоняет короткий проход энкодера.
 */
export async function probeGigaamWasm(
  modelDir = GIGAAM_DIR,
): Promise<WasmProbeResult> {
  const modelId = "gigaam-v3-e2e-rnnt-int8"
  const base: Omit<WasmProbeResult, "ok" | "loadMs" | "encoderRunMs" | "encoderOutputDims" | "error" | "at" | "inputs"> & {
    inputs: WasmProbeResult["inputs"]
  } = {
    runtime: "onnxruntime-web-wasm",
    modelId,
    probeBudgetSec: WASM_PROBE_SEC,
    inputs: { encoder: [], decoder: [], joiner: [] },
  }

  try {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = `${pathToFileURL(ORT_WASM_DIR).href}/`

    const tLoad = Date.now()
    const encoder = await ort.InferenceSession.create(
      readFileSync(join(modelDir, "encoder.int8.onnx")),
      { executionProviders: ["wasm"] },
    )
    const decoder = await ort.InferenceSession.create(
      readFileSync(join(modelDir, "decoder.onnx")),
      { executionProviders: ["wasm"] },
    )
    const joiner = await ort.InferenceSession.create(
      readFileSync(join(modelDir, "joiner.onnx")),
      { executionProviders: ["wasm"] },
    )
    const loadMs = Date.now() - tLoad

    const T = 100
    const audio = new ort.Tensor(
      "float32",
      new Float32Array(GIGAAM_FEATURE_DIM * T),
      [1, GIGAAM_FEATURE_DIM, T],
    )
    const length = new ort.Tensor("int64", BigInt64Array.from([BigInt(T)]), [1])
    const tRun = Date.now()
    const out = await encoder.run({ audio_signal: audio, length })
    const encoderRunMs = Date.now() - tRun

    // Держим ссылки, чтобы сессии не собрал GC до конца пробы.
    void decoder
    void joiner

    return {
      ...base,
      ok: true,
      loadMs,
      encoderRunMs,
      inputs: {
        encoder: [...encoder.inputNames],
        decoder: [...decoder.inputNames],
        joiner: [...joiner.inputNames],
      },
      encoderOutputDims: [...(out.encoded.dims as number[])],
      error: null,
      at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ...base,
      ok: false,
      loadMs: 0,
      encoderRunMs: null,
      encoderOutputDims: null,
      error: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    }
  }
}

export function writeProbeResult(result: WasmProbeResult): string {
  const dir = join(REPO_ROOT, ".cache")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "wasm-probe-gigaam.json")
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)
  return path
}
