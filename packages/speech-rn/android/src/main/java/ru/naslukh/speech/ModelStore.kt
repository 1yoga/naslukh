package ru.naslukh.speech

import android.content.Context
import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.ZipInputStream

/**
 * Модели в filesDir/naslukh-models/.
 * Если нет — скачиваем zip со своего хоста (D16) и проверяем SHA-256.
 */
object ModelStore {
  private const val TAG = "NaslukhModels"
  const val GIGAAM_MODEL_ID = "gigaam-v3-e2e-rnnt-int8"
  private const val GIGAAM_DIR_NAME =
    "sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16"

  /** Cloudflare R2 / custom domain — залей dist/naslukh-models-0.1.0.zip */
  const val MODELS_ZIP_URL = "https://models.1yoga.link/naslukh-models-0.1.0.zip"
  const val MODELS_ZIP_SHA256 =
    "52e97046661f73b28434c546274854cc1496c97276ba6be6b020749f21c2ab4f"

  private const val ENCODER_MIN_BYTES = 100_000_000L
  private const val SILERO_MIN_BYTES = 100_000L

  data class Paths(
    val root: File,
    val silero: File,
    val gigaamDir: File,
    val encoder: File,
    val decoder: File,
    val joiner: File,
    val tokens: File,
  )

  fun paths(context: Context): Paths {
    val root = File(context.filesDir, "naslukh-models")
    val giga = File(root, GIGAAM_DIR_NAME)
    return Paths(
      root = root,
      silero = File(root, "silero_vad.onnx"),
      gigaamDir = giga,
      encoder = File(giga, "encoder.int8.onnx"),
      decoder = File(giga, "decoder.onnx"),
      joiner = File(giga, "joiner.onnx"),
      tokens = File(giga, "tokens.txt"),
    )
  }

  fun hasLocalFiles(p: Paths): Boolean {
    return p.silero.exists() && p.silero.length() >= SILERO_MIN_BYTES &&
      p.encoder.exists() && p.encoder.length() >= ENCODER_MIN_BYTES &&
      p.decoder.exists() && p.decoder.length() > 1_000_000 &&
      p.joiner.exists() && p.joiner.length() > 100_000 &&
      p.tokens.exists() && p.tokens.length() > 100
  }

  fun isReady(p: Paths): Boolean = hasLocalFiles(p)

  fun ensure(context: Context, modelId: String): String {
    if (modelId != GIGAAM_MODEL_ID) {
      throw IllegalArgumentException("Неизвестная модель: $modelId")
    }
    val p = paths(context)
    p.root.mkdirs()
    Log.i(TAG, "models root=${p.root.absolutePath}")

    if (hasLocalFiles(p)) {
      Log.i(TAG, "локальные модели ok")
      return p.root.absolutePath
    }

    Log.i(TAG, "скачиваю $MODELS_ZIP_URL …")
    ProgressBus.send("download", 0.0, "Скачивание моделей…")
    downloadAndInstall(context, p)
    ProgressBus.send("download", 1.0, "Модели готовы")

    if (!hasLocalFiles(p)) {
      throw IllegalStateException(
        "После скачивания модели неполные в ${p.root.absolutePath}. " +
          "Проверь URL/архив на Cloudflare.",
      )
    }
    Log.i(TAG, "модели установлены из сети")
    return p.root.absolutePath
  }

  private fun downloadAndInstall(context: Context, p: Paths) {
    val cacheZip = File(context.cacheDir, "naslukh-models.zip")
    try {
      downloadToFile(MODELS_ZIP_URL, cacheZip)
      val actual = sha256File(cacheZip)
      if (actual != MODELS_ZIP_SHA256) {
        throw IllegalStateException(
          "SHA-256 не совпал (D14): ожидали $MODELS_ZIP_SHA256, получили $actual",
        )
      }
      Log.i(TAG, "SHA-256 ok, распаковка…")
      ProgressBus.send("download", 0.94, "Распаковка моделей…")
      // zip содержит naslukh-models/... → filesDir/
      unzipTo(cacheZip, context.filesDir)
      if (!hasLocalFiles(p)) {
        // на случай плоской раскладки без префикса
        unzipFlatNaslukh(cacheZip, p.root)
      }
    } finally {
      if (cacheZip.exists()) cacheZip.delete()
    }
  }

