package ru.naslukh.speech

/**
 * Порт packages/speech-core/src/chunk.ts:
 * pad / merge / coverage / soft-cut / split ≤30 с с перехлёстом.
 *
 * Важно: длинный интервал нельзя pad'ить целиком до split —
 * иначе pad обрежет всё после 30 с и хвост речи пропадёт.
 */
object Chunking {
  const val SAMPLE_RATE = 16_000
  const val MAX_CHUNK_SAMPLES = 30 * SAMPLE_RATE
  const val OVERLAP_SAMPLES = (0.8 * SAMPLE_RATE).toInt()
  const val VAD_PAD_SAMPLES = (0.5 * SAMPLE_RATE).toInt()
  const val VAD_MERGE_GAP_SAMPLES = 3 * SAMPLE_RATE
  const val VAD_MIN_COVERAGE = 0.99
  /** Окно soft-cut: рез предпочитаем после ≥20 с. */
  private const val SOFT_CUT_MIN_SAMPLES = 20 * SAMPLE_RATE

  data class Range(val startSample: Int, val endSample: Int) {
    val length: Int get() = endSample - startSample
  }

  fun mergeClose(intervals: List<Range>): List<Range> {
    if (intervals.isEmpty()) return intervals
    val sorted = intervals.sortedBy { it.startSample }
    val out = mutableListOf<Range>()
    var cur = sorted[0]
    for (i in 1 until sorted.size) {
      val next = sorted[i]
      if (next.startSample - cur.endSample <= VAD_MERGE_GAP_SAMPLES) {
        cur = Range(cur.startSample, maxOf(cur.endSample, next.endSample))
      } else {
        out.add(cur)
        cur = next
      }
    }
    out.add(cur)
    return out
  }

  fun ensureCoverage(intervals: List<Range>, totalSamples: Int): List<Range> {
    if (totalSamples <= 0) return emptyList()
    if (intervals.isEmpty()) return listOf(Range(0, totalSamples))
    val covered = intervals.sumOf { it.length.coerceAtLeast(0) }
    if (covered.toDouble() / totalSamples < VAD_MIN_COVERAGE) {
      return listOf(Range(0, totalSamples))
    }
    return intervals
  }

  /** Отступ 0.5 с; не длиннее 30 с (как padSpeechInterval в speech-core). */
  fun pad(interval: Range, totalSamples: Int): Range {
    val start = (interval.startSample - VAD_PAD_SAMPLES).coerceAtLeast(0)
    var end = (interval.endSample + VAD_PAD_SAMPLES).coerceAtMost(totalSamples)
    if (end - start > MAX_CHUNK_SAMPLES) {
      end = start + MAX_CHUNK_SAMPLES
    }
    return Range(start, end)
  }

  /** Длинная непрерывная речь → куски ≤30 с с перехлёстом (до pad всего интервала). */
  fun splitLongSpeech(interval: Range, totalSamples: Int): List<Range> {
    if (interval.length <= MAX_CHUNK_SAMPLES) {
      return listOf(pad(interval, totalSamples))
    }
    val chunks = mutableListOf<Range>()
    var start = interval.startSample
    while (start < interval.endSample) {
      val rawEnd = minOf(start + MAX_CHUNK_SAMPLES, interval.endSample)
      chunks.add(pad(Range(start, rawEnd), totalSamples))
      if (rawEnd >= interval.endSample) break
      start = rawEnd - OVERLAP_SAMPLES
      if (start < interval.startSample) start = interval.startSample
    }
    return chunks
  }

  /**
   * В окне 20–30 с от начала пачки — рез на самой длинной паузе.
   * Иначе берём всё, что умещается в 30 с.
   */
  private fun lastIndexForPack(intervals: List<Range>, startIndex: Int): Int {
    val chunkStart = intervals[startIndex].startSample
    var bestPause = -1
    var bestIndex = -1

    for (k in startIndex until intervals.lastIndex) {
      val at = intervals[k].endSample - chunkStart
      if (at < SOFT_CUT_MIN_SAMPLES) continue
      if (at > MAX_CHUNK_SAMPLES) break
      val pause = intervals[k + 1].startSample - intervals[k].endSample
      if (pause > bestPause) {
        bestPause = pause
        bestIndex = k
      }
    }
    if (bestIndex >= 0) return bestIndex

    var lastFit = startIndex
    for (k in startIndex until intervals.size) {
      if (intervals[k].endSample - chunkStart <= MAX_CHUNK_SAMPLES) {
        lastFit = k
      } else {
        break
      }
    }
    return lastFit
  }

  fun buildChunks(intervals: List<Range>, totalSamples: Int): List<Range> {
    val merged = ensureCoverage(mergeClose(intervals), totalSamples)
    if (merged.isEmpty()) return emptyList()

    val chunks = mutableListOf<Range>()
    var i = 0
    while (i < merged.size) {
      val head = merged[i]
      if (head.length > MAX_CHUNK_SAMPLES) {
        chunks.addAll(splitLongSpeech(head, totalSamples))
        i += 1
        continue
      }

      val last = lastIndexForPack(merged, i)
      val packed = Range(merged[i].startSample, merged[last].endSample)
      chunks.add(pad(packed, totalSamples))
      i = last + 1
    }
    return chunks
  }
}
