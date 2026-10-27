import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(HERE, "..", "..", "..")
export const CACHE_DIR = join(REPO_ROOT, ".cache")
export const MODEL_DIR = join(CACHE_DIR, "models")
export const FIXTURE_DIR = join(CACHE_DIR, "fixtures")

export const GIGAAM_DIR_NAME =
  "sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16"
export const GIGAAM_DIR = join(MODEL_DIR, GIGAAM_DIR_NAME)
export const GIGAAM_TAR = join(MODEL_DIR, "gigaam-v3.tar.bz2")
export const GIGAAM_TAR_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16.tar.bz2"

export const GIGAAM_MODEL_ID = "gigaam-v3-e2e-rnnt-int8"
export const GIGAAM_FEATURE_DIM = 64

export function ensureCacheDirs(): void {
  mkdirSync(MODEL_DIR, { recursive: true })
  mkdirSync(FIXTURE_DIR, { recursive: true })
}

export function gigaamFiles(dir = GIGAAM_DIR) {
  return {
    encoder: join(dir, "encoder.int8.onnx"),
    decoder: join(dir, "decoder.onnx"),
    joiner: join(dir, "joiner.onnx"),
    tokens: join(dir, "tokens.txt"),
  }
}
