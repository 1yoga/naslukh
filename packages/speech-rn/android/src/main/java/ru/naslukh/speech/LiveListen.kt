package ru.naslukh.speech

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.media.AudioRecord
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Один локальный turn-taking цикл: AudioRecord → Silero VAD → GigaAM.
 * Одновременно допускается только один слушатель на процесс приложения.
 */
object LiveListen {
  private const val SAMPLE_RATE = Chunking.SAMPLE_RATE
  private const val WINDOW = 512
  private const val PRE_ROLL_PAD_SEC = 0.3f
  private const val DEFAULT_START_TIMEOUT_SEC = 15f
  private const val DEFAULT_MAX_DURATION_SEC = 30f
  private const val DEFAULT_END_SILENCE_SEC = 1f
  private const val MIN_UTTERANCE_SEC = 0.08f
  private const val CANCELLED_MESSAGE = "Прослушивание отменено"
  private const val TIMING_TAG = "NaslukhTiming"
  private const val TIMING_PREFIX = "listenOnceTiming:"
  private const val INPUT_TAG = "NaslukhInput"
  private const val PRE_VAD_CAPTURE_SAMPLES = 10 * SAMPLE_RATE
  private const val PRE_VAD_WAV = "naslukh-pre-vad.wav"
  private const val MAX_END_SILENCE_SEC = 3f

  private data class CachedRecognizer(
    val modelDir: String,
    val numThreads: Int,
    val recognizer: OfflineRecognizer,
  )

  private val active = AtomicReference<Session?>(null)
  private val cacheLock = Any()
  private var cachedRecognizer: CachedRecognizer? = null
  private var releaseWhenIdle = false

  data class Options(
    val vadThreshold: Float = 0.5f,
    val vadMinSpeechSec: Float = 0.25f,
    val vadMinSilenceSec: Float = DEFAULT_END_SILENCE_SEC,
    val numThreads: Int = 2,
    val startTimeoutSec: Float = DEFAULT_START_TIMEOUT_SEC,
    val maxDurationSec: Float = DEFAULT_MAX_DURATION_SEC,
    val saveAudio: Boolean = false,
    /** Период onAudioLevel, мс; 0 — событий нет. */
    val audioLevelIntervalMs: Int = 0,
    /** Пауза внутри реплики для onSpeechPause, мс; 0 — событий нет. Меньше vadMinSilenceSec. */
    val speechPauseMs: Int = 0,
    /** VOICE_COMMUNICATION + AcousticEchoCanceler/NoiseSuppressor вместо VOICE_RECOGNITION. */
    val echoCancellation: Boolean = false,
    /** Продолжить реплику с захватом монитора речи (SpeechMonitors). */
    val continueFromMonitor: String? = null,
  ) {
    companion object {
      fun fromMap(raw: Map<String, Any?>?): Options {
        if (raw == null) return Options()
        return Options(
          vadThreshold = ((raw["vadThreshold"] as? Number)?.toFloat() ?: 0.5f)
            .coerceIn(0.01f, 0.99f),
          vadMinSpeechSec = ((raw["vadMinSpeechSec"] as? Number)?.toFloat() ?: 0.25f)
            .coerceIn(0.05f, 2f),
          vadMinSilenceSec = ((raw["vadMinSilenceSec"] as? Number)?.toFloat()
            ?: DEFAULT_END_SILENCE_SEC)
            .coerceIn(0.05f, MAX_END_SILENCE_SEC),
          numThreads = ((raw["numThreads"] as? Number)?.toInt() ?: 2).coerceIn(1, 4),
          startTimeoutSec = ((raw["startTimeoutSec"] as? Number)?.toFloat()
            ?: DEFAULT_START_TIMEOUT_SEC).coerceIn(1f, 120f),
          maxDurationSec = ((raw["maxDurationSec"] as? Number)?.toFloat()
            ?: DEFAULT_MAX_DURATION_SEC).coerceIn(2f, 30f),
          saveAudio = raw["saveAudio"] as? Boolean ?: false,
          audioLevelIntervalMs = ((raw["audioLevelIntervalMs"] as? Number)?.toInt() ?: 0)
            .let { if (it <= 0) 0 else it.coerceIn(50, 1000) },
          speechPauseMs = ((raw["speechPauseMs"] as? Number)?.toInt() ?: 0)
            .let { if (it <= 0) 0 else it.coerceIn(100, 5000) },
          echoCancellation = raw["echoCancellation"] as? Boolean ?: false,
          continueFromMonitor = (raw["continueFromMonitor"] as? String)?.takeIf { it.isNotBlank() },
        )
      }
    }
  }

