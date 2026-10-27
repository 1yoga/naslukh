import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const copies = [
  [
    'node_modules/piper-tts-web/dist/onnx/ort-wasm-simd-threaded.wasm',
    'public/onnx/ort-wasm-simd-threaded.wasm',
  ],
  [
    'node_modules/piper-tts-web/dist/onnx/ort-wasm-simd-threaded.jsep.wasm',
    'public/onnx/ort-wasm-simd-threaded.jsep.wasm',
  ],
  [
    'node_modules/piper-tts-web/dist/piper/piper_phonemize.wasm',
    'public/piper/piper_phonemize.wasm',
  ],
  [
    'node_modules/piper-tts-web/dist/piper/piper_phonemize.data',
    'public/piper/piper_phonemize.data',
  ],
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
    'public/asr-wasm/ort-wasm-simd-threaded.wasm',
  ],
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
    'public/asr-wasm/ort-wasm-simd-threaded.mjs',
  ],
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
    'public/asr-wasm/ort-wasm-simd-threaded.jsep.wasm',
  ],
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs',
    'public/asr-wasm/ort-wasm-simd-threaded.jsep.mjs',
  ],
]

for (const [from, to] of copies) {
  const destination = join(root, to)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(join(root, from), destination)
}

console.log(`copied ${copies.length} wasm files into public/`)
