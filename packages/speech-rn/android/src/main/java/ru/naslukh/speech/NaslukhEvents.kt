package ru.naslukh.speech

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

/**
 * События живого прослушивания native → Expo Events: уровень сигнала, пауза в реплике, монитор речи.
 * В отличие от ProgressBus подписчик ставится на всё время жизни модуля (OnCreate/OnDestroy),
 * потому что монитор речи работает и между вызовами. Эмит всегда на main looper.
 */
object NaslukhEvents {
  const val AUDIO_LEVEL = "onAudioLevel"
  const val SPEECH_PAUSE = "onSpeechPause"
  const val SPEECH_RESUME = "onSpeechResume"
  const val MONITOR_SPEECH = "onMonitorSpeech"
  /** Кусок реплики расшифрован (черновой текст), реплика ещё идёт. */
  const val LISTEN_SEGMENT = "onListenSegment"

  private const val TAG = "NaslukhEvents"
  private val mainHandler = Handler(Looper.getMainLooper())

  @Volatile
  var sink: ((name: String, body: Map<String, Any?>) -> Unit)? = null

  fun send(name: String, body: Map<String, Any?>) {
    val listener = sink ?: return
    mainHandler.post {
      try {
        listener.invoke(name, body)
      } catch (e: Exception) {
        Log.w(TAG, "emit failed: $name", e)
      }
    }
  }

  /**
   * Событие, которое нельзя доставлять после отмены: условие проверяется ещё раз на main looper
   * непосредственно перед отправкой в JS.
   */
  fun sendIf(condition: () -> Boolean, name: String, body: Map<String, Any?>) {
    val listener = sink ?: return
    if (!condition()) return
    mainHandler.post {
      if (!condition()) return@post
      try {
        listener.invoke(name, body)
      } catch (e: Exception) {
        Log.w(TAG, "emit failed: $name", e)
      }
    }
  }

  /**
   * Частое событие (уровень сигнала): пока предыдущее не доставлено, новое отбрасывается,
   * чтобы при медленном JS-потоке события не копились в очереди.
   */
  fun sendLatest(name: String, body: Map<String, Any?>, pending: AtomicBoolean) {
    val listener = sink ?: return
    if (!pending.compareAndSet(false, true)) return
    mainHandler.post {
      pending.set(false)
      try {
        listener.invoke(name, body)
      } catch (e: Exception) {
        Log.w(TAG, "emit failed: $name", e)
      }
    }
  }
}
