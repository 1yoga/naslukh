import { SAMPLE_RATE_HZ } from "./limits.ts"

/** Токен с меткой времени внутри куска (секунды от начала куска). */
export interface TimedToken {
  token: string
  /** Середина токена в секундах от начала куска. */
  centerSec: number
}

export interface ChunkTranscript {
  startSample: number
  endSample: number
  tokens: TimedToken[]
}

/**
 * Склейка по центрам токенов (D1).
 * В зоне перехлёста берётся токен куска, чей центр ближе к середине перехлёста
 * со стороны «своего» куска: слева — из предыдущего, справа — из следующего.
 * Практически: все токены с абсолютным центром < cutSec из левого куска,
 * затем токены с центром ≥ cutSec из правого; cutSec — середина перехлёста.
 */
export function stitchByTokenCenters(
  chunks: readonly ChunkTranscript[],
): { text: string; tokens: Array<TimedToken & { absCenterSec: number }> } {
  if (chunks.length === 0) return { text: "", tokens: [] }

  const merged: Array<TimedToken & { absCenterSec: number }> = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const absTokens = chunk.tokens.map((token) => ({
      token: token.token,
      centerSec: token.centerSec,
      absCenterSec: chunk.startSample / SAMPLE_RATE_HZ + token.centerSec,
    }))

    if (i === 0) {
      merged.push(...absTokens)
      continue
    }

    const prev = chunks[i - 1]
    const overlapStart = Math.max(prev.startSample, chunk.startSample)
    const overlapEnd = Math.min(prev.endSample, chunk.endSample)
    if (overlapEnd <= overlapStart) {
      merged.push(...absTokens)
      continue
    }

    const cutSec =
      (overlapStart + overlapEnd) / 2 / SAMPLE_RATE_HZ

    while (
      merged.length > 0 &&
      merged[merged.length - 1].absCenterSec >= cutSec
    ) {
      merged.pop()
    }
    for (const token of absTokens) {
      if (token.absCenterSec >= cutSec) merged.push(token)
    }
  }

  return {
    text: merged.map((item) => item.token).join(""),
    tokens: merged,
  }
}
