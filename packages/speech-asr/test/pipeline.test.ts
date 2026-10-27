import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { ensureGigaamModel } from "../src/download.ts"
import { runImportPipeline } from "../src/pipeline.ts"
import { GIGAAM_DIR } from "../src/paths.ts"
import { ensureSilero } from "../src/run-file.ts"

describe("import pipeline", () => {
  it("прогоняет WAV через NSOP, VAD и GigaAM", async () => {
    const modelDir = await ensureGigaamModel()
    const sileroPath = await ensureSilero()
    const wavPath = join(GIGAAM_DIR, "test_wavs", "example.wav")
    const audioDir = mkdtempSync(join(tmpdir(), "naslukh-pipe-"))
    const db = openNodeSqlite()
    try {
      const result = await runImportPipeline({
        wavPath,
        modelDir,
        sileroPath,
        db,
        audioDir,
        jobId: "pipe-example",
      })
      assert.equal(result.reusedImport, false)
      assert.equal(result.container, "nsop")
      assert.ok(result.audioPath.endsWith("pipe-example.nsop"))
      assert.ok(result.segments >= 1)
      assert.ok(result.text.length > 0)
    } finally {
      db.close()
      rmSync(audioDir, { recursive: true, force: true })
    }
  })
})
