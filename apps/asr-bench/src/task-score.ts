/**
 * Overlap брендов/фраз naslukh vs пример (Gemini) — не accuracy vs GT.
 * Alias'ы — типичный ASR-garble (Риалконин, пармина…), только для матча в тексте.
 */

import { normalizeText } from "./wer.ts"

/** Канонический бренд → варианты + ASR-garble. */
export const BRAND_ALIASES: Record<string, string[]> = {
  "Royal Canin": [
    "royal canin",
    "royal",
    "роял канин",
    "роял-канин",
    "роялканин",
    "роял камин", // канин→камин
    "роялкамин",
    "риалконин",
    "риал канин",
    "роял",
    "рояль", // «рояль» вместо роял
  ],
  ProPlan: ["proplan", "pro plan", "проплан"],
  Farmina: [
    "farmina",
    "фармина",
    "пармина",
    "гармина", // «400 гармина»
    "фармин",
  ],
  Brit: ["brit", "брит"],
  Monge: ["monge", "монж", "монжа", "монджа", "мондж"],
  Alleva: ["alleva", "алева", "алевы", "алейва", "алевал", "алева л"],
  Grandorf: ["grandorf", "грандорф"],
  FitLine: ["fitline", "fit line", "фитлайн"],
  "Vet Life": [
    "vet life",
    "vetlife",
    "ветлайф",
    "вет лайф",
    "ветлайта", // ASR
    "ветлайта",
    "ветлайф",
  ],
  Purina: ["purina", "пурина"],
  "Best Diet": ["best diet", "бэст диет", "бест диет"],
}

/** Скриптовые маркеры тайного визита. */
export const KEYPHRASES: { id: string; patterns: string[] }[] = [
  {
    id: "urinary",
    patterns: [
      "уринари",
      "urinari",
      "у ренари",
      "уренари",
      "урена",
      "венарии",
      "у венарии",
      "кулинарию", // case-006: уринари→кулинарию
      "мочекамен",
      "струвит",
      "стривит",
      "струбит",
    ],
  },
  {
    id: "sterilized",
    patterns: ["стерил", "кастра"],
  },
  {
    id: "dry_food",
    patterns: ["сухой", "корм"],
  },
  {
    id: "vet",
    patterns: ["ветеринар", "врач"],
  },
]

export interface TaskScore {
  expectedBrands: string[]
  hitBrands: string[]
  missBrands: string[]
  brandRecall: number
  royalCaninExpected: boolean
  royalCaninHit: boolean
  keyphrasesExpected: string[]
  keyphrasesHit: string[]
  keyphraseRecall: number
}

/** Схлопываем пробелы/дефисы — «роял канин» ≈ «роялканин». */
function compact(s: string): string {
  return normalizeText(s).replace(/[\s-]+/g, "")
}

function textHasAlias(norm: string, compactNorm: string, alias: string): boolean {
  const a = normalizeText(alias)
  if (!a) return false
  if (norm.includes(a)) return true
  const ca = compact(alias)
  return ca.length >= 4 && compactNorm.includes(ca)
}

function canonBrand(name: string): string | null {
  const t = name.trim()
  if (!t || /^другие$/i.test(t)) return null
  for (const canon of Object.keys(BRAND_ALIASES)) {
    if (canon.toLowerCase() === t.toLowerCase()) return canon
    if (normalizeText(canon) === normalizeText(t)) return canon
  }
  if (/^vet\s*life$/i.test(t)) return "Vet Life"
  if (/^best\s*diet$/i.test(t)) return "Best Diet"
  return t
}

/** Достаёт список брендов из Go-map all_mentioned_brands:[...]. */
export function extractMentionedBrands(raw: string): string[] {
  const m = raw.match(/all_mentioned_brands:\[([^\]]*)\]/)
  if (!m) return []
  const inner = m[1]!.trim()
  if (!inner) return []
  const known = Object.keys(BRAND_ALIASES).sort((a, b) => b.length - a.length)
  let rest = ` ${inner} `
  const found: string[] = []
  for (const brand of known) {
    const re = new RegExp(
      `\\s${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s`,
      "i",
    )
    if (re.test(rest)) {
      found.push(brand)
      rest = rest.replace(re, " ")
    }
  }
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    const c = canonBrand(token)
    if (c && !found.includes(c)) found.push(c)
  }
  return found
}

export function brandsInText(text: string): string[] {
  const norm = normalizeText(text)
  const cNorm = compact(text)
  const hits: string[] = []
  for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) {
    if (aliases.some((a) => textHasAlias(norm, cNorm, a))) {
      hits.push(canon)
    }
  }
  return hits
}

function keyphrasesInText(text: string): string[] {
  const norm = normalizeText(text)
  const cNorm = compact(text)
  return KEYPHRASES.filter((k) =>
    k.patterns.some((p) => textHasAlias(norm, cNorm, p)),
  ).map((k) => k.id)
}

export function scoreTask(
  referenceRaw: string,
  referenceText: string,
  hypothesis: string,
): TaskScore {
  const fromMap = extractMentionedBrands(referenceRaw)
  const fromRef = brandsInText(referenceText)
  const expectedBrands = [...new Set([...fromMap, ...fromRef])]
  const hitBrands = brandsInText(hypothesis).filter((b) =>
    expectedBrands.includes(b),
  )
  const missBrands = expectedBrands.filter((b) => !hitBrands.includes(b))
  const brandRecall = expectedBrands.length
    ? hitBrands.length / expectedBrands.length
    : 1

  const royalCaninExpected = expectedBrands.includes("Royal Canin")
  const royalCaninHit = brandsInText(hypothesis).includes("Royal Canin")

  const keyphrasesExpected = keyphrasesInText(referenceText)
  const hypKeys = new Set(keyphrasesInText(hypothesis))
  const keyphrasesHit = keyphrasesExpected.filter((k) => hypKeys.has(k))
  const keyphraseRecall = keyphrasesExpected.length
    ? keyphrasesHit.length / keyphrasesExpected.length
    : 1

  return {
    expectedBrands,
    hitBrands,
    missBrands,
    brandRecall,
    royalCaninExpected,
    royalCaninHit,
    keyphrasesExpected,
    keyphrasesHit,
    keyphraseRecall,
  }
}
