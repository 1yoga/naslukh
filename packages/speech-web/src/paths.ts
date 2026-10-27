import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(HERE, "..", "..", "..")
export const GIGAAM_DIR = join(
  REPO_ROOT,
  ".cache",
  "models",
  "sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16",
)
export const ORT_WASM_DIR = join(
  REPO_ROOT,
  "node_modules",
  "onnxruntime-web",
  "dist",
)
