import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(HERE, "..", "..", "..")

export const CACHE_DIR = join(REPO_ROOT, ".cache")
export const MODEL_DIR = join(CACHE_DIR, "models")
export const FIXTURE_DIR = join(CACHE_DIR, "fixtures")

export const SILERO_MODEL_PATH = join(MODEL_DIR, "silero_vad.onnx")
export const SILERO_MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"

export const FIXTURE_WAV_PATH = join(FIXTURE_DIR, "lei-jun-test.wav")
export const FIXTURE_WAV_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/lei-jun-test.wav"

export const SILERO_MODEL_ID = "silero-vad"

export function ensureCacheDirs(): void {
  mkdirSync(MODEL_DIR, { recursive: true })
  mkdirSync(FIXTURE_DIR, { recursive: true })
}
