import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  OPUS_BITRATE_BPS,
  SAMPLE_RATE_HZ,
} from "../../speech-core/src/index.ts"
import {
  OPUS_CONTAINER,
  decodeOpus,
  encodeOpus,
  parseHeader,
} from "../src/index.ts"

function tone(seconds: number, hz = 440): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE_HZ))
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.25 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE_HZ)
  }
  return samples
}

describe("speech-audio", () => {
  it("кодирует и декодирует моно 16 кГц при 24 кбит/с", () => {
    const original = tone(1.0)
    const encoded = encodeOpus(original)
    const header = parseHeader(encoded)
    assert.equal(header.bitrate, OPUS_BITRATE_BPS)
    assert.equal(header.sampleRate, SAMPLE_RATE_HZ)

    const decoded = decodeOpus(encoded)
    assert.equal(decoded.bitrate, OPUS_BITRATE_BPS)
    assert.equal(decoded.sampleRate, SAMPLE_RATE_HZ)
    // Декодер отдаёт целые кадры 20 мс — длина не короче исходной больше чем на кадр.
    assert.ok(decoded.samples.length >= original.length - 320)
    assert.ok(decoded.samples.length <= original.length + 320)

    let energy = 0
    const n = Math.min(original.length, decoded.samples.length)
    for (let i = 0; i < n; i++) energy += decoded.samples[i] * decoded.samples[i]
    assert.ok(energy / n > 1e-4)
  })

  it("сжимает сильнее PCM int16", () => {
    const original = tone(2.0)
    const encoded = encodeOpus(original)
    const pcmBytes = original.length * 2
    assert.ok(encoded.byteLength < pcmBytes / 4)
    assert.equal(OPUS_CONTAINER, "nsop")
  })
})
