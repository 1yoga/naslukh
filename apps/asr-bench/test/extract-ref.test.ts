import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseReference } from "../src/extract-ref.ts"

describe("parseReference", () => {
  it("снимает Спикер N и таймкоды", () => {
    const raw = `map[diarization:[00:20] Спикер 1: Привет.\n[00:21] Спикер 2: Здравствуйте. is_q2_asked:Нет]`
    const p = parseReference(raw)
    assert.equal(p.startSec, 20)
    assert.match(p.text, /^Привет/)
    assert.doesNotMatch(p.text, /Спикер/)
    assert.doesNotMatch(p.text, /00:20/)
    assert.equal(p.unscorable, false)
  })

  it("снимает С1/В1 без \\b (кириллица)", () => {
    const raw = `[00:38] С1: Здравствуйте.\n[00:39] В1: Подскажете корм?`
    const p = parseReference(raw)
    assert.equal(p.startSec, 38)
    assert.equal(p.text.includes("С1"), false)
    assert.equal(p.text.includes("В1"), false)
    assert.match(p.text, /Здравствуйте/)
    assert.match(p.text, /Подскажете/)
  })

  it("снимает Покупатель/Продавец и Buyer/Seller", () => {
    const a = parseReference(`[01:22] Покупатель: Ага.\n[01:23] Продавец: Да.`)
    assert.equal(a.text.includes("Покупатель"), false)
    assert.equal(a.text.includes("Продавец"), false)
    const b = parseReference(`[00:13] Buyer: Hi!\n[00:14] Seller: Hello.`)
    assert.equal(b.text.includes("Buyer"), false)
    assert.equal(b.text.includes("Seller"), false)
  })

  it("помечает неразборчивый эталон unscorable", () => {
    const p = parseReference(
      "Аудиозапись содержит только фоновые шумы и неразборчивую речь. Невозможно выполнить транскрибацию диалога.",
    )
    assert.equal(p.unscorable, true)
  })

  it("startSec — первая непустая реплика, не 00:00", () => {
    const p = parseReference(
      "[00:00] В1: \n[00:27] В1: Здравствуйте.\n[00:28] В2: Ну да.",
    )
    assert.equal(p.startSec, 27)
  })
})
