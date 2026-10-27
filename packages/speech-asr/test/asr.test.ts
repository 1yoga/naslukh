import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { ensureGigaamModel } from "../src/download.ts"
import { GIGAAM_DIR } from "../src/paths.ts"
import { createGigaamRecognizer } from "../src/recognize.ts"
import { ensureSilero, runAsrFile } from "../src/run-file.ts"
import { SAMPLE_RATE_HZ } from "../../speech-core/src/index.ts"
import sherpa from "sherpa-onnx-node"

describe("speech-asr", () => {
  it("распознаёт короткий русский пример из пакета модели", async () => {
    const modelDir = await ensureGigaamModel()
    const example = join(modelDir, "test_wavs", "example.wav")
    assert.equal(existsSync(example), true)

    const wave = sherpa.readWave(example)
    assert.equal(wave.sampleRate, SAMPLE_RATE_HZ)

    const recognizer = createGigaamRecognizer(modelDir)
    try {
      const transcript = recognizer.decodeChunk(
        { startSample: 0, endSample: wave.samples.length, cutThroughSpeech: false },
        wave.samples,
      )
      const text = transcript.tokens.map((token) => token.token).join("")
      assert.ok(text.length > 0)
      assert.ok(transcript.tokens.length > 0)
      assert.ok(transcript.tokens.every((token) => Number.isFinite(token.centerSec)))
    } finally {
      recognizer.close()
    }
  })

  it("прогоняет короткий файл через VAD и store", async () => {
    const modelDir = await ensureGigaamModel()
    const sileroPath = await ensureSilero()
    const example = join(GIGAAM_DIR, "test_wavs", "example.wav")
    const db = openNodeSqlite()
    try {
      const result = runAsrFile({
        wavPath: example,
        modelDir,
        sileroPath,
        db,
        jobId: "asr-example",
      })
      assert.ok(result.segments >= 1)
      assert.ok(result.text.length > 0)
    } finally {
      db.close()
    }
  })
})
