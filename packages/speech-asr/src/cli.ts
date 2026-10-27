import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { ensureGigaamModel } from "./download.ts"
import { ensureSilero, runAsrFile, VAD_FIXTURE } from "./run-file.ts"

const wavPath = process.argv[2] ?? VAD_FIXTURE
const modelDir = await ensureGigaamModel()
const sileroPath = await ensureSilero()

const db = openNodeSqlite(":memory:")
try {
  const started = Date.now()
  const result = runAsrFile({ wavPath, modelDir, sileroPath, db })
  console.log(
    JSON.stringify(
      {
        jobId: result.jobId,
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
