import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  VAD_COMMIT_SAMPLES,
  planVadCommit,
} from "../../speech-core/src/index.ts"
import {
  commitSegment,
  commitVad,
  createJob,
  listSegments,
  listVadIntervals,
  migrate,
  resumeVadJob,
  setJobAudio,
  setJobState,
} from "../src/index.ts"
import { openNodeSqlite } from "../src/node-sqlite.ts"

const DEVICE = {
  deviceModel: "test",
  osName: "node",
  osVersion: process.versions.node,
}

const MODEL = "gigaam-v3-e2e-rnnt-int8"

describe("speech-store", () => {
  it("пишет интервалы и курсор одной транзакцией", () => {
    const db = openNodeSqlite()
    try {
      migrate(db)
      createJob(db, {
        id: "job-1",
        source: "file",
        modelId: MODEL,
        modelVersion: MODEL,
        audioPath: "/tmp/a.wav",
      })
      setJobState(db, "job-1", "recognizing", "resume", DEVICE)

      const batch = planVadCommit({
        scannedSample: VAD_COMMIT_SAMPLES,
        lastCommittedSample: 0,
        pendingIntervals: [
          { startSample: 0, endSample: 16_000 },
          { startSample: 32_000, endSample: 48_000 },
        ],
        atEnd: false,
      })
      assert.ok(batch)
      const job = commitVad(db, {
        jobId: "job-1",
        intervals: batch.intervals,
        cursorSample: batch.cursorSample,
        device: DEVICE,
      })
      assert.equal(job.vadCursorSample, VAD_COMMIT_SAMPLES)
      assert.equal(listVadIntervals(db, "job-1").length, 2)
    } finally {
      db.close()
    }
  })

  it("после повторного открытия продолжает с курсора и не дублирует интервалы", () => {
    const dir = mkdtempSync(join(tmpdir(), "naslukh-store-"))
    const path = join(dir, "jobs.sqlite")
    try {
      {
        const db = openNodeSqlite(path)
        try {
          migrate(db)
          createJob(db, {
            id: "job-2",
            source: "file",
            modelId: MODEL,
            modelVersion: MODEL,
            audioPath: "/tmp/b.wav",
          })
          setJobState(db, "job-2", "recognizing", "resume", DEVICE)
          commitVad(db, {
            jobId: "job-2",
            intervals: [{ startSample: 0, endSample: 8_000 }],
            cursorSample: VAD_COMMIT_SAMPLES,
            device: DEVICE,
          })
        } finally {
          db.close()
        }
      }

      const db = openNodeSqlite(path)
      try {
        const job = resumeVadJob(db, "job-2", MODEL)
        assert.equal(job.vadCursorSample, VAD_COMMIT_SAMPLES)
        assert.equal(listVadIntervals(db, "job-2").length, 1)

        const next = planVadCommit({
          scannedSample: VAD_COMMIT_SAMPLES * 2,
          lastCommittedSample: job.vadCursorSample,
          pendingIntervals: [
            {
              startSample: VAD_COMMIT_SAMPLES,
              endSample: VAD_COMMIT_SAMPLES + 4_000,
            },
          ],
          atEnd: false,
        })
        assert.ok(next)
        commitVad(db, {
          jobId: "job-2",
          intervals: next.intervals,
          cursorSample: next.cursorSample,
          device: DEVICE,
        })
        assert.equal(listVadIntervals(db, "job-2").length, 2)
        assert.equal(
          resumeVadJob(db, "job-2", MODEL).vadCursorSample,
          VAD_COMMIT_SAMPLES * 2,
        )
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("отклоняет продолжение с другой версией модели", () => {
    const db = openNodeSqlite()
    try {
      migrate(db)
      createJob(db, {
        id: "job-3",
        source: "file",
        modelId: MODEL,
        modelVersion: MODEL,
      })
      setJobState(db, "job-3", "recognizing", "resume", DEVICE)
      assert.throws(
        () => resumeVadJob(db, "job-3", "other-model"),
        /другая модель или версия пайплайна/,
      )
    } finally {
      db.close()
    }
  })

  it("пишет сегмент вместе с курсором распознавания", () => {
    const db = openNodeSqlite()
    try {
      migrate(db)
      createJob(db, {
        id: "job-4",
        source: "file",
        modelId: MODEL,
        modelVersion: MODEL,
      })
      setJobState(db, "job-4", "recognizing", "resume", DEVICE)
      commitSegment(db, {
        jobId: "job-4",
        startSample: 0,
        endSample: 16_000,
        text: "привет",
        status: "done",
        modelVersion: MODEL,
        committedSample: 16_000,
      })
      const job = resumeVadJob(db, "job-4", MODEL)
      assert.equal(job.lastCommittedSample, 16_000)
      assert.equal(listSegments(db, "job-4")[0].text, "привет")
    } finally {
      db.close()
    }
  })

  it("сохраняет путь Opus и отпечаток", () => {
    const db = openNodeSqlite()
    try {
      migrate(db)
      createJob(db, {
        id: "job-5",
        source: "file",
        modelId: MODEL,
        modelVersion: MODEL,
      })
      const job = setJobAudio(db, "job-5", {
        path: "/tmp/a.nsop",
        container: "nsop",
        fingerprintSize: 1000,
        fingerprintSha256: "a".repeat(64),
      })
      assert.equal(job.audioPath, "/tmp/a.nsop")
      assert.equal(job.audioContainer, "nsop")
      assert.equal(job.fingerprintSize, 1000)
    } finally {
      db.close()
    }
  })
})
