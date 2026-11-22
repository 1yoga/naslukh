/** Чем закончился кусок реплики: пауза внутри реплики, рез в сплошной речи, конец реплики. */
export type SegmentBoundary = "pause" | "forced" | "end"

export interface JoinPiece {
  text: string
  /** Граница после куска. У последнего куска не учитывается. */
  boundary?: SegmentBoundary
}

const TRAILING_STOP = /[.…]+$/u

/**
 * Склейка текстов кусков реплики в итоговый `text`.
 *
 * Модель расшифровывает каждый кусок как отдельную реплику: в конце может поставить точку,
 * в начале — заглавную букву. Рез по паузе (≥ 400 мс тишины) чаще всего и есть граница предложения,
 * поэтому там текст не трогаем. Рез в сплошной речи (`forced`) границей предложения быть не может:
 * там убираем замыкающую точку и снижаем регистр первой буквы следующего куска, кроме «Я»,
 * аббревиатур и слов с несколькими заглавными. Имена собственные на таком стыке теряют заглавную
 * букву — цена за то, что принудительный рез редок (речь дольше `maxSegmentSec` без паузы).
 */
export function joinSegmentTexts(pieces: JoinPiece[]): string {
  let out = ""
  let prevBoundary: SegmentBoundary | undefined
  for (const piece of pieces) {
    let text = piece.text.replace(/\s+/gu, " ").trim()
    if (!text) continue
    if (out) {
      if (prevBoundary === "forced") {
        out = out.replace(TRAILING_STOP, "")
        text = lowerFirstWord(text)
      }
      out += " "
    }
    out += text
    prevBoundary = piece.boundary
  }
  return out.replace(/\s+/gu, " ").trim()
}

function lowerFirstWord(text: string): string {
  const match = /^(\p{Lu})(\p{Ll}+)/u.exec(text)
  if (!match) return text
  return match[1].toLowerCase() + text.slice(1)
}
