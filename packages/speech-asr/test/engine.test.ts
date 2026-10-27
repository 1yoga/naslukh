import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import type { JobState, Progress, Segment } from "../../speech-core/src/index.ts"
import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { createNodeEngine } from "../src/engine.ts"
import { ensureGigaamModel } from "../src/download.ts"
import { GIGAAM_DIR, GIGAAM_MODEL_ID } from "../src/paths.ts"
import { ensureSilero } from "../src/run-file.ts"

describe("node SpeechEngine", () => {
  it("транскрибирует файл через контракт SpeechEngine", async () => {
    const modelDir = await ensureGigaamModel()
    const sileroPath = await ensureSilero()
    const wavPath = join(GIGAAM_DIR, "test_wavs", "example.wav")
    const audioDir = mkdtempSync(join(tmpdir(), "naslukh-engine-"))
    const db = openNodeSqlite()
    try {
      const engine = createNodeEngine({ db, audioDir, modelDir, sileroPath })
      assert.equal(engine.capabilities().fileTranscription, true)
      assert.equal(engine.capabilities().recording, false)

      await engine.ensureModel(GIGAAM_MODEL_ID)

      const job = engine.transcribeFile({ uri: wavPath, language: "ru" })
      const states: JobState[] = []
      const segments: Segment[] = []
      const progress: Progress[] = []
      job.on("state", (state) => states.push(state))
      job.on("segment", (segment) => segments.push(segment))
      job.on("progress", (item) => progress.push(item))

      const result = await job.result()
      assert.ok(result.text.length > 0)
      assert.ok(result.segments.length >= 1)
      assert.ok(states.includes("recognizing"))
      assert.ok(states.includes("done"))
      assert.equal(segments.length, result.segments.length)
      assert.ok(progress.length >= 1)
      assert.equal(progress.at(-1)?.state, "done")
    } finally {
      db.close()
      rmSync(audioDir, { recursive: true, force: true })
    }
  })

  it("отклоняет запись с микрофона", () => {
    const audioDir = mkdtempSync(join(tmpdir(), "naslukh-engine-"))
    const db = openNodeSqlite()
    try {
      const engine = createNodeEngine({ db, audioDir })
      assert.throws(() => engine.record({ language: "ru" }), /микрофона/)
    } finally {
      db.close()
      rmSync(audioDir, { recursive: true, force: true })
    }
  })
})
