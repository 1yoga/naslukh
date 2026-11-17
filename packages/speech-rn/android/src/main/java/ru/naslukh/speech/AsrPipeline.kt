package ru.naslukh.speech

import android.app.ActivityManager
import android.content.Context
import android.util.Log
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.UUID

/**
 * Аудиофайл → PCM 16 кГц → Silero (чекпоинт раз в 60 с) → куски ≤30 с → GigaAM → segments в SQLite.
 */
object AsrPipeline {
  private const val TAG = "NaslukhAsr"
  private const val FEATURE_DIM = 64
  private const val WINDOW = 512

  data class SegmentOut(
    val startSample: Int,
    val endSample: Int,
    val text: String,
  )

  data class Result(
    val jobId: String,
    val text: String,
    val segments: List<SegmentOut>,
    val resumed: Boolean,
    val fromCache: Boolean,
  )

  data class UtteranceResult(
    val text: String,
    val segment: SegmentOut,
  )

  data class Options(
    val ignoreCache: Boolean = false,
    val vadThreshold: Float = 0.15f,
    val vadMinSpeechSec: Float = 0.25f,
    val vadMinSilenceSec: Float = 0.25f,
    val numThreads: Int = 2,
    val hotwords: List<String> = emptyList(),
  ) {
    companion object {
      @Suppress("UNCHECKED_CAST")
      fun fromMap(raw: Map<String, Any?>?): Options {
        if (raw == null) return Options()
        val hw = raw["hotwords"]
        val list = when (hw) {
          is List<*> -> hw.mapNotNull { it?.toString()?.trim()?.takeIf { s -> s.isNotEmpty() } }
          else -> emptyList()
        }
        return Options(
          ignoreCache = raw["ignoreCache"] as? Boolean ?: false,
          vadThreshold = (raw["vadThreshold"] as? Number)?.toFloat() ?: 0.15f,
          vadMinSpeechSec = (raw["vadMinSpeechSec"] as? Number)?.toFloat() ?: 0.25f,
          vadMinSilenceSec = (raw["vadMinSilenceSec"] as? Number)?.toFloat() ?: 0.25f,
          numThreads = ((raw["numThreads"] as? Number)?.toInt() ?: 2).coerceIn(1, 4),
          hotwords = list,
        )
      }
    }
  }

  /**
   * Распознаёт захваченный utterance уже загруженным recognizer без временного файла и SQLite-job.
   * Используется real-time listenOnce; file pipeline остаётся отдельным и совместимым.
   */
  fun recognizeUtterance(
    recognizer: OfflineRecognizer,
    samples: FloatArray,
    isCancelled: () -> Boolean = { false },
  ): UtteranceResult {
    if (samples.isEmpty()) {
      throw IllegalArgumentException("Пустая фраза")
    }
    val text = recognizeSamples(recognizer, samples, isCancelled)
    return UtteranceResult(
      text = text,
      segment = SegmentOut(0, samples.size, text),
    )
  }

