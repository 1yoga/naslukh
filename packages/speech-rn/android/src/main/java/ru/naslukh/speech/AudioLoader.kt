package ru.naslukh.speech

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import com.k2fsa.sherpa.onnx.WaveReader
import java.io.File
import java.nio.ByteOrder
import kotlin.math.min

/**
 * WAV 16 kHz через sherpa WaveReader; иначе AAC/M4A/3GP → PCM float mono 16 kHz.
 */
object AudioLoader {
  data class Pcm(val samples: FloatArray, val sampleRate: Int)

  fun loadMono16k(path: String): Pcm {
    val lower = path.lowercase()
    if (lower.endsWith(".wav")) {
      val wave = WaveReader.readWave(path)
      if (wave.sampleRate == Chunking.SAMPLE_RATE) {
        return Pcm(wave.samples, wave.sampleRate)
      }
      return Pcm(resample(wave.samples, wave.sampleRate, Chunking.SAMPLE_RATE), Chunking.SAMPLE_RATE)
    }
    return decodeCompressedTo16k(path)
  }

  private fun decodeCompressedTo16k(path: String): Pcm {
    val file = File(path)
    if (!file.exists()) throw IllegalArgumentException("Файл не найден: $path")

    val extractor = MediaExtractor()
    extractor.setDataSource(path)
    var track = -1
    var format: MediaFormat? = null
    for (i in 0 until extractor.trackCount) {
      val f = extractor.getTrackFormat(i)
      val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("audio/")) {
        track = i
        format = f
        break
      }
    }
    if (track < 0 || format == null) {
      extractor.release()
      throw IllegalArgumentException("В файле нет аудиодорожки: $path")
    }
    extractor.selectTrack(track)
    val mime = format.getString(MediaFormat.KEY_MIME)!!
    val codec = MediaCodec.createDecoderByType(mime)
    codec.configure(format, null, null, 0)
    codec.start()

    val pcmChunks = ArrayList<ShortArray>()
    var inputDone = false
    var outputDone = false
    var outSampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var outChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    val info = MediaCodec.BufferInfo()

    try {
      while (!outputDone) {
        if (!inputDone) {
          val inIndex = codec.dequeueInputBuffer(10_000)
          if (inIndex >= 0) {
            val buf = codec.getInputBuffer(inIndex)!!
            val sampleSize = extractor.readSampleData(buf, 0)
            if (sampleSize < 0) {
              codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        val outIndex = codec.dequeueOutputBuffer(info, 10_000)
        when {
          outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val newFormat = codec.outputFormat
            outSampleRate = newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            outChannels = newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          }
          outIndex >= 0 -> {
            val outBuf = codec.getOutputBuffer(outIndex)!!
            if (info.size > 0) {
              outBuf.position(info.offset)
              outBuf.limit(info.offset + info.size)
              val shorts = ShortArray(info.size / 2)
              outBuf.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)
              pcmChunks.add(shorts)
            }
            codec.releaseOutputBuffer(outIndex, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
              outputDone = true
            }
          }
        }
      }
    } finally {
      codec.stop()
      codec.release()
      extractor.release()
    }

    val totalShorts = pcmChunks.sumOf { it.size }
    val interleaved = ShortArray(totalShorts)
    var pos = 0
    for (chunk in pcmChunks) {
      System.arraycopy(chunk, 0, interleaved, pos, chunk.size)
      pos += chunk.size
    }

    val mono = toMonoFloat(interleaved, outChannels)
    val samples =
      if (outSampleRate == Chunking.SAMPLE_RATE) mono
      else resample(mono, outSampleRate, Chunking.SAMPLE_RATE)
    return Pcm(samples, Chunking.SAMPLE_RATE)
  }

  private fun toMonoFloat(pcm: ShortArray, channels: Int): FloatArray {
    if (channels <= 1) {
      return FloatArray(pcm.size) { i -> pcm[i] / 32768.0f }
    }
    val frames = pcm.size / channels
    val out = FloatArray(frames)
    for (i in 0 until frames) {
      var sum = 0f
      for (c in 0 until channels) {
        sum += pcm[i * channels + c] / 32768.0f
      }
      out[i] = sum / channels
    }
    return out
  }

  private fun resample(input: FloatArray, fromRate: Int, toRate: Int): FloatArray {
    if (fromRate == toRate || input.isEmpty()) return input
    val ratio = fromRate.toDouble() / toRate
    val length = maxOf(1, kotlin.math.round(input.size / ratio).toInt())
    val output = FloatArray(length)
    for (i in 0 until length) {
      val position = i * ratio
      val left = position.toInt().coerceIn(0, input.size - 1)
      val right = min(left + 1, input.size - 1)
      val w = (position - left).toFloat()
      output[i] = input[left] * (1 - w) + input[right] * w
    }
    return output
  }
}
