/**
 * Стенд: naslukh ASR vs пример транскрипта (часто Gemini).
 * Gemini ≠ истина — только ориентир для сравнения.
 *
 * — из reference: diarization без ролей/таймкодов
 * — trim аудио с первого [mm:ss] речи
 * — если Gemini сам написал «неразборчиво» — кейс вне сводных WER
 *
 *   npm run asr:bench
 *   npm run asr:bench -- --case case-001
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { openNodeSqlite } from "../../../packages/speech-store/src/node-sqlite.ts"
import { createNodeEngine } from "../../../packages/speech-asr/src/engine.ts"
import { GIGAAM_MODEL_ID } from "../../../packages/speech-asr/src/paths.ts"
import { parseReference } from "./extract-ref.ts"
import { scoreTask, type TaskScore } from "./task-score.ts"
import { median, wordErrorRate } from "./wer.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, "..")
const SAMPLES = join(APP, "samples")
const OUT = join(APP, "out")

/** Не режем крошечный offset — VAD pad и так съест. */
const MIN_TRIM_SEC = 0.5

const AUDIO_NAMES = [
  "audio.wav",
  "audio.m4a",
  "audio.mp3",
  "audio.ogg",
  "audio.webm",
  "audio.flac",
]

type CaseResult = {
  id: string
  audio: string
  referenceChars: number
  asrChars: number
  elapsedMs: number
  wer: number
  refWords: number
  edits: number
  startSec: number
  unscorable: boolean
  unscorableReason?: string
  referencePreview: string
  asrPreview: string
  task?: TaskScore
  error?: string
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** ` --case id ` или позиционный `case-00N`. */
function caseFilter(): string | undefined {
  return (
    argValue("--case") ??
    argValue("--only") ??
    process.argv.find((a) => /^case-\d+/i.test(a) || /^[a-z0-9_-]+$/i.test(a) && a.startsWith("case-"))
  )
}

function findFfmpeg(): string | null {
  try {
    const require = createRequire(join(HERE, "../package.json"))
    const packed = require("ffmpeg-static") as string | null
    if (packed && existsSync(packed)) return packed
  } catch {
    /* optional */
  }
  const where = spawnSync("where.exe", ["ffmpeg"], { encoding: "utf8" })
  if (where.status === 0) {
    const first = where.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    if (first) return first
  }
  for (const c of [
    "ffmpeg",
    "D:\\Android\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
  ]) {
    const r = spawnSync(c, ["-version"], { encoding: "utf8" })
    if (r.status === 0) return c
  }
  return null
}

/**
 * WAV 16 kHz mono; при startSec>0 — срез с таймкода эталона
 * (чтобы intro магазина не штрафовал insertions).
 */
function ensureWav(
  audioPath: string,
  workDir: string,
  ffmpeg: string | null,
  startSec = 0,
): string {
  const trim = startSec >= MIN_TRIM_SEC ? startSec : 0
  const tag = trim > 0 ? `.from${Math.round(trim)}` : ""
  const out = join(workDir, `audio.16k${tag}.wav`)

  if (audioPath.toLowerCase().endsWith(".wav") && trim <= 0) return audioPath

  if (!ffmpeg) {
    throw new Error(
      `Нужен WAV 16 kHz или ffmpeg в PATH (файл: ${audioPath})`,
    )
  }
  if (existsSync(out) && statSync(out).size > 1000) return out

  const tmp = join(workDir, `audio.16k${tag}.${process.pid}.wav`)
  const args = ["-y", "-i", audioPath]
  if (trim > 0) args.push("-ss", String(trim))
  args.push("-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp)

  const r = spawnSync(ffmpeg, args, { encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(`ffmpeg: ${r.stderr?.slice(-400) || r.stdout}`)
  }
  try {
    if (existsSync(out)) return tmp
    renameSync(tmp, out)
    return out
  } catch {
    return tmp
  }
}

function listCases(only?: string): { id: string; dir: string; audio: string; reference: string }[] {
  if (!existsSync(SAMPLES)) {
    mkdirSync(SAMPLES, { recursive: true })
    return []
  }
  const ids = readdirSync(SAMPLES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => !only || id === only)
    .sort()

  const cases = []
  for (const id of ids) {
    const dir = join(SAMPLES, id)
    const reference = join(dir, "reference.txt")
    if (!existsSync(reference)) {
      console.warn(`skip ${id}: нет reference.txt`)
      continue
    }
    const audioName = AUDIO_NAMES.find((n) => existsSync(join(dir, n)))
    if (!audioName) {
      console.warn(`skip ${id}: нет audio.wav/m4a/...`)
      continue
    }
    cases.push({ id, dir, audio: join(dir, audioName), reference })
  }
  return cases
}

async function main() {
  const only = caseFilter()
  const cases = listCases(only)
  mkdirSync(OUT, { recursive: true })

  if (!cases.length) {
    console.log(`Нет сэмплов в ${SAMPLES}`)
    console.log(`Создай папку, например:`)
    console.log(`  ${join(SAMPLES, "case-001", "audio.wav")}`)
    console.log(`  ${join(SAMPLES, "case-001", "reference.txt")}`)
    writeFileSync(
      join(SAMPLES, "README.txt"),
      "Положи сюда case-*/audio.wav + case-*/reference.txt\n",
      "utf8",
    )
    process.exit(0)
  }

  const ffmpeg = findFfmpeg()
  console.log(`cases: ${cases.length}${only ? ` (only ${only})` : ""}`)
  console.log(`ffmpeg: ${ffmpeg ?? "нет (только .wav)"}`)

  const audioDir = mkdtempSync(join(tmpdir(), "naslukh-bench-"))
  const db = openNodeSqlite(":memory:")
  const engine = createNodeEngine({ db, audioDir })
  const results: CaseResult[] = []

  try {
    console.log("ensureModel…")
    await engine.ensureModel(GIGAAM_MODEL_ID)

    for (const [i, c] of cases.entries()) {
      console.log(`\n[${i + 1}/${cases.length}] ${c.id}`)
      try {
        const referenceRaw = readFileSync(c.reference, "utf8")
        const parsed = parseReference(referenceRaw)
        writeFileSync(join(c.dir, "reference.clean.txt"), parsed.text, "utf8")

        if (parsed.unscorable) {
          console.log(`  skip score: ${parsed.unscorableReason}`)
        }
        if (parsed.startSec >= MIN_TRIM_SEC) {
          console.log(`  trim audio from ${parsed.startSec.toFixed(0)}s (first timestamp)`)
        }

        const wav = ensureWav(c.audio, c.dir, ffmpeg, parsed.startSec)
        const started = Date.now()
        const job = engine.transcribeFile({ uri: wav, language: "ru" })
        job.on("progress", (p) => {
          if (p.ratio != null) {
            process.stdout.write(`\r  progress ${(p.ratio * 100).toFixed(0)}%   `)
          }
        })
        const result = await job.result()
        process.stdout.write("\n")
        const elapsedMs = Date.now() - started
        const score = wordErrorRate(parsed.text, result.text)
        const task = scoreTask(referenceRaw, parsed.text, result.text)
        writeFileSync(join(c.dir, "naslukh.txt"), result.text, "utf8")

        const row: CaseResult = {
          id: c.id,
          audio: c.audio,
          referenceChars: parsed.text.length,
          asrChars: result.text.length,
          elapsedMs,
          wer: score.wer,
          refWords: score.refWords,
          edits: score.edits,
          startSec: parsed.startSec,
          unscorable: parsed.unscorable,
          unscorableReason: parsed.unscorableReason,
          referencePreview: parsed.text.slice(0, 200),
          asrPreview: result.text.slice(0, 200),
          task,
        }
        results.push(row)
        const tag = parsed.unscorable ? " (unscorable)" : ""
        const rc = task.royalCaninExpected
          ? task.royalCaninHit
            ? "RC✓"
            : "RC✗"
          : "RC—"
        console.log(
          `  WER ${(score.wer * 100).toFixed(1)}%${tag}  |  brands ${(task.brandRecall * 100).toFixed(0)}%  |  ${rc}  |  ${elapsedMs} ms  |  ${result.text.length} chars`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  FAIL: ${msg}`)
        results.push({
          id: c.id,
          audio: c.audio,
          referenceChars: 0,
          asrChars: 0,
          elapsedMs: 0,
          wer: 1,
          refWords: 0,
          edits: 0,
          startSec: 0,
          unscorable: false,
          referencePreview: "",
          asrPreview: "",
          error: msg,
        })
      }
    }
  } finally {
    db.close()
  }

  const reportPath = join(OUT, "report.json")
  writeFileSync(reportPath, JSON.stringify(results, null, 2), "utf8")

  const scored = results.filter((r) => !r.error && !r.unscorable)
  if (scored.length) {
    const avg = scored.reduce((s, r) => s + r.wer, 0) / scored.length
    const med = median(scored.map((r) => r.wer))
    const microEdits = scored.reduce((s, r) => s + r.edits, 0)
    const microWords = scored.reduce((s, r) => s + r.refWords, 0)
    const micro = microWords ? microEdits / microWords : 0
    const brandAvg =
      scored.reduce((s, r) => s + (r.task?.brandRecall ?? 0), 0) / scored.length
    const keyAvg =
      scored.reduce((s, r) => s + (r.task?.keyphraseRecall ?? 0), 0) /
      scored.length
    const rcCases = scored.filter((r) => r.task?.royalCaninExpected)
    const rcHits = rcCases.filter((r) => r.task?.royalCaninHit).length
    const rcRate = rcCases.length ? rcHits / rcCases.length : 1
    console.log(`\nScored ${scored.length}/${results.length} (skipped unscorable/errors)`)
    console.log(`  Macro Avg WER ${(avg * 100).toFixed(1)}%`)
    console.log(`  Median WER    ${(med * 100).toFixed(1)}%`)
    console.log(`  Micro WER     ${(micro * 100).toFixed(1)}%  (${microEdits}/${microWords} words)`)
    console.log(`  Brand overlap  ${(brandAvg * 100).toFixed(1)}%  (vs Gemini-пример, не GT)`)
    console.log(`  Keyphrase      ${(keyAvg * 100).toFixed(1)}%`)
    console.log(`  Royal Canin    ${(rcRate * 100).toFixed(1)}% (${rcHits}/${rcCases.length})`)
    console.log(`  Note: Gemini — пример, не разметка истины`)
  }
  const skipped = results.filter((r) => r.unscorable)
  if (skipped.length) {
    console.log(`Unscorable: ${skipped.map((r) => r.id).join(", ")}`)
  }
  console.log(`Report: ${reportPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
