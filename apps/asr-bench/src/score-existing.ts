/**
 * Пересчёт task-метрик по уже готовым naslukh.txt (без повторного ASR).
 *   npm run score --prefix apps/asr-bench
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseReference } from "./extract-ref.ts"
import { scoreTask, type TaskScore } from "./task-score.ts"
import { median, wordErrorRate } from "./wer.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, "..")
const SAMPLES = join(APP, "samples")
const OUT = join(APP, "out")

type Row = {
  id: string
  unscorable: boolean
  wer: number
  task: TaskScore
}

function main() {
  mkdirSync(OUT, { recursive: true })
  const ids = readdirSync(SAMPLES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const rows: Row[] = []
  for (const id of ids) {
    const dir = join(SAMPLES, id)
    const refPath = join(dir, "reference.txt")
    const hypPath = join(dir, "naslukh.txt")
    if (!existsSync(refPath) || !existsSync(hypPath)) {
      console.warn(`skip ${id}: нужен reference.txt + naslukh.txt`)
      continue
    }
    const raw = readFileSync(refPath, "utf8")
    const hyp = readFileSync(hypPath, "utf8")
    const parsed = parseReference(raw)
    const wer = wordErrorRate(parsed.text, hyp).wer
    const task = scoreTask(raw, parsed.text, hyp)
    rows.push({ id, unscorable: parsed.unscorable, wer, task })

    const rc =
      task.royalCaninExpected
        ? task.royalCaninHit
          ? "RC✓"
          : "RC✗"
        : "RC—"
    console.log(
      `${id}: WER ${(wer * 100).toFixed(0)}% | brands ${(task.brandRecall * 100).toFixed(0)}% [${task.hitBrands.join(", ") || "—"}] miss=[${task.missBrands.join(", ") || "—"}] | keys ${(task.keyphraseRecall * 100).toFixed(0)}% | ${rc}${parsed.unscorable ? " | unscorable" : ""}`,
    )
  }

  const scored = rows.filter((r) => !r.unscorable)
  const brandAvg =
    scored.reduce((s, r) => s + r.task.brandRecall, 0) / (scored.length || 1)
  const keyAvg =
    scored.reduce((s, r) => s + r.task.keyphraseRecall, 0) /
    (scored.length || 1)
  const werMed = median(scored.map((r) => r.wer))
  const rcCases = scored.filter((r) => r.task.royalCaninExpected)
  const rcHits = rcCases.filter((r) => r.task.royalCaninHit).length
  const rcRate = rcCases.length ? rcHits / rcCases.length : 1

  console.log(`\n=== vs Gemini-пример (${scored.length} cases) ===`)
  console.log(`  Brand overlap (macro):    ${(brandAvg * 100).toFixed(1)}%`)
  console.log(`  Keyphrase overlap:        ${(keyAvg * 100).toFixed(1)}%`)
  console.log(
    `  Royal Canin overlap:      ${(rcRate * 100).toFixed(1)}%  (${rcHits}/${rcCases.length})`,
  )
  console.log(`  Median WER vs Gemini:     ${(werMed * 100).toFixed(1)}%`)
  console.log(`\nNote: Gemini ≠ ground truth — только пример для сравнения.`)

  writeFileSync(
    join(OUT, "task-report.json"),
    JSON.stringify(
      {
        note: "Gemini is a comparison example, not ground truth",
        brandAvg,
        keyAvg,
        rcRate,
        werMed,
        rows,
      },
      null,
      2,
    ),
    "utf8",
  )
  console.log(`Report: ${join(OUT, "task-report.json")}`)
}

main()
