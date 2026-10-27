import { readFileSync } from "node:fs"
import { SAMPLE_RATE_HZ } from "../../speech-core/src/index.ts"
import { int16ToFloat } from "./pcm.ts"

/** Читает PCM WAV: моно, 16 бит, 16 кГц (или ресемпл линейный до 16 кГц). */
export function readWavPcm16(path: string): {
  samples: Float32Array
  sampleRate: number
} {
  const bytes = readFileSync(path)
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Нужен WAV (RIFF/WAVE)")
  }

  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let data: Buffer | null = null

  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === "fmt ") {
      const format = bytes.readUInt16LE(start)
      if (format !== 1) throw new Error("Нужен PCM WAV")
      channels = bytes.readUInt16LE(start + 2)
      sampleRate = bytes.readUInt32LE(start + 4)
      bitsPerSample = bytes.readUInt16LE(start + 14)
    } else if (id === "data") {
      data = bytes.subarray(start, start + size)
      break
    }
    offset = start + size + (size % 2)
  }

  if (!data) throw new Error("В WAV нет data")
  if (channels !== 1) throw new Error("Нужен моно WAV")
  if (bitsPerSample !== 16) throw new Error("Нужен 16-битный PCM")

  const pcm = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2)
  const float = int16ToFloat(pcm)
  if (sampleRate === SAMPLE_RATE_HZ) {
    return { samples: float, sampleRate }
  }
  return { samples: resampleLinear(float, sampleRate, SAMPLE_RATE_HZ), sampleRate: SAMPLE_RATE_HZ }
}

function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, input.length - 1)
    const weight = position - left
    output[i] = input[left] * (1 - weight) + input[right] * weight
  }
  return output
}