  fun transcribeFile(
    context: Context,
    uri: String,
    options: Options = Options(),
  ): Result {
    val path = uri.removePrefix("file://")
    val waveFile = File(path)
    if (!waveFile.exists()) {
      throw IllegalArgumentException("Файл не найден: $uri")
    }

    val p = ModelStore.paths(context)
    if (!ModelStore.isReady(p)) {
      throw IllegalStateException("Сначала вызови ensureModel(${ModelStore.GIGAAM_MODEL_ID})")
    }

    Checkpoint.assertCanStart(freeMemoryBytes(context))

    val db = SpeechDb.get(context)
    db.migrate()
    val device = SpeechDb.Device()
    val modelId = ModelStore.GIGAAM_MODEL_ID

    val fingerprintSize = waveFile.length()
    val fingerprintSha = sha256File(waveFile)
    val container = waveFile.extension.lowercase().ifEmpty { "bin" }

    if (options.hotwords.isNotEmpty()) {
      Log.i(TAG, "hotwords=${options.hotwords.size} (bias в JNI позже; post-correct на JS)")
    }

    val existing = db.findJobByFingerprint(fingerprintSize, fingerprintSha)
    if (!options.ignoreCache && existing != null && existing.state == "done") {
      val segs = db.listSegments(existing.id).map {
        SegmentOut(it.startSample, it.endSample, it.text)
      }
      val text = segs.map { it.text }.filter { it.isNotBlank() }.joinToString(" ").trim()
      Log.i(TAG, "cache hit job=${existing.id} segments=${segs.size}")
      ProgressBus.send("asr", 1.0, "Из кэша")
      return Result(existing.id, text, segs, resumed = true, fromCache = true)
    }

    var resumed = false
    val jobId: String
    val canResumeExisting =
      !options.ignoreCache &&
        existing != null &&
        Checkpoint.canResume(
          Checkpoint.Identity(
            existing.modelVersion,
            existing.pipelineVersion,
            existing.checkpointFormat,
          ),
          modelId,
        ) &&
        existing.state in setOf("recognizing", "paused", "sealed", "queued")

    if (canResumeExisting && existing != null) {
      jobId = existing.id
      resumed = true
      when (existing.state) {
        "queued", "sealed", "paused" -> db.setJobState(jobId, "recognizing", "resume", device)
        else -> { /* already recognizing */ }
      }
      Log.i(
        TAG,
        "resume job=$jobId vadCursor=${existing.vadCursorSample} " +
          "asrCursor=${existing.lastCommittedSample}",
      )
    } else {
      jobId = "asr-${UUID.randomUUID()}"
      db.createJob(jobId, modelId, modelId, path, device)
      db.setJobAudio(jobId, path, container, fingerprintSize, fingerprintSha)
      db.setJobState(jobId, "recognizing", "resume", device)
      Log.i(TAG, "new job=$jobId size=$fingerprintSize ignoreCache=${options.ignoreCache}")
    }

    try {
      ProgressBus.send("asr", 0.02, "Декод аудио…")
      val pcm = AudioLoader.loadMono16k(path)
      val samples = pcm.samples
      val total = samples.size

      ProgressBus.send("asr", 0.08, "VAD (поиск речи)…")
      runVadWithCheckpoint(db, jobId, samples, p.silero.absolutePath, options)

      val rawIntervals = db.listVadIntervals(jobId)
      val chunks = Chunking.buildChunks(rawIntervals, total)
      val fromSample = db.pendingChunkStart(jobId)
      val pending = chunks.filter { it.endSample > fromSample }

      Log.i(
        TAG,
        "job=$jobId samples=$total (~${"%.1f".format(total.toDouble() / Chunking.SAMPLE_RATE)}s) " +
          "vadIntervals=${rawIntervals.size} chunks=${chunks.size} pending=${pending.size} " +
          "fromSample=$fromSample ignoreCache=${options.ignoreCache}",
      )

      if (pending.isNotEmpty()) {
        recognizePending(db, jobId, samples, pending, p, options.numThreads)
      } else {
        ProgressBus.send("asr", 0.95, "Нечего распознавать")
      }

      db.setJobState(jobId, "done", "complete", device)
      ProgressBus.send("asr", 1.0, "Готово")

      val segs = db.listSegments(jobId).map {
        SegmentOut(it.startSample, it.endSample, it.text)
      }
      val text = segs.map { it.text }.filter { it.isNotBlank() }.joinToString(" ").trim()
      return Result(jobId, text, segs, resumed = resumed, fromCache = false)
    } catch (e: Exception) {
      try {
        val job = db.getJob(jobId)
        if (job.state == "recognizing" || job.state == "paused" || job.state == "queued") {
          // оставляем recognizing — следующий вызов продолжит с курсора
        }
      } catch (_: Exception) {
      }
      throw e
    }
  }

  private fun runVadWithCheckpoint(
    db: SpeechDb,
    jobId: String,
    samples: FloatArray,
    sileroPath: String,
    options: Options,
  ) {
    val job = db.getJob(jobId)
    if (job.vadCursorSample >= samples.size) {
      Log.i(TAG, "VAD already complete cursor=${job.vadCursorSample}")
      return
    }

    val cursor = job.vadCursorSample
    val vad = Vad(
      assetManager = null,
      config = VadModelConfig(
        sileroVadModelConfig = SileroVadModelConfig(
          model = sileroPath,
          threshold = options.vadThreshold,
          minSilenceDuration = options.vadMinSilenceSec,
          minSpeechDuration = options.vadMinSpeechSec,
          windowSize = WINDOW,
          maxSpeechDuration = 30.0f,
        ),
        sampleRate = Chunking.SAMPLE_RATE,
        numThreads = options.numThreads,
        provider = "cpu",
      ),
    )

    val pending = mutableListOf<Chunking.Range>()
    var lastCommitted = cursor
    var scanned = cursor
    var commits = 0

    try {
      val rest = samples.size - cursor
      var pos = 0
      var lastPct = -1
      while (pos + WINDOW <= rest) {
        val slice = samples.copyOfRange(cursor + pos, cursor + pos + WINDOW)
        vad.acceptWaveform(slice)
        scanned = cursor + pos + WINDOW
        drainVad(vad, pending, cursor, samples.size)
        val batch = Checkpoint.planVadCommit(
          scannedSample = scanned,
          lastCommittedSample = lastCommitted,
          pendingIntervals = pending,
          atEnd = false,
        )
        if (batch != null && !vadIsSpeech(vad)) {
          db.commitVad(
            jobId,
            batch.intervals.filter { it.endSample > lastCommitted },
            batch.cursorSample,
          )
          pending.clear()
          lastCommitted = batch.cursorSample
          commits += 1
        }
        val pct = if (rest > 0) ((pos * 100) / rest) else 100
        if (pct != lastPct && pct % 5 == 0) {
          lastPct = pct
          ProgressBus.send(
            "asr",
            0.08 + 0.22 * (pct / 100.0),
            "VAD ${pct}%",
          )
        }
        pos += WINDOW
      }

      val rem = rest % WINDOW
      if (rem > 0) {
        val padded = FloatArray(WINDOW)
        System.arraycopy(samples, samples.size - rem, padded, 0, rem)
        vad.acceptWaveform(padded)
      }
      vad.flush()
      scanned = samples.size
      drainVad(vad, pending, cursor, samples.size)

      val finalBatch = Checkpoint.planVadCommit(
        scannedSample = scanned,
        lastCommittedSample = lastCommitted,
        pendingIntervals = pending,
        atEnd = true,
      )
      if (finalBatch != null) {
        db.commitVad(jobId, finalBatch.intervals, finalBatch.cursorSample)
        commits += 1
      }
    } finally {
      vad.release()
    }
    Log.i(TAG, "VAD commits=$commits cursor→$scanned")
  }

