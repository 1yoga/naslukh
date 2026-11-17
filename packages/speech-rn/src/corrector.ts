/**
 * Лёгкий post-ASR corrector: нормализация пробелов + fuzzy-замена по каталогу брендов.
 * Нейросеть не используется.
 */

export interface CorrectorOptions {
  enabled: boolean
  /** Канонические названия брендов / hotwords. */
  brands: string[]
  /** 0…1, порог похожести токена к бренду (по умолчанию 0.72). */
  brandMinScore?: number
}

function normalizeSpaces(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:…])/g, "$1")
    .trim()
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "")
}

/** Расстояние Левенштейна. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) row[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = tmp
    }
  }
  return row[b.length]!
}

function similarity(a: string, b: string): number {
  const fa = fold(a)
  const fb = fold(b)
  if (!fa.length || !fb.length) return 0
  if (fa === fb) return 1
  const dist = levenshtein(fa, fb)
  return 1 - dist / Math.max(fa.length, fb.length)
}

/**
 * Заменяет токены (и биграммы) на ближайший бренд, если score ≥ порога.
 * Бренды длиннее одного слова матчим по окну.
 */
export function applyBrandFuzzy(text: string, brands: string[], minScore = 0.72): string {
  const cleanBrands = brands.map((b) => b.trim()).filter(Boolean)
  if (!cleanBrands.length || !text.trim()) return text

  const multi = cleanBrands
    .map((b) => ({ brand: b, parts: b.split(/\s+/).filter(Boolean) }))
    .filter((b) => b.parts.length > 1)
    .sort((a, b) => b.parts.length - a.parts.length)

  let out = text
  for (const { brand, parts } of multi) {
    const n = parts.length
    const tokens = out.split(/(\s+)/)
    const words = tokens.filter((_, i) => i % 2 === 0)
    const seps = tokens.filter((_, i) => i % 2 === 1)
    let i = 0
    const rebuilt: string[] = []
    while (i < words.length) {
      if (i + n <= words.length) {
        const window = words.slice(i, i + n).join(" ")
        if (similarity(window, brand) >= minScore) {
          rebuilt.push(brand)
          i += n
          if (i - 1 < seps.length && i < words.length) {
            /* keep following sep via loop */
          }
          continue
        }
      }
      rebuilt.push(words[i]!)
      i += 1
    }
    // restore with single spaces (seps lost on multi replace — ok for stand)
    out = rebuilt.join(" ")
  }

  const singles = cleanBrands.filter((b) => b.split(/\s+/).filter(Boolean).length === 1)
  if (!singles.length) return normalizeSpaces(out)

  return normalizeSpaces(
    out
      .split(/(\s+)/)
      .map((tok) => {
        if (!tok.trim() || /^\s+$/.test(tok)) return tok
        let best = tok
        let bestScore = 0
        for (const brand of singles) {
          const s = similarity(tok, brand)
          if (s > bestScore) {
            bestScore = s
            best = brand
          }
        }
        return bestScore >= minScore ? best : tok
      })
      .join(""),
  )
}

export function correctAsrText(text: string, options: CorrectorOptions): string {
  if (!options.enabled) return text
  let out = normalizeSpaces(text)
  out = applyBrandFuzzy(out, options.brands, options.brandMinScore ?? 0.72)
  return out
}
