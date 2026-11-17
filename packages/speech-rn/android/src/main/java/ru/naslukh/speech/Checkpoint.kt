package ru.naslukh.speech

/**
 * Константы и правила чекпоинта — зеркало packages/speech-core
 * (limits.ts, checkpoint.ts, memory.ts, states.ts).
 */
object Checkpoint {
  const val PIPELINE_VERSION = 3
  const val CHECKPOINT_FORMAT = 1
  const val LIBRARY_VERSION = "0.1.0"
  const val VAD_COMMIT_SAMPLES = 60 * Chunking.SAMPLE_RATE
  const val MIN_FREE_MEMORY_BYTES = 600L * 1024L * 1024L

  data class VadCommit(
    val intervals: List<Chunking.Range>,
    val cursorSample: Int,
  )

  data class Identity(
    val modelVersion: String,
    val pipelineVersion: Int,
    val checkpointFormat: Int,
  )

  fun canResume(saved: Identity, currentModelVersion: String): Boolean {
    return saved.modelVersion == currentModelVersion &&
      saved.pipelineVersion == PIPELINE_VERSION &&
      saved.checkpointFormat == CHECKPOINT_FORMAT
  }

  fun planVadCommit(
    scannedSample: Int,
    lastCommittedSample: Int,
    pendingIntervals: List<Chunking.Range>,
    atEnd: Boolean,
  ): VadCommit? {
    if (scannedSample < lastCommittedSample) {
      throw IllegalStateException("Курсор VAD не может идти назад")
    }
    if (scannedSample == lastCommittedSample) return null
    val due = atEnd || scannedSample - lastCommittedSample >= VAD_COMMIT_SAMPLES
    if (!due) return null
    return VadCommit(
      intervals = pendingIntervals.map { it.copy() },
      cursorSample = scannedSample,
    )
  }

  private val NEXT: Map<String, Set<String>> = mapOf(
    "queued" to setOf("recording", "recognizing", "cancelled", "failed"),
    "recording" to setOf("sealed", "paused", "cancelled", "failed"),
    "sealed" to setOf("recognizing", "cancelled", "failed"),
    "recognizing" to setOf("paused", "done", "failed", "cancelled"),
    "paused" to setOf("recording", "recognizing", "cancelled", "failed"),
    "done" to emptySet(),
    "failed" to emptySet(),
    "cancelled" to emptySet(),
  )

  fun assertTransition(from: String, to: String) {
    val allowed = NEXT[from] ?: throw IllegalArgumentException("Неизвестное состояние $from")
    if (to !in allowed) {
      throw IllegalStateException("Нельзя перейти из $from в $to")
    }
  }

  fun assertCanStart(freeMemoryBytes: Long) {
    if (freeMemoryBytes < MIN_FREE_MEMORY_BYTES) {
      throw IllegalStateException(
        "Мало памяти: свободно $freeMemoryBytes Б, нужно ≥ $MIN_FREE_MEMORY_BYTES Б (D3)",
      )
    }
  }
}