  private fun recognizePending(
    db: SpeechDb,
    jobId: String,
    samples: FloatArray,
    pending: List<Chunking.Range>,
    paths: ModelStore.Paths,
    numThreads: Int,
  ) {
    val recognizer = createRecognizer(paths, numThreads)
    try {
      val n = pending.size
      for ((idx, chunk) in pending.withIndex()) {
        val slice = samples.copyOfRange(chunk.startSample, chunk.endSample)
        val text = recognizeSamples(recognizer, slice)
        db.commitSegment(
          jobId = jobId,
          startSample = chunk.startSample,
          endSample = chunk.endSample,
          text = text,
          modelVersion = ModelStore.GIGAAM_MODEL_ID,
          committedSample = chunk.endSample,
        )
        val frac = (idx + 1).toDouble() / n.coerceAtLeast(1)
        ProgressBus.send(
          "asr",
          0.30 + 0.65 * frac,
          "Распознавание ${idx + 1}/$n",
        )
        Log.i(
          TAG,
          "segment ${chunk.startSample}-${chunk.endSample} " +
            "chars=${text.length}",
        )
      }
    } finally {
      recognizer.release()
    }
  }

  internal fun createRecognizer(
    paths: ModelStore.Paths,
    numThreads: Int,
  ): OfflineRecognizer {
    return OfflineRecognizer(
      assetManager = null,
      config = OfflineRecognizerConfig(
        featConfig = FeatureConfig(
          sampleRate = Chunking.SAMPLE_RATE,
          featureDim = FEATURE_DIM,
        ),
        modelConfig = OfflineModelConfig(
          transducer = OfflineTransducerModelConfig(
            encoder = paths.encoder.absolutePath,
            decoder = paths.decoder.absolutePath,
            joiner = paths.joiner.absolutePath,
          ),
          tokens = paths.tokens.absolutePath,
          modelType = "nemo_transducer",
          numThreads = numThreads,
          provider = "cpu",
        ),
        decodingMethod = "greedy_search",
      ),
    )
  }

  private fun recognizeSamples(
    recognizer: OfflineRecognizer,
    samples: FloatArray,
    isCancelled: () -> Boolean = { false },
  ): String {
    if (isCancelled()) throw IllegalStateException("Прослушивание отменено")
    val stream = recognizer.createStream()
    return try {
      stream.acceptWaveform(samples, Chunking.SAMPLE_RATE)
      recognizer.decode(stream)
      if (isCancelled()) throw IllegalStateException("Прослушивание отменено")
      recognizer.getResult(stream).text.trim()
    } finally {
      stream.release()
    }
  }

  private fun drainVad(
    vad: Vad,
    pending: MutableList<Chunking.Range>,
    offset: Int,
    totalSamples: Int,
  ) {
    while (!vad.empty()) {
      val seg = vad.front()
      vad.pop()
      val start = minOf(offset + seg.start.toInt().coerceAtLeast(0), totalSamples)
      val end = minOf(start + seg.samples.size, totalSamples)
      if (end > start) {
        pending.add(Chunking.Range(start, end))
      }
    }
  }

  /** Не коммитить VAD посреди активной речи. */
  private fun vadIsSpeech(vad: Vad): Boolean = vad.isSpeechDetected()

  private fun freeMemoryBytes(context: Context): Long {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo()
    am.getMemoryInfo(info)
    return info.availMem
  }

  private fun sha256File(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        digest.update(buf, 0, n)
      }
    }
    return digest.digest().joinToString("") { b -> "%02x".format(b) }
  }
}
