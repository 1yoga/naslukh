package ru.naslukh.speech

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.NoiseSuppressor
import android.util.Log

/**
 * Захват микрофона PCM 16 кГц mono. С эхоподавлением — источник VOICE_COMMUNICATION
 * и, где устройство их даёт, AcousticEchoCanceler + NoiseSuppressor: так можно слушать,
 * пока телефон сам воспроизводит речь. Без него — прежний VOICE_RECOGNITION (поведение 0.1.0).
 */
internal class Mic private constructor(
  val recorder: AudioRecord,
  private val effects: List<AudioEffect>,
  val echoCancellation: Boolean,
) {
  @Volatile
  private var released = false

  fun start() {
    recorder.startRecording()
    if (recorder.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      throw IllegalStateException("Микрофон не начал запись")
    }
  }

  val isRecording: Boolean
    get() = !released && recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING

  /** Прерывает блокирующее чтение: поток захвата увидит остановку и выйдет. */
  fun interrupt() {
    try {
      if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop()
    } catch (_: Exception) {
      /* поток чтения сам увидит флаг остановки */
    }
  }

  fun release() {
    if (released) return
    released = true
    for (effect in effects) {
      try {
        effect.release()
      } catch (_: Exception) {
      }
    }
    interrupt()
    recorder.release()
  }

  companion object {
    private const val TAG = "NaslukhMic"

    fun echoCancellationAvailable(): Boolean = try {
      AcousticEchoCanceler.isAvailable()
    } catch (_: Throwable) {
      false
    }

    @SuppressLint("MissingPermission")
    fun open(sampleRate: Int, minBufferSamples: Int, echoCancellation: Boolean): Mic {
      val minBufferBytes = AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      if (minBufferBytes <= 0) {
        throw IllegalStateException("Устройство не поддерживает запись PCM 16 кГц")
      }
      val source = if (echoCancellation) {
        MediaRecorder.AudioSource.VOICE_COMMUNICATION
      } else {
        MediaRecorder.AudioSource.VOICE_RECOGNITION
      }
      val recorder = AudioRecord.Builder()
        .setAudioSource(source)
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(sampleRate)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build(),
        )
        .setBufferSizeInBytes(maxOf(minBufferBytes, minBufferSamples * 2 * 4))
        .build()
      if (recorder.state != AudioRecord.STATE_INITIALIZED) {
        recorder.release()
        throw IllegalStateException("Не удалось открыть микрофон")
      }

      val effects = mutableListOf<AudioEffect>()
      if (echoCancellation) {
        val session = recorder.audioSessionId
        if (AcousticEchoCanceler.isAvailable()) {
          AcousticEchoCanceler.create(session)?.let {
            it.enabled = true
            effects += it
          }
        }
        if (NoiseSuppressor.isAvailable()) {
          NoiseSuppressor.create(session)?.let {
            it.enabled = true
            effects += it
          }
        }
        Log.i(TAG, "echoCancellation source=VOICE_COMMUNICATION effects=${effects.map { it.javaClass.simpleName }}")
      }
      return Mic(recorder, effects, echoCancellation)
    }
  }
}
