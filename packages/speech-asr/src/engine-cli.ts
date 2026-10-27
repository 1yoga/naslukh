import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { createNodeEngine } from "./engine.ts"
import { GIGAAM_DIR, GIGAAM_MODEL_ID } from "./paths.ts"
import { VAD_FIXTURE } from "./run-file.ts"

const wavPath =
  process.argv[2] === "--fixture"
    ? VAD_FIXTURE
    : (process.argv[2] ?? join(GIGAAM_DIR, "test_wavs", "example.wav"))

const audioDir = mkdtempSync(join(tmpdir(), "naslukh-engine-"))
const db = openNodeSqlite(":memory:")
const engine = createNodeEngine({ db, audioDir })

try {
  await engine.ensureModel(GIGAAM_MODEL_ID)
  const job = engine.transcribeFile({ uri: wavPath, language: "ru" })
  const states: string[] = []
  const segments: string[] = []
  job.on("state", (state) => states.push(state))
  job.on("segment", (segment) => segments.push(segment.text))
  const started = Date.now()
  const result = await job.result()
  console.log(
    JSON.stringify(
      {
        textPreview: result.text.slice(0, 240),
        segments: result.segments.length,
        states,
        segmentPreviews: segments.map((text) => text.slice(0, 80)),
        elapsedMs: Date.now() - started,
        capabilities: engine.capabilities(),
      },
      null,
      2,
    ),
  )
} finally {
  db.close()
}
