export type NumberEquivalence = readonly [from: string, to: string]

/**
 * Один нормализатор для эталона и гипотезы.
 * Регистр, ё/е, пунктуация, пробелы. Числа сводит переданная таблица.
 * Таблица калибруется по тому, как GigaAM пишет числа, и до этого пустая.
 */
export function normalizeForWer(
  text: string,
  numberMap: readonly NumberEquivalence[] = [],
): string {
  const lowered = text.toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
  const stripped = lowered.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ")
  if (stripped.length === 0 || numberMap.length === 0) return stripped

  const map = new Map<string, string>()
  for (const [from, to] of numberMap) {
    const key = normalizeForWer(from)
    const value = normalizeForWer(to)
    if (key.length > 0 && value.length > 0) map.set(key, value)
  }

  return stripped
    .split(" ")
    .map((word) => map.get(word) ?? word)
    .join(" ")
}

export function wordErrorRate(
  reference: string,
  hypothesis: string,
  numberMap: readonly NumberEquivalence[] = [],
): number {
  const ref = tokens(reference, numberMap)
  const hyp = tokens(hypothesis, numberMap)
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1
  return levenshtein(ref, hyp) / ref.length
}

/** Разница двух WER в процентных пунктах. */
export function werGapPoints(left: number, right: number): number {
  return Math.abs(left - right) * 100
}

function tokens(text: string, numberMap: readonly NumberEquivalence[]): string[] {
  const normalized = normalizeForWer(text, numberMap)
  return normalized.length === 0 ? [] : normalized.split(" ")
}

function levenshtein(ref: string[], hyp: string[]): number {
  let previous = Array.from({ length: hyp.length + 1 }, (_, index) => index)
  for (let i = 1; i <= ref.length; i++) {
    const current = [i]
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      )
    }
    previous = current
  }
  return previous[hyp.length]
}
