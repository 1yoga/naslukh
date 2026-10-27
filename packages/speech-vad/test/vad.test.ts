import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { describe, it } from "node:test"
import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { ensureFile } from "../src/download.ts"
import {
  FIXTURE_WAV_PATH,
  FIXTURE_WAV_URL,
  SILERO_MODEL_PATH,
  SILERO_MODEL_URL,
} from "../src/paths.ts"
import { runVadFile } from "../src/run-file.ts"

describe("speech-vad", () => {
  it("режет тестовый wav и пишет интервалы в store", async () => {
    const modelPath = await ensureFile(SILERO_MODEL_PATH, SILERO_MODEL_URL)
    const wavPath = await ensureFile(FIXTURE_WAV_PATH, FIXTURE_WAV_URL)
    assert.equal(existsSync(modelPath), true)

    const db = openNodeSqlite()
    try {
      const result = runVadFile({
        wavPath,
        modelPath,
        db,
        jobId: "fixture-vad",
      })
      assert.ok(result.intervals.length > 10)
      assert.ok(result.chunks.length > 0)
      assert.ok(result.commits >= 1)
      assert.ok(result.intervals[0].endSample > result.intervals[0].startSample)
      for (let i = 1; i < result.intervals.length; i++) {
        assert.ok(
          result.intervals[i].startSample >= result.intervals[i - 1].endSample,
        )
      }
    } finally {
      db.close()
    }
  })
})
