package ru.naslukh.speech

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Нативный мост Android: ensureModel + transcribeFile + события прогресса.
 */
class NaslukhSpeechModule : Module() {
  companion object {
    private const val TAG = "NaslukhSpeech"
  }

  override fun definition() = ModuleDefinition {
    Name("NaslukhSpeech")

    Events("onProgress")

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
}