  data class Result(
    val sessionId: String,
    val text: String,
    val segment: AsrPipeline.SegmentOut,
    val durationMs: Long,
    val audioUri: String?,
  )

  fun isActive(): Boolean = active.get() != null

  fun listenOnce(context: Context, options: Options = Options()): Result {
    if (options.continueFromMonitor == null && SpeechMonitors.isActive()) {
      throw IllegalStateException("Работает монитор речи: остановите его или передайте continueFromMonitor")
    }
    val session = Session()
    synchronized(cacheLock) {
      if (!active.compareAndSet(null, session)) {
        throw IllegalStateException("Прослушивание уже запущено")
      }
    }
    return try {
      val handoff = options.continueFromMonitor?.let { SpeechMonitors.takeOver(it) }
      session.run(context.applicationContext, options, handoff)
    } finally {
      try {
        session.close()
      } finally {
        synchronized(cacheLock) {
          active.compareAndSet(session, null)
          if (releaseWhenIdle) {
            releaseWhenIdle = false
            releaseCachedLocked()
          }
        }
      }
    }
  }

  /** Модуль исчез: отменяем активный вызов и освобождаем recognizer после его завершения. */
  fun onModuleDestroy() {
    val session = synchronized(cacheLock) {
      val current = active.get()
      if (current == null) releaseCachedLocked() else releaseWhenIdle = true
      current
    }
    session?.cancel()
  }

  private fun recognizerFor(paths: ModelStore.Paths, numThreads: Int): Pair<OfflineRecognizer, Boolean> {
    val modelDir = paths.gigaamDir.absolutePath
    synchronized(cacheLock) {
      val cached = cachedRecognizer
      if (cached != null && cached.modelDir == modelDir && cached.numThreads == numThreads) {
        return cached.recognizer to true
      }
      releaseCachedLocked()
    }
    val created = AsrPipeline.createRecognizer(paths, numThreads)
    synchronized(cacheLock) {
      cachedRecognizer = CachedRecognizer(modelDir, numThreads, created)
    }
    return created to false
  }

  private fun discardRecognizer(recognizer: OfflineRecognizer) {
    synchronized(cacheLock) {
      if (cachedRecognizer?.recognizer === recognizer) releaseCachedLocked()
    }
  }

  private fun releaseCachedLocked() {
    val cached = cachedRecognizer
    cachedRecognizer = null
    cached?.recognizer?.release()
  }

  /** Останавливает захват или помечает текущий ASR как отменённый. */
  fun cancel(): Boolean {
    val session = active.get() ?: return false
    session.cancel()
    return true
  }

  /** Завершает текущую запись и распознаёт уже обнаруженную речь. */
  fun stop(): Boolean {
    val session = active.get() ?: return false
    session.stop()
    return true
  }

  private class Session {
    val id: String = UUID.randomUUID().toString()
    private val cancelled = AtomicBoolean(false)
    private val stopRequested = AtomicBoolean(false)
    private val levelPending = AtomicBoolean(false)

    @Volatile
    private var mic: Mic? = null

