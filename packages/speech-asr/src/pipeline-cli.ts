import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { ensureGigaamModel } from "./download.ts"
import { runImportPipeline } from "./pipeline.ts"
import { ensureSilero, VAD_FIXTURE } from "./run-file.ts"
import { GIGAAM_DIR } from "./paths.ts"

const wavPath =
  process.argv[2] ?? join(GIGAAM_DIR, "test_wavs", "example.wav")
const modelDir = await ensureGigaamModel()
const sileroPath = await ensureSilero()
const audioDir = mkdtempSync(join(tmpdir(), "naslukh-pipeline-"))

const db = openNodeSqlite(":memory:")
try {
  const started = Date.now()
  const result = await runImportPipeline({
    wavPath: wavPath === "--fixture" ? VAD_FIXTURE : wavPath,
    modelDir,
    sileroPath,
    db,
    audioDir,
    jobId: "pipeline-1",
  })
  console.log(
    JSON.stringify(
      {
        jobId: result.jobId,
        reusedImport: result.reusedImport,
        container: result.container,
        audioPath: result.audioPath,
        segments: result.segments,
        chunks: result.chunks,
        elapsedMs: Date.now() - started,
        textPreview: result.text.slice(0, 240),
      },
      null,
      2,
    ),
  )
} finally {
  db.close()
}