  private fun downloadToFile(urlStr: String, dest: File) {
    // Неполный кэш с прошлого запуска — начинаем заново (R2 без Range надёжнее).
    if (dest.exists()) {
      Log.i(TAG, "удаляю неполный кэш ${dest.length()} байт")
      dest.delete()
    }
    dest.parentFile?.mkdirs()

    val url = URL(urlStr)
    val conn = (url.openConnection() as HttpURLConnection).apply {
      connectTimeout = 60_000
      readTimeout = 180_000
      instanceFollowRedirects = true
      requestMethod = "GET"
      setRequestProperty("User-Agent", "NaslukhASR/0.1 (Android; speech-rn)")
      setRequestProperty("Accept", "*/*")
      setRequestProperty("Accept-Encoding", "identity")
    }
    try {
      Log.i(TAG, "HTTP connect $urlStr …")
      ProgressBus.send("download", 0.01, "Подключение к серверу…")
      val code = conn.responseCode
      Log.i(TAG, "HTTP $code, contentLength=${conn.contentLengthLong}")
      if (code !in 200..299) {
        val err = conn.errorStream?.bufferedReader()?.use { it.readText().take(200) }.orEmpty()
        throw IllegalStateException("HTTP $code при скачивании моделей: $urlStr $err")
      }
      // contentLength может быть -1 при chunked; берём header вручную
      val contentLength = conn.contentLengthLong.takeIf { it > 0 }
        ?: conn.getHeaderField("Content-Length")?.toLongOrNull()?.takeIf { it > 0 }
        ?: -1L
      BufferedInputStream(conn.inputStream).use { input ->
        FileOutputStream(dest).use { output ->
          val buf = ByteArray(256 * 1024)
          var n: Int
          var total = 0L
          var lastEmit = -1
          var lastLogMs = 0L
          while (input.read(buf).also { n = it } >= 0) {
            output.write(buf, 0, n)
            total += n
            val pct = if (contentLength > 0) {
              ((total * 100) / contentLength).toInt().coerceIn(0, 99)
            } else {
              // неизвестный размер — «дышим» по МБ
              ((total / (1024L * 1024)) % 90).toInt()
            }
            val now = System.currentTimeMillis()
            if (pct != lastEmit || now - lastLogMs > 2000) {
              lastEmit = pct
              lastLogMs = now
              val mb = total / (1024.0 * 1024.0)
              val msg = if (contentLength > 0) {
                "Скачивание ${"%.0f".format(mb)} / ${"%.0f".format(contentLength / (1024.0 * 1024.0))} МБ"
              } else {
                "Скачивание ${"%.0f".format(mb)} МБ…"
              }
              val frac = if (contentLength > 0) {
                total.toDouble() / contentLength
              } else {
                (pct / 100.0).coerceIn(0.0, 0.89)
              }
              ProgressBus.send("download", frac * 0.9, msg)
              Log.i(TAG, msg)
            }
          }
          Log.i(TAG, "скачано ${total / (1024 * 1024)} МБ → ${dest.name}")
          if (contentLength > 0 && total != contentLength) {
            throw IllegalStateException(
              "Скачано $total байт, ожидалось $contentLength — обрыв сети, повтори",
            )
          }
          if (total < 50_000_000L) {
            throw IllegalStateException(
              "Архив слишком маленький ($total байт) — проверь URL на Cloudflare",
            )
          }
        }
      }
      ProgressBus.send("download", 0.92, "Проверка SHA-256…")
    } finally {
      conn.disconnect()
    }
  }

  private fun unzipTo(zipFile: File, destDir: File) {
    ZipInputStream(BufferedInputStream(FileInputStream(zipFile))).use { zis ->
      var entry = zis.nextEntry
      while (entry != null) {
        val name = entry.name.replace('\\', '/')
        if (name.contains("..")) {
          zis.closeEntry()
          entry = zis.nextEntry
          continue
        }
        val outFile = File(destDir, name)
        if (entry.isDirectory) {
          outFile.mkdirs()
        } else {
          outFile.parentFile?.mkdirs()
          FileOutputStream(outFile).use { out -> zis.copyTo(out, 256 * 1024) }
        }
        zis.closeEntry()
        entry = zis.nextEntry
      }
    }
  }

  /** Если в zip файлы без корня naslukh-models/. */
  private fun unzipFlatNaslukh(zipFile: File, root: File) {
    root.mkdirs()
    ZipInputStream(BufferedInputStream(FileInputStream(zipFile))).use { zis ->
      var entry = zis.nextEntry
      while (entry != null) {
        val name = entry.name.replace('\\', '/').substringAfterLast('/')
        if (!entry.isDirectory && name.isNotEmpty()) {
          val target = when {
            name == "silero_vad.onnx" -> File(root, name)
            name.endsWith(".onnx") || name == "tokens.txt" ->
              File(root, GIGAAM_DIR_NAME).also { it.mkdirs() }.let { File(it, name) }
            else -> null
          }
          if (target != null) {
            FileOutputStream(target).use { out -> zis.copyTo(out, 256 * 1024) }
          }
        }
        zis.closeEntry()
        entry = zis.nextEntry
      }
    }
  }

  private fun sha256File(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buf = ByteArray(256 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        digest.update(buf, 0, n)
      }
    }
    return digest.digest().joinToString("") { b -> "%02x".format(b) }
  }
}
