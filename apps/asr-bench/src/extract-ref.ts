/**
 * reference.txt из TR — часто Go-map:
 *   map[all_mentioned_brands:[...] diarization:<TEXT> is_q2_asked:...]
 *
 * reference.txt — обычно пример Gemini/TR, не разметка истины.
 * Для сравнения с mono-ASR:
 * — берём только diarization
 * — снимаем таймкоды и метки ролей (С1/В1/Спикер/Покупатель/Buyer…)
 * — startSec первой реплики (обрезать intro)
 */

export interface ParsedReference {
  /** Текст примера без ролей и таймкодов. */
  text: string
  /** Секунда первой реплики в diarization; 0 если нет. */
  startSec: number
  /**
   * Gemini сам отказался транскрибировать —
   * в сводный WER такой кейс не кладём (сравнивать не с чем).
   */
  unscorable: boolean
  unscorableReason?: string
}

const MAP_TAIL_KEY =
  /\s(?:all_mentioned_brands|is_q2_asked|is_rc_mentioned_first|q1_recommendation|q2_recommendation|reasoning|script_execution):/

/** Метки ролей: С1:, В2:, Спикер 1:, Покупатель:, Buyer:, … */
const ROLE_LABEL =
  /(?:^|[\n\r])[ \t]*(?:Спикер\s*\d+|Покупатель|Продавец|Buyer|Seller|Customer|Clerk|Speaker\s*\d+|[СCВB]\d+)[ \t]*:[ \t]*/giu

const ROLE_PREFIX =
  /^(?:Спикер\s*\d+|Покупатель|Продавец|Buyer|Seller|Customer|Clerk|Speaker\s*\d+|[СCВB]\d+)[ \t]*:[ \t]*/iu

const UNSCORABLE_PATTERNS: { re: RegExp; reason: string }[] = [
  {
    re: /невозможно\s+выполнить\s+транскрибац/i,
    reason: "gemini: невозможно транскрибировать",
  },
  {
    re: /только\s+фоновые\s+шумы/i,
    reason: "gemini: только шум",
  },
  {
    re: /неразборчив/i,
    reason: "gemini: речь неразборчива",
  },
]

function stampToSec(hOrM: string, mOrS: string, s?: string): number {
  const a = Number(hOrM)
  const b = Number(mOrS)
  if (s != null) return a * 3600 + b * 60 + Number(s)
  return a * 60 + b
}

/**
 * Первый таймкод, после которого есть реальная реплика
 * (не пустой `В1:` на 00:00).
 */
function parseFirstSpeechStartSec(body: string): number {
  const re =
    /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\][ \t]*(.*?)(?=\n\s*\[|\n\s*$|$)/gs
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const line = (m[4] ?? "").replace(ROLE_PREFIX, "").trim()
    if (line.length >= 2) {
      return stampToSec(m[1]!, m[2]!, m[3])
    }
  }
  return 0
}

function extractDiarizationBody(raw: string): string {
  let text = raw.trim()
  if (text.startsWith("map[")) {
    const key = "diarization:"
    const start = text.indexOf(key)
    if (start >= 0) {
      const i = start + key.length
      const next = text.slice(i).search(MAP_TAIL_KEY)
      text = next >= 0 ? text.slice(i, i + next) : text.slice(i)
      text = text.replace(/\]\s*$/, "").trim()
    }
  }
  return text
}

function stripRolesAndTimestamps(diarization: string): string {
  return diarization
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\][ \t]*/g, "")
    .replace(ROLE_LABEL, "\n")
    .replace(
      /(?:^|[\s])(?:Спикер\s*\d+|Покупатель|Продавец|Buyer|Seller|[СCВB]\d+)[ \t]*:[ \t]*/giu,
      " ",
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim()
}

function detectUnscorable(text: string): { unscorable: boolean; reason?: string } {
  for (const { re, reason } of UNSCORABLE_PATTERNS) {
    if (re.test(text)) return { unscorable: true, reason }
  }
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length > 0 && words.length < 4 && /шум|невозмож|ошибк/i.test(text)) {
    return { unscorable: true, reason: "слишком короткий / мета-текст" }
  }
  return { unscorable: false }
}

/** Полный разбор эталона для бенча. */
export function parseReference(raw: string): ParsedReference {
  const body = extractDiarizationBody(raw)
  const startSec = parseFirstSpeechStartSec(body)
  const text = stripRolesAndTimestamps(body)
  const { unscorable, reason } = detectUnscorable(text)
  return {
    text,
    startSec,
    unscorable,
    unscorableReason: reason,
  }
}

/** Обратная совместимость: только текст. */
export function extractReferenceTranscript(raw: string): string {
  return parseReference(raw).text
}
