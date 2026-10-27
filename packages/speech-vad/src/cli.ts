import { openNodeSqlite } from "../../speech-store/src/node-sqlite.ts"
import { ensureFile } from "./download.ts"
import {
  FIXTURE_WAV_PATH,
  FIXTURE_WAV_URL,
  SILERO_MODEL_PATH,
  SILERO_MODEL_URL,
} from "./paths.ts"
import { runVadFile } from "./run-file.ts"

const wavPath = process.argv[2] ?? FIXTURE_WAV_PATH
const modelPath = await ensureFile(SILERO_MODEL_PATH, SILERO_MODEL_URL)
if (!process.argv[2]) {
  await ensureFile(FIXTURE_WAV_PATH, FIXTURE_WAV_URL)
}

const db = openNodeSqlite(":memory:")
try {
  const result = runVadFile({ wavPath, modelPath, db })
  const seconds = (samples: number) => (samples / 16_000).toFixed(2)
  console.log(
    JSON.stringify(
      {
        jobId: result.jobId,
        durationSec: seconds(result.totalSamples),
        intervals: result.intervals.length,
        chunks: result.chunks.length,
        commits: result.commits,
        firstIntervals: result.intervals.slice(0, 3).map((item) => ({
          startSec: seconds(item.startSample),
          endSec: seconds(item.endSample),
        })),
      },
      null,
      2,
    ),
  )
} finally {
  db.close()
}
