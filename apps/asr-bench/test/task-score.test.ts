import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { brandsInText, scoreTask } from "../src/task-score.ts"

describe("task-score fuzzy brands", () => {
  it("ловит Риалконин / Роял Камин / пармина", () => {
    const hits = brandsInText(
      "Риалконин, монж Алевал. Роял Камин есть. пармина.",
    )
    assert.ok(hits.includes("Royal Canin"))
    assert.ok(hits.includes("Monge"))
    assert.ok(hits.includes("Alleva"))
    assert.ok(hits.includes("Farmina"))
  })

  it("RC✓ на типичном ASR-garble", () => {
    const t = scoreTask(
      "map[all_mentioned_brands:[Royal Canin Farmina] diarization:тест is_q2_asked:Нет]",
      "Royal Canin и Farmina",
      "Роялканин и пармина",
    )
    assert.equal(t.royalCaninHit, true)
    assert.ok(t.hitBrands.includes("Farmina"))
  })
})
