import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { SAMPLE_RATE_HZ } from "../../speech-core/src/index.ts"
import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { importWavFile } from "../src/import-file.ts"
import { floatToInt16 } from "../src/pcm.ts"

function writeToneWav(path: string, seconds = 0.5): void {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE_HZ))
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE_HZ)
  }
  const pcm = floatToInt16(samples)
  const dataSize = pcm.byteLength
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE_HZ, 24)
  buffer.writeUInt32LE(SAMPLE_RATE_HZ * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buffer, 44)
  writeFileSync(path, buffer)
}

describe("импорт WAV", () => {
  it("создаёт задание с NSOP и отпечатком, второй раз переиспользует", async () => {
    const dir = mkdtempSync(join(tmpdir(), "naslukh-import-"))
    const wavPath = join(dir, "tone.wav")
    const audioDir = join(dir, "audio")
    writeToneWav(wavPath)

    const db = openNodeSqlite()
    try {
      const first = await importWavFile({
        wavPath,
        db,
        audioDir,
        jobId: "imp-1",
        modelId: "gigaam-v3-e2e-rnnt-int8",
        modelVersion: "gigaam-v3-e2e-rnnt-int8",
      })
      assert.equal(first.reused, false)
      assert.equal(first.job.audioContainer, "nsop")
      assert.ok(first.job.audioPath?.endsWith("imp-1.nsop"))
      assert.equal(first.sourceFingerprint.sha256.length, 64)
      assert.ok(first.samples > 0)

      const second = await importWavFile({
        wavPath,
        db,
        audioDir,
        jobId: "imp-2",
        modelId: "gigaam-v3-e2e-rnnt-int8",
        modelVersion: "gigaam-v3-e2e-rnnt-int8",
      })
      assert.equal(second.reused, true)
      assert.equal(second.job.id, "imp-1")
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
