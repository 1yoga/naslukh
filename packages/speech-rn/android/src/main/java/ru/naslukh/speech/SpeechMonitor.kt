package ru.naslukh.speech

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioRecord
import android.util.Log
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Монитор речи: слушает микрофон (обычно с эхоподавлением), пока приложение воспроизводит синтез,
 * и сообщает onMonitorSpeech, когда пользователь заговорил. Захват и звук с запасом prerollMs
 * передаются в listenOnce({ continueFromMonitor }) — второй AudioRecord не открывается,
 * начало фразы не теряется.
 */
object SpeechMonitors {
  private const val SAMPLE_RATE = Chunking.SAMPLE_RATE
  private const val WINDOW = 512
  private const val TAG = "NaslukhMonitor"

  data class Options(
    val vadThreshold: Float = 0.6f,
    val minSpeechMs: Int = 300,
    val prerollMs: Int = 600,
    val echoCancellation: Boolean = true,
    val maxBufferSec: Float = 30f,
  ) {
    companion object {
      fun fromMap(raw: Map<String, Any?>?): Options {
        if (raw == null) return Options()
        return Options(
          vadThreshold = ((raw["vadThreshold"] as? Number)?.toFloat() ?: 0.6f).coerceIn(0.01f, 0.99f),
          minSpeechMs = ((raw["minSpeechMs"] as? Number)?.toInt() ?: 300).coerceIn(50, 2000),
          prerollMs = ((raw["prerollMs"] as? Number)?.toInt() ?: 600).coerceIn(0, 3000),
          echoCancellation = raw["echoCancellation"] as? Boolean ?: true,
        )
      }
    }
  }

  /** Захват, переданный из монитора в listenOnce. */
  internal class Handoff(val mic: Mic, val samples: FloatArray)

  private val current = AtomicReference<Monitor?>(null)

  fun isActive(): Boolean = current.get() != null

  fun start(context: Context, options: Options): String {
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw SecurityException("Нужен доступ к микрофону")
    }
    if (LiveListen.isActive()) throw IllegalStateException("Идёт listenOnce: монитор не запущен")
    val paths = ModelStore.paths(context)
    if (!ModelStore.isReady(paths)) {
      throw IllegalStateException("Сначала вызови ensureModel(${ModelStore.GIGAAM_MODEL_ID})")
    }
    val monitor = Monitor(UUID.randomUUID().toString(), options)
    if (!current.compareAndSet(null, monitor)) throw IllegalStateException("Монитор речи уже запущен")
    try {
      monitor.start(paths.silero.absolutePath)
    } catch (e: Throwable) {
      current.compareAndSet(monitor, null)
      throw e
    }
    return monitor.id
  }

  /** Останавливает монитор и освобождает микрофон. id = null — любой активный. */
  fun stop(id: String?): Boolean {
    val monitor = current.get() ?: return false
    if (id != null && monitor.id != id) return false
    if (!current.compareAndSet(monitor, null)) return false
    monitor.stopAndRelease()
    return true
  }

  /** Забирает захват монитора для listenOnce. Монитор после этого не активен. */
  internal fun takeOver(id: String): Handoff {
    val monitor = current.get()
    if (monitor == null || monitor.id != id) throw IllegalStateException("Монитор речи $id не активен")
    if (!current.compareAndSet(monitor, null)) throw IllegalStateException("Монитор речи $id уже остановлен")
    return monitor.handOff()
  }

  fun onModuleDestroy() {
    stop(null)
  }

  private class Monitor(val id: String, private val options: Options) {
    private val running = AtomicBoolean(true)
    private var thread: Thread? = null
    private var mic: Mic? = null

    // Пишутся только потоком захвата; читаются после join().
    private val preRoll = LiveListen.SampleRing(
      ((options.prerollMs + options.minSpeechMs) * SAMPLE_RATE / 1000).coerceAtLeast(WINDOW),
    )
    private var captured: LiveListen.SampleBuffer? = null
    private var failure: Throwable? = null

    fun start(sileroPath: String) {
      val opened = Mic.open(SAMPLE_RATE, WINDOW, options.echoCancellation)
      mic = opened
      try {
        opened.start()
      } catch (e: Throwable) {
        opened.release()
        mic = null
        throw e
      }
      val worker = Thread({ loop(opened, sileroPath) }, "NaslukhMonitor")
      thread = worker
      worker.start()
    }

    private fun loop(mic: Mic, sileroPath: String) {
      val vad = Vad(
        assetManager = null,
        config = VadModelConfig(
          sileroVadModelConfig = SileroVadModelConfig(
            model = sileroPath,
            threshold = options.vadThreshold,
            minSilenceDuration = 0.3f,
            minSpeechDuration = options.minSpeechMs / 1000f,
            windowSize = WINDOW,
            maxSpeechDuration = options.maxBufferSec,
          ),
          sampleRate = SAMPLE_RATE,
          numThreads = 1,
          provider = "cpu",
        ),
      )
      val read = ShortArray(WINDOW)
      val frame = FloatArray(WINDOW)
      var filled = 0
      val maxSamples = (options.maxBufferSec * SAMPLE_RATE).toInt()
      try {
        while (running.get()) {
          val count = try {
            mic.recorder.read(read, filled, WINDOW - filled, AudioRecord.READ_BLOCKING)
          } catch (e: IllegalStateException) {
            if (!running.get()) break
            throw e
          }
          if (count < 0) {
            if (!running.get()) break
            throw IllegalStateException("Ошибка чтения микрофона: $count")
          }
          filled += count
          if (filled < WINDOW) continue
          filled = 0
          for (i in 0 until WINDOW) frame[i] = read[i] / 32768.0f

          val buffer = captured
          if (buffer != null) {
            // Пользователь уже заговорил: копим реплику до передачи в listenOnce.
            if (buffer.size < maxSamples) buffer.append(frame)
            continue
          }
          preRoll.append(frame)
          vad.acceptWaveform(frame)
          while (!vad.empty()) vad.pop()
          if (vad.isSpeechDetected()) {
            captured = LiveListen.SampleBuffer(maxSamples).also { it.append(preRoll.snapshot()) }
            NaslukhEvents.send(
              NaslukhEvents.MONITOR_SPEECH,
              mapOf("monitorId" to id, "speechMs" to options.minSpeechMs),
            )
          }
        }
      } catch (e: Throwable) {
        failure = e
        Log.w(TAG, "monitor $id stopped", e)
      } finally {
        vad.release()
      }
    }

    private fun stopThread() {
      running.set(false)
      // Блокирующее чтение возвращается не позже одного окна (32 мс).
      thread?.join(1000)
      if (thread?.isAlive == true) {
        mic?.interrupt()
        thread?.join(1000)
      }
    }

    fun stopAndRelease() {
      stopThread()
      mic?.release()
      mic = null
    }

    fun handOff(): Handoff {
      stopThread()
      val owned = mic ?: throw IllegalStateException("Монитор речи без микрофона")
      mic = null
      failure?.let {
        owned.release()
        throw IllegalStateException("Монитор речи остановился с ошибкой: ${it.message}")
      }
      if (!owned.isRecording) {
        owned.release()
        throw IllegalStateException("Монитор речи потерял микрофон")
      }
      val samples = captured?.toArray() ?: preRoll.snapshot()
      return Handoff(owned, samples)
    }
  }
}
