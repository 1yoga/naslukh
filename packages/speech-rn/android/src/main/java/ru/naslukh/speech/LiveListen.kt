package ru.naslukh.speech

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max
import kotlin.math.min

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
  private const val MIN_UTTERANCE_SEC = 0.08f
  private const val CANCELLED_MESSAGE = "Прослушивание отменено"

  private val active = AtomicReference<Session?>(null)

  data class Options(
    val vadThreshold: Float = 0.15f,
    val vadMinSpeechSec: Float = 0.25f,
    val vadMinSilenceSec: Float = 0.25f,
    val numThreads: Int = 2,
    val startTimeoutSec: Float = DEFAULT_START_TIMEOUT_SEC,
    val maxDurationSec: Float = DEFAULT_MAX_DURATION_SEC,
  ) {
    companion object {
      fun fromMap(raw: Map<String, Any?>?): Options {
        if (raw == null) return Options()
        return Options(
          vadThreshold = ((raw["vadThreshold"] as? Number)?.toFloat() ?: 0.15f)
            .coerceIn(0.01f, 0.99f),
          vadMinSpeechSec = ((raw["vadMinSpeechSec"] as? Number)?.toFloat() ?: 0.25f)
            .coerceIn(0.05f, 2f),
          vadMinSilenceSec = ((raw["vadMinSilenceSec"] as? Number)?.toFloat() ?: 0.25f)
            .coerceIn(0.05f, 3f),
          numThreads = ((raw["numThreads"] as? Number)?.toInt() ?: 2).coerceIn(1, 4),
          startTimeoutSec = ((raw["startTimeoutSec"] as? Number)?.toFloat()
            ?: DEFAULT_START_TIMEOUT_SEC).coerceIn(1f, 120f),
          maxDurationSec = ((raw["maxDurationSec"] as? Number)?.toFloat()
            ?: DEFAULT_MAX_DURATION_SEC).coerceIn(2f, 30f),
        )
      }
    }
  }

  data class Result(
    val text: String,
    val segment: AsrPipeline.SegmentOut,
    val durationMs: Long,
  )

  fun listenOnce(context: Context, options: Options = Options()): Result {
    val session = Session()
    if (!active.compareAndSet(null, session)) {
      throw IllegalStateException("Прослушивание уже запущено")
    }
    return try {
      session.run(context.applicationContext, options)
    } finally {
      session.close()
      active.compareAndSet(session, null)
    }
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
    private val cancelled = AtomicBoolean(false)
    private val stopRequested = AtomicBoolean(false)

    @Volatile
    private var recorder: AudioRecord? = null

    @SuppressLint("MissingPermission")
    fun run(context: Context, options: Options): Result {
      checkPermission(context)
      Checkpoint.assertCanStart(freeMemoryBytes(context))

      val paths = ModelStore.paths(context)
      if (!ModelStore.isReady(paths)) {
        throw IllegalStateException("Сначала вызови ensureModel(${ModelStore.GIGAAM_MODEL_ID})")
      }

      checkCancelled()
      ProgressBus.send("asr", 0.1, "Загрузка GigaAM…")
      val recognizer = AsrPipeline.createRecognizer(paths, options.numThreads)
      try {
        checkCancelled()

        val minBufferBytes = AudioRecord.getMinBufferSize(
          SAMPLE_RATE,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBufferBytes <= 0) {
          throw IllegalStateException("Устройство не поддерживает запись PCM 16 кГц")
        }
        val bufferBytes = maxOf(minBufferBytes, WINDOW * 2 * 4)
        val audio = AudioRecord.Builder()
          .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(SAMPLE_RATE)
              .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
              .build(),
          )
          .setBufferSizeInBytes(bufferBytes)
          .build()
        recorder = audio
        if (audio.state != AudioRecord.STATE_INITIALIZED) {
          audio.release()
          recorder = null
          throw IllegalStateException("Не удалось открыть микрофон")
        }

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

          fun processFrame(): Boolean {
            preRoll.append(frame)
            vad.acceptWaveform(frame)
            val detected = vad.isSpeechDetected()

            if (!speechStarted && detected) {
              speechStarted = true
              speechStartedAt = SystemClock.elapsedRealtime()
              utterance.append(preRoll.snapshot())
              ProgressBus.send("listen", 0.2, "Речь обнаружена")
            } else if (speechStarted) {
              utterance.append(frame)
            }

            // Silero кладёт сегмент в очередь только после minSilenceDuration.
            return speechStarted && !vad.empty()
          }

          try {
            checkCancelled()
            if (!stopRequested.get()) {
              audio.startRecording()
              if (audio.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                throw IllegalStateException("Микрофон не начал запись")
              }
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
              var offset = 0
              while (offset < count && !ended) {
                val take = min(WINDOW - pendingCount, count - offset)
                System.arraycopy(readBuffer, offset, pending, pendingCount, take)
                pendingCount += take
                offset += take
                if (pendingCount == WINDOW) {
                  for (i in 0 until WINDOW) frame[i] = pending[i] / 32768.0f
                  pendingCount = 0
                  ended = processFrame()
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
          }
        } finally {
          close()
        }

        checkCancelled()
        val durationMs = (samples.size * 1000L) / SAMPLE_RATE
        ProgressBus.send("asr", 0.35, "Распознаём фразу…")
        val recognized = AsrPipeline.recognizeUtterance(
          recognizer = recognizer,
          samples = samples,
          isCancelled = { cancelled.get() },
        )
        checkCancelled()
        ProgressBus.send("asr", 1.0, "Готово")
        return Result(recognized.text, recognized.segment, durationMs)
      } finally {
        recognizer.release()
      }
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
      val current = recorder
      if (current != null) {
        try {
          if (current.recordingState == AudioRecord.RECORDSTATE_RECORDING) current.stop()
        } catch (_: Exception) {
          /* the read loop observes the stop flag */
        }
      }
    }

    fun close() {
      val current = recorder ?: return
      recorder = null
      try {
        if (current.recordingState == AudioRecord.RECORDSTATE_RECORDING) current.stop()
      } catch (_: Exception) {
      }
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

  private class SampleBuffer(initialCapacity: Int) {
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

  private class SampleRing(private val capacity: Int) {
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
