import {
  MAX_CHUNK_SAMPLES,
  OVERLAP_SAMPLES,
  SOFT_CUT_MIN_SAMPLES,
  VAD_PAD_SAMPLES,
} from "./limits.ts"

/** Полуинтервал [startSample, endSample) на шкале 16 кГц. */
export interface SampleRange {
  startSample: number
  endSample: number
}

export interface SpeechChunk extends SampleRange {
  /** true, если внутри одного куска речи не было паузы для реза. */
  cutThroughSpeech: boolean
}

function duration(range: SampleRange): number {
  return range.endSample - range.startSample
}

function assertOrdered(intervals: readonly SampleRange[]): void {
  for (let i = 0; i < intervals.length; i++) {
    const item = intervals[i]
    if (!Number.isInteger(item.startSample) || !Number.isInteger(item.endSample)) {
      throw new Error("Границы интервала должны быть целыми сэмплами")
    }
    if (item.endSample <= item.startSample) {
      throw new Error("Интервал речи пустой")
    }
    if (i > 0 && item.startSample < intervals[i - 1].endSample) {
      throw new Error("Интервалы Silero не должны пересекаться")
    }
  }
}

/** Отступ 250 мс; выход за файл и предел 30 с отступ не отменяет. */
export function padSpeechInterval(
  interval: SampleRange,
  totalSamples: number,
): SampleRange {
  if (totalSamples < 0 || !Number.isInteger(totalSamples)) {
    throw new Error("Длина файла должна быть целым неотрицательным числом")
  }
  const startSample = Math.max(0, interval.startSample - VAD_PAD_SAMPLES)
  let endSample = Math.min(totalSamples, interval.endSample + VAD_PAD_SAMPLES)
  if (endSample - startSample > MAX_CHUNK_SAMPLES) {
    endSample = startSample + MAX_CHUNK_SAMPLES
  }
  return { startSample, endSample }
}

function padChunk(
  startSample: number,
  endSample: number,
  totalSamples: number,
): SampleRange {
  return padSpeechInterval({ startSample, endSample }, totalSamples)
}

/**
 * Длинный непрерывный кусок речи режется по 30 с.
 * Соседние куски пересекаются на OVERLAP_SAMPLES.
 */
export function splitLongSpeech(
  interval: SampleRange,
  totalSamples: number,
  overlapSamples: number = OVERLAP_SAMPLES,
): SpeechChunk[] {
  if (overlapSamples < 0 || overlapSamples >= MAX_CHUNK_SAMPLES) {
    throw new Error("Перехлёст должен быть меньше максимума куска")
  }
  if (duration(interval) <= MAX_CHUNK_SAMPLES) {
    const padded = padChunk(interval.startSample, interval.endSample, totalSamples)
    return [{ ...padded, cutThroughSpeech: false }]
  }

  const chunks: SpeechChunk[] = []
  let start = interval.startSample
  while (start < interval.endSample) {
    const rawEnd = Math.min(start + MAX_CHUNK_SAMPLES, interval.endSample)
    const padded = padChunk(start, rawEnd, totalSamples)
    chunks.push({ ...padded, cutThroughSpeech: true })
    if (rawEnd >= interval.endSample) break
    start = rawEnd - overlapSamples
  }
  return chunks
}

/**
 * В окне 20–30 с от начала пачки выбирает рез на самой длинной паузе.
 * Если паузы в окне нет — берёт всё, что ещё умещается в 30 с.
 */
function lastIndexForPack(
  intervals: readonly SampleRange[],
  startIndex: number,
): number {
  const chunkStart = intervals[startIndex].startSample
  let best: { pause: number; index: number } | null = null

  for (let k = startIndex; k < intervals.length - 1; k++) {
    const at = intervals[k].endSample - chunkStart
    if (at < SOFT_CUT_MIN_SAMPLES) continue
    if (at > MAX_CHUNK_SAMPLES) break
    const pause = intervals[k + 1].startSample - intervals[k].endSample
    if (best === null || pause > best.pause) {
      best = { pause, index: k }
    }
  }
  if (best) return best.index

  let lastFit = startIndex
  for (let k = startIndex; k < intervals.length; k++) {
    if (intervals[k].endSample - chunkStart <= MAX_CHUNK_SAMPLES) {
      lastFit = k
    } else {
      break
    }
  }
  return lastFit
}

/**
 * Из интервалов Silero собирает куски для распознавания:
 * отступ, предел 30 с, рез по паузе в окне 20–30 с, перехлёст при резе по речи.
 */
export function buildSpeechChunks(
  intervals: readonly SampleRange[],
  totalSamples: number,
  overlapSamples: number = OVERLAP_SAMPLES,
): SpeechChunk[] {
  assertOrdered(intervals)
  if (intervals.length === 0) return []
  if (totalSamples < intervals[intervals.length - 1].endSample) {
    throw new Error("Интервал выходит за длину файла")
  }

  const chunks: SpeechChunk[] = []
  let i = 0
  while (i < intervals.length) {
    const head = intervals[i]
    if (duration(head) > MAX_CHUNK_SAMPLES) {
      chunks.push(...splitLongSpeech(head, totalSamples, overlapSamples))
      i += 1
      continue
    }

    const last = lastIndexForPack(intervals, i)
    const startSample = intervals[i].startSample
    const endSample = intervals[last].endSample
    const padded = padChunk(startSample, endSample, totalSamples)
    chunks.push({ ...padded, cutThroughSpeech: false })
    i = last + 1
  }
  return chunks
}