    @SuppressLint("MissingPermission")
    fun run(context: Context, options: Options, handoff: SpeechMonitors.Handoff? = null): Result {
      // Захват монитора принадлежит сессии сразу: close() освободит его при любой ошибке ниже.
      if (handoff != null) mic = handoff.mic
      val nativeStartedAtNs = SystemClock.elapsedRealtimeNanos()
      val rawInputFile = File(context.cacheDir, PRE_VAD_WAV)
      if (rawInputFile.exists() && !rawInputFile.delete()) {
        Log.w(INPUT_TAG, "Не удалось удалить старый $PRE_VAD_WAV")
      }
      checkPermission(context)
      Checkpoint.assertCanStart(freeMemoryBytes(context))

      val paths = ModelStore.paths(context)
      if (!ModelStore.isReady(paths)) {
        throw IllegalStateException("Сначала вызови ensureModel(${ModelStore.GIGAAM_MODEL_ID})")
      }

      checkCancelled()

      val opened = handoff?.mic ?: Mic.open(SAMPLE_RATE, WINDOW, options.echoCancellation)
      mic = opened
      val audio = opened.recorder

      var microphoneReadyAtNs = 0L
      var speechDetectedAtNs = 0L
      var vadEndDetectedAtNs = 0L
      var recordingStoppedAtNs = 0L
      var firstAudioReadAtNs = 0L
      var trailingSilenceMs: Long? = null
      val debugBuild = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
      val preVadCapture = if (debugBuild && options.saveAudio) SampleBuffer(PRE_VAD_CAPTURE_SAMPLES) else null
      val samples = try {
        checkCancelled()
        val vad = Vad(
          assetManager = null,
          config = VadModelConfig(
            sileroVadModelConfig = SileroVadModelConfig(
              model = paths.silero.absolutePath,
              threshold = options.vadThreshold,
              minSilenceDuration = options.vadMinSilenceSec,
              minSpeechDuration = options.vadMinSpeechSec,
              windowSize = WINDOW,
              maxSpeechDuration = options.maxDurationSec,
            ),
            sampleRate = SAMPLE_RATE,
            numThreads = options.numThreads,
            provider = "cpu",
          ),
        )
        // Отдельный экземпляр только для вероятности речи по окнам (compute): основной VAD держит
        // речь «включённой» до vadMinSilenceSec, а короткую паузу внутри реплики не показывает.
        val pauseVad = if (options.speechPauseMs > 0 &&
            options.speechPauseMs < options.vadMinSilenceSec * 1000f) {
          Vad(
            assetManager = null,
            config = VadModelConfig(
              sileroVadModelConfig = SileroVadModelConfig(
                model = paths.silero.absolutePath,
                threshold = options.vadThreshold,
                minSilenceDuration = options.speechPauseMs / 1000f,
                minSpeechDuration = options.vadMinSpeechSec,
                windowSize = WINDOW,
                maxSpeechDuration = options.maxDurationSec,
              ),
              sampleRate = SAMPLE_RATE,
              numThreads = 1,
              provider = "cpu",
            ),
          )
        } else {
          null
        }

        val utterance = SampleBuffer((options.maxDurationSec * SAMPLE_RATE).toInt())
        val preRoll = SampleRing(((options.vadMinSpeechSec + PRE_ROLL_PAD_SEC) * SAMPLE_RATE).toInt())
        val readBuffer = ShortArray(WINDOW)
        val pending = ShortArray(WINDOW)
        val frame = FloatArray(WINDOW)
        var pendingCount = 0
        var speechStarted = false
        var ended = false
        var lastListenProgress = -1
        val listenStartedAt = SystemClock.elapsedRealtime()
        var speechStartedAt = listenStartedAt
        var processedSamples = 0
        var levelSamples = 0
        var levelEnergy = 0.0
        var levelPeak = 0.0f
        val eventLevelWindow = options.audioLevelIntervalMs * SAMPLE_RATE / 1000
        var eventLevelSamples = 0
        var eventLevelEnergy = 0.0
        var eventLevelPeak = 0.0f
        var frameSpeech = false
        var pauseSilenceSamples = 0
        var paused = false

        fun logInputLevel(reason: String) {
          if (levelSamples == 0) return
          val rms = sqrt(levelEnergy / levelSamples)
          val rmsDb = (20.0 * log10(max(rms, 1e-7))).roundToInt()
          val peakDb = (20.0 * log10(max(levelPeak.toDouble(), 1e-7))).roundToInt()
          val sinceMicMs = (SystemClock.elapsedRealtimeNanos() - microphoneReadyAtNs) / 1_000_000
          Log.i(INPUT_TAG, "preVad untilMs=$sinceMicMs rmsDbFS=$rmsDb peakDbFS=$peakDb reason=$reason")
          levelSamples = 0
          levelEnergy = 0.0
          levelPeak = 0.0f
        }

        fun emitAudioLevel() {
          if (eventLevelWindow <= 0) return
          for (sample in frame) {
            eventLevelEnergy += sample.toDouble() * sample.toDouble()
            eventLevelPeak = max(eventLevelPeak, abs(sample))
          }
          eventLevelSamples += WINDOW
          if (eventLevelSamples < eventLevelWindow) return
          val rms = sqrt(eventLevelEnergy / eventLevelSamples)
          NaslukhEvents.sendLatest(
            NaslukhEvents.AUDIO_LEVEL,
            mapOf(
              "sessionId" to id,
              "rmsDbfs" to (20.0 * log10(max(rms, 1e-7))).coerceIn(-90.0, 0.0),
              "peak" to eventLevelPeak.toDouble().coerceIn(0.0, 1.0),
              "speech" to frameSpeech,
              "timestampMs" to processedSamples.toLong() * 1000L / SAMPLE_RATE,
            ),
            levelPending,
          )
          eventLevelSamples = 0
          eventLevelEnergy = 0.0
          eventLevelPeak = 0.0f
        }

        fun trackPause() {
          val detector = pauseVad ?: return
          val speechNow = detector.compute(frame) >= options.vadThreshold
          frameSpeech = speechNow
          if (!speechStarted) return
          if (speechNow) {
            pauseSilenceSamples = 0
            if (paused) {
              paused = false
              NaslukhEvents.send(NaslukhEvents.SPEECH_RESUME, mapOf("sessionId" to id))
            }
            return
          }
          pauseSilenceSamples += WINDOW
          val silenceMs = pauseSilenceSamples * 1000 / SAMPLE_RATE
          if (!paused && silenceMs >= options.speechPauseMs) {
            paused = true
            NaslukhEvents.send(
              NaslukhEvents.SPEECH_PAUSE,
              mapOf(
                "sessionId" to id,
                "silenceMs" to silenceMs,
                "utteranceMs" to utterance.size.toLong() * 1000L / SAMPLE_RATE,
              ),
            )
          }
        }

        fun processFrame(): Boolean {
          preRoll.append(frame)
          vad.acceptWaveform(frame)
          val detected = vad.isSpeechDetected()
          if (pauseVad == null) frameSpeech = detected

          if (!speechStarted && detected) {
            speechStarted = true
            speechDetectedAtNs = SystemClock.elapsedRealtimeNanos()
            speechStartedAt = SystemClock.elapsedRealtime()
            utterance.append(preRoll.snapshot())
            ProgressBus.send("listen", 0.2, "Речь обнаружена")
          } else if (speechStarted) {
            utterance.append(frame)
          }

          trackPause()
          emitAudioLevel()
          // Silero кладёт сегмент в очередь только после minSilenceDuration.
          return speechStarted && !vad.empty()
        }

        /** Звук, захваченный монитором до передачи: те же окна, что и с микрофона. */
        fun feedHandoff(samples: FloatArray) {
          var at = 0
          while (at + WINDOW <= samples.size && !ended) {
            System.arraycopy(samples, at, frame, 0, WINDOW)
            at += WINDOW
            processedSamples += WINDOW
            ended = processFrame()
            if (ended) {
              vadEndDetectedAtNs = SystemClock.elapsedRealtimeNanos()
              trailingSilenceMs = 0L
            }
          }
          while (at < samples.size && !ended) {
            pending[pendingCount++] = (samples[at++] * 32768f).toInt().coerceIn(-32768, 32767).toShort()
          }
        }

        try {
          checkCancelled()
          if (handoff != null) {
            // Микрофон уже пишет: его открыл монитор речи.
            microphoneReadyAtNs = SystemClock.elapsedRealtimeNanos()
            feedHandoff(handoff.samples)
          } else if (!stopRequested.get()) {
            opened.start()
            microphoneReadyAtNs = SystemClock.elapsedRealtimeNanos()
          }
          ProgressBus.send("listen", 0.02, "Слушаем…")

          while (!ended && !stopRequested.get()) {
            checkCancelled()
            val elapsedSec = (SystemClock.elapsedRealtime() - listenStartedAt) / 1000f
            if (!speechStarted && elapsedSec >= options.startTimeoutSec) {
              throw IllegalStateException("Речь не обнаружена за ${options.startTimeoutSec} с")
            }
            if (speechStarted &&
                (SystemClock.elapsedRealtime() - speechStartedAt) / 1000f >= options.maxDurationSec) {
              break
            }

            val count = try {
              audio.read(readBuffer, 0, readBuffer.size, AudioRecord.READ_BLOCKING)
            } catch (e: IllegalStateException) {
              checkCancelled()
              if (stopRequested.get()) break
              throw e
            }
            if (count < 0) {
              checkCancelled()
              if (stopRequested.get()) break
              throw IllegalStateException("Ошибка чтения микрофона: $count")
            }
            if (count == 0) continue
            if (firstAudioReadAtNs == 0L) firstAudioReadAtNs = SystemClock.elapsedRealtimeNanos()
            var offset = 0
            while (offset < count && !ended) {
              val take = min(WINDOW - pendingCount, count - offset)
              System.arraycopy(readBuffer, offset, pending, pendingCount, take)
              pendingCount += take
              offset += take
              if (pendingCount == WINDOW) {
                for (i in 0 until WINDOW) frame[i] = pending[i] / 32768.0f
                pendingCount = 0
                processedSamples += WINDOW
                if (!speechStarted && preVadCapture != null) {
                  if (preVadCapture.size < PRE_VAD_CAPTURE_SAMPLES) preVadCapture.append(frame)
                  for (sample in frame) {
                    levelEnergy += sample.toDouble() * sample.toDouble()
                    levelPeak = max(levelPeak, abs(sample))
                  }
                  levelSamples += WINDOW
                  if (levelSamples >= SAMPLE_RATE / 2) logInputLevel("window")
                }
                ended = processFrame()
                if (speechStarted && preVadCapture != null) logInputLevel("vadStart")
                if (ended) {
                  vadEndDetectedAtNs = SystemClock.elapsedRealtimeNanos()
                  val segment = vad.front()
                  val trailingSamples = (processedSamples.toLong() - segment.start.toLong() -
                    segment.samples.size.toLong()).coerceAtLeast(0L)
                  trailingSilenceMs = trailingSamples * 1000L / SAMPLE_RATE
                }
                val listenPct = if (speechStarted) {
                  20 + (((SystemClock.elapsedRealtime() - speechStartedAt) /
                    (options.maxDurationSec * 1000f)) * 60).toInt()
                } else {
                  (((SystemClock.elapsedRealtime() - listenStartedAt) /
                    (options.startTimeoutSec * 1000f)) * 15).toInt()
                }
                if (listenPct / 5 != lastListenProgress / 5) {
                  lastListenProgress = listenPct
                  ProgressBus.send(
                    "listen",
                    (listenPct / 100.0).coerceIn(0.02, 0.8),
                    if (speechStarted) "Говори…" else "Слушаем…",
                  )
                }
              }
            }
          }

          if (pendingCount > 0 && speechStarted) {
            val tail = FloatArray(pendingCount) { i -> pending[i] / 32768.0f }
            utterance.append(tail)
          }
          checkCancelled()
          if (!speechStarted || utterance.size < (MIN_UTTERANCE_SEC * SAMPLE_RATE).toInt()) {
            throw IllegalStateException("Речь слишком короткая")
          }
          utterance.toArray()
        } finally {
          vad.release()
          pauseVad?.release()
        }
      } finally {
        close()
        recordingStoppedAtNs = SystemClock.elapsedRealtimeNanos()
      }

      checkCancelled()
      val durationMs = (samples.size * 1000L) / SAMPLE_RATE
      ProgressBus.send("asr", 0.1, "Подготовка GigaAM…")
      val recognizerStartedAtNs = SystemClock.elapsedRealtimeNanos()
      val (recognizer, recognizerReused) = LiveListen.recognizerFor(paths, options.numThreads)
      val recognizerReadyAtNs = SystemClock.elapsedRealtimeNanos()
      checkCancelled()
      ProgressBus.send("asr", 0.35, "Распознаём фразу…")
      val recognitionStartedAtNs = SystemClock.elapsedRealtimeNanos()
      val recognized = try {
        AsrPipeline.recognizeUtterance(
          recognizer = recognizer,
          samples = samples,
          isCancelled = { cancelled.get() },
        )
      } catch (e: Throwable) {
        LiveListen.discardRecognizer(recognizer)
        throw e
      }
      val textReadyAtNs = SystemClock.elapsedRealtimeNanos()
      checkCancelled()
      val audioUri = if (options.saveAudio) writeWav(context, samples) else null
      if (preVadCapture != null && preVadCapture.size > 0) {
        val rawUri = writeWav(context, preVadCapture.toArray(), PRE_VAD_WAV)
        Log.i(INPUT_TAG, "preVadWav=$rawUri durationMs=${preVadCapture.size * 1000L / SAMPLE_RATE}")
      }
      checkCancelled()
      val timing = JSONObject()
        .put("microphonePreparationMs", (microphoneReadyAtNs - nativeStartedAtNs) / 1_000_000)
        .put("firstAudioReadMs", (firstAudioReadAtNs - microphoneReadyAtNs) / 1_000_000)
        .put("speechStartDetectionMs", (speechDetectedAtNs - microphoneReadyAtNs) / 1_000_000)
        .put("utteranceEndDetectionMs", if (vadEndDetectedAtNs == 0L) JSONObject.NULL
          else (vadEndDetectedAtNs - speechDetectedAtNs) / 1_000_000)
        .put("trailingSilenceMs", trailingSilenceMs ?: JSONObject.NULL)
        .put("recognizerCreationMs", (recognizerReadyAtNs - recognizerStartedAtNs) / 1_000_000)
        .put("recognizerReused", recognizerReused)
        .put("recognitionMs", (textReadyAtNs - recognitionStartedAtNs) / 1_000_000)
        .put("endToTextMs", (textReadyAtNs - recordingStoppedAtNs) / 1_000_000)
        .put("endReason", if (vadEndDetectedAtNs != 0L) "vad"
          else if (stopRequested.get()) "stop" else "limit")
        .toString()
      Log.i(TIMING_TAG, "$TIMING_PREFIX$timing")
      ProgressBus.send("asr", 1.0, "$TIMING_PREFIX$timing")
      ProgressBus.send("asr", 1.0, "Готово")
      return Result(id, recognized.text, recognized.segment, durationMs, audioUri)
    }

