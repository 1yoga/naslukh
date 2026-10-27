package ru.naslukh.speech

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Нативный мост Android.
 * ensureModel / transcribeFile: каркас под sherpa-onnx GigaAM.
 * Пока нет AAR в APK — возвращаем понятную ошибку, JS-заглушка в __DEV__.
 */
class NaslukhSpeechModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NaslukhSpeech")

    AsyncFunction("ensureModel") { modelId: String ->
      val dir = File(appContext.reactContext?.filesDir, "naslukh-models/$modelId")
      dir.mkdirs()
      dir.absolutePath
    }

    AsyncFunction("transcribeFile") { uri: String ->
      val path = uri.removePrefix("file://")
      val file = File(path)
      if (!file.exists()) {
        throw Exception("Файл не найден: $uri")
      }
      // TODO: sherpa-onnx Silero + GigaAM RNN-T
      mapOf(
        "text" to "",
        "segments" to emptyList<Map<String, Any>>()
      )
    }
  }
}
