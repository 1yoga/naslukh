package ru.naslukh.speech

import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Мост прогресса native → Expo Events (скачивание / ASR).
 * Подписчик ставит NaslukhSpeechModule на время вызова.
 * Эмит всегда на main looper — иначе JS не видит события с AsyncFunction.
 */
object ProgressBus {
  private const val TAG = "NaslukhProgress"
  private val mainHandler = Handler(Looper.getMainLooper())

  @Volatile
  var emit: ((phase: String, progress: Double, message: String) -> Unit)? = null

  fun send(phase: String, progress: Double, message: String) {
    val p = progress.coerceIn(0.0, 1.0)
    val listener = emit
    if (listener == null) {
      Log.d(TAG, "drop $phase ${(p * 100).toInt()}% $message (no listener)")
      return
    }
    val run = Runnable {
      try {
        listener.invoke(phase, p, message)
      } catch (e: Exception) {
        Log.w(TAG, "emit failed: $phase $message", e)
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      run.run()
    } else {
      mainHandler.post(run)
    }
  }
}
