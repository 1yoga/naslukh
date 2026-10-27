/** Float32 [-1, 1] → Int16 LE. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]))
    out[i] = clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff)
  }
  return out
}

/** Int16 → Float32 [-1, 1]. */
export function int16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] < 0 ? samples[i] / 0x8000 : samples[i] / 0x7fff
  }
  return out
}

export function bytesToInt16(bytes: Uint8Array): Int16Array {
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
}