    private fun writeWav(context: Context, samples: FloatArray, filename: String = "naslukh-last-phrase.wav"): String {
      val dataBytes = samples.size * 2
      val wav = ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN)
      wav.put("RIFF".toByteArray(Charsets.US_ASCII))
      wav.putInt(36 + dataBytes)
      wav.put("WAVEfmt ".toByteArray(Charsets.US_ASCII))
      wav.putInt(16)
      wav.putShort(1) // PCM
      wav.putShort(1) // mono
      wav.putInt(SAMPLE_RATE)
      wav.putInt(SAMPLE_RATE * 2)
      wav.putShort(2)
      wav.putShort(16)
      wav.put("data".toByteArray(Charsets.US_ASCII))
      wav.putInt(dataBytes)
      for (sample in samples) {
        wav.putShort((sample * 32768f).toInt().coerceIn(-32768, 32767).toShort())
      }
      val file = File(context.cacheDir, filename)
      file.writeBytes(wav.array())
      return Uri.fromFile(file).toString()
    }

    fun cancel() {
      cancelled.set(true)
      requestStop()
    }

    fun stop() {
      requestStop()
    }

    private fun requestStop() {
      stopRequested.set(true)
      // The read loop observes the stop flag.
      mic?.interrupt()
    }

    fun close() {
      val current = mic ?: return
      mic = null
      current.release()
    }

