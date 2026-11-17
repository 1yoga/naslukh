/**
 * Нормализация + WER: naslukh vs пример (Gemini и т.п.).
 * Не претендует на оценку «истины» — только расстояние до примера.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function wordErrorRate(
  reference: string,
  hypothesis: string,
): { wer: number; refWords: number; edits: number } {
  const r = normalizeText(reference).split(" ").filter(Boolean)
  const h = normalizeText(hypothesis).split(" ").filter(Boolean)
  if (!r.length) return { wer: hypothesis ? 1 : 0, refWords: 0, edits: 0 }

  const dp: number[][] = Array.from({ length: r.length + 1 }, () =>
    Array(h.length + 1).fill(0),
  )
  for (let i = 0; i <= r.length; i++) dp[i]![0] = i
  for (let j = 0; j <= h.length; j++) dp[0]![j] = j

  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      )
    }
  }

  const edits = dp[r.length]![h.length]!
  return { wer: edits / r.length, refWords: r.length, edits }
}

export function median(values: number[]): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
