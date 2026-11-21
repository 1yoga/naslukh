package ru.naslukh.speech

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Нативный мост Android: ensureModel + transcribeFile + listenOnce + монитор речи,
 * события прогресса и живого прослушивания (уровень, пауза в реплике, речь во время воспроизведения).
 */
class NaslukhSpeechModule : Module() {
  companion object {
    private const val TAG = "NaslukhSpeech"
  }

  override fun definition() = ModuleDefinition {
    Name("NaslukhSpeech")

    Events(
      "onProgress",
      NaslukhEvents.AUDIO_LEVEL,
      NaslukhEvents.SPEECH_PAUSE,
      NaslukhEvents.SPEECH_RESUME,
      NaslukhEvents.MONITOR_SPEECH,
    )

    OnCreate {
      NaslukhEvents.sink = { name, body ->
        try {
          sendEvent(name, body)
        } catch (e: Exception) {
          Log.w(TAG, "sendEvent $name failed", e)
        }
      }
    }

    OnDestroy {
      NaslukhEvents.sink = null
      SpeechMonitors.onModuleDestroy()
      LiveListen.onModuleDestroy()
    }

    Function("isEchoCancellationAvailable") {
      Mic.echoCancellationAvailable()
    }

    AsyncFunction("ensureModel") { modelId: String ->
      val ctx = appContext.reactContext
        ?: throw Exception("React context недоступен")
      withProgress {
        ModelStore.ensure(ctx, modelId)
      }
    }

    AsyncFunction("transcribeFile") { uri: String, options: Map<String, Any?>? ->
      val ctx = appContext.reactContext
        ?: throw Exception("React context недоступен")
      withProgress {
        val result = AsrPipeline.transcribeFile(ctx, uri, AsrPipeline.Options.fromMap(options))
        mapOf(
          "jobId" to result.jobId,
          "text" to result.text,
          "resumed" to result.resumed,
          "fromCache" to result.fromCache,
          "segments" to result.segments.map { seg ->
            mapOf(
              "startSample" to seg.startSample,
              "endSample" to seg.endSample,
              "text" to seg.text,
              "status" to "done",
              "modelVersion" to ModelStore.GIGAAM_MODEL_ID,
            )
          },
        )
      }
    }

    AsyncFunction("listenOnce") Coroutine { options: Map<String, Any?>? ->
      val ctx = appContext.reactContext
        ?: throw Exception("React context недоступен")
      val result = withProgressSuspend {
        withContext(Dispatchers.IO) {
          LiveListen.listenOnce(ctx, LiveListen.Options.fromMap(options))
        }
      }
      mapOf(
        "sessionId" to result.sessionId,
        "text" to result.text,
        "durationMs" to result.durationMs,
        "audioUri" to result.audioUri,
        "segments" to listOf(
          mapOf(
            "startSample" to result.segment.startSample,
            "endSample" to result.segment.endSample,
            "text" to result.segment.text,
            "status" to "done",
            "modelVersion" to ModelStore.GIGAAM_MODEL_ID,
          ),
        ),
      )
    }

    AsyncFunction("cancelListenOnce") {
      LiveListen.cancel()
    }

    AsyncFunction("stopListenOnce") {
      LiveListen.stop()
    }

    AsyncFunction("startSpeechMonitor") { options: Map<String, Any?>? ->
      val ctx = appContext.reactContext
        ?: throw Exception("React context недоступен")
      SpeechMonitors.start(ctx, SpeechMonitors.Options.fromMap(options))
    }

    AsyncFunction("stopSpeechMonitor") { monitorId: String? ->
      SpeechMonitors.stop(monitorId)
    }
  }

  private fun <T> withProgress(block: () -> T): T {
    ProgressBus.emit = { phase, progress, message ->
      try {
        sendEvent(
          "onProgress",
          mapOf(
            "phase" to phase,
            "progress" to progress,
            "message" to message,
          ),
        )
      } catch (e: Exception) {
        Log.w(TAG, "sendEvent onProgress failed", e)
      }
    }
    try {
      return block()
    } finally {
      ProgressBus.emit = null
    }
  }

  private suspend fun <T> withProgressSuspend(block: suspend () -> T): T {
    ProgressBus.emit = { phase, progress, message ->
      try {
        sendEvent(
          "onProgress",
          mapOf(
            "phase" to phase,
            "progress" to progress,
            "message" to message,
          ),
        )
      } catch (e: Exception) {
        Log.w(TAG, "sendEvent onProgress failed", e)
      }
    }
    try {
      return block()
    } finally {
      ProgressBus.emit = null
    }
  }
}