    private fun checkCancelled() {
      if (cancelled.get()) throw IllegalStateException(CANCELLED_MESSAGE)
    }

    private fun checkPermission(context: Context) {
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw SecurityException("Нужен доступ к микрофону")
      }
    }

    private fun freeMemoryBytes(context: Context): Long {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
      val info = android.app.ActivityManager.MemoryInfo()
      manager.getMemoryInfo(info)
      return info.availMem
    }
  }

  internal class SampleBuffer(initialCapacity: Int) {
    private var data = FloatArray(max(1, initialCapacity))
    var size: Int = 0
      private set

    fun append(samples: FloatArray) {
      ensureCapacity(size + samples.size)
      System.arraycopy(samples, 0, data, size, samples.size)
      size += samples.size
    }

    fun toArray(): FloatArray = data.copyOf(size)

    private fun ensureCapacity(required: Int) {
      if (required <= data.size) return
      var next = data.size
      while (next < required) next = max(next * 2, required)
      data = data.copyOf(next)
    }
  }

  internal class SampleRing(private val capacity: Int) {
    private val data = FloatArray(max(1, capacity))
    private var size = 0
    private var writeAt = 0

    fun append(samples: FloatArray) {
      for (sample in samples) {
        data[writeAt] = sample
        writeAt = (writeAt + 1) % data.size
        size = min(size + 1, data.size)
      }
    }

    fun snapshot(): FloatArray {
      val out = FloatArray(size)
      val start = (writeAt - size + data.size) % data.size
      for (i in 0 until size) out[i] = data[(start + i) % data.size]
      return out
    }
  }
}
