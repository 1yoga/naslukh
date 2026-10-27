import { Decoder, Encoder } from "@evan/opus"
import {
  OPUS_BITRATE_BPS,
  OPUS_FRAME_SAMPLES,
  SAMPLE_RATE_HZ,
} from "../../speech-core/src/index.ts"
import { buildHeader, packPackets, unpackPackets } from "./container.ts"
import { bytesToInt16, floatToInt16, int16ToFloat } from "./pcm.ts"

export interface EncodeOpusOptions {
  bitrate?: number
  frameSamples?: number
}

/** Моно PCM Float32 16 кГц → контейнер NSOP. */
export function encodeOpus(
  samples: Float32Array,
  options: EncodeOpusOptions = {},
): Buffer {
  const frameSamples = options.frameSamples ?? OPUS_FRAME_SAMPLES
  const bitrate = options.bitrate ?? OPUS_BITRATE_BPS
  const encoder = new Encoder({ channels: 1, sample_rate: SAMPLE_RATE_HZ })
  encoder.bitrate = bitrate
  encoder.application = "voip"
  encoder.vbr = true

  const pcm = floatToInt16(samples)
  const packets: Uint8Array[] = []
  for (let offset = 0; offset < pcm.length; offset += frameSamples) {
    const frame = new Int16Array(frameSamples)
    const slice = pcm.subarray(offset, Math.min(offset + frameSamples, pcm.length))
    frame.set(slice)
    packets.push(encoder.encode(frame))
  }
  return packPackets(
    packets,
    buildHeader({ sampleRate: SAMPLE_RATE_HZ, frameSamples, bitrate }),
  )
}

/** Контейнер NSOP → моно PCM Float32 16 кГц. */
export function decodeOpus(bytes: Buffer): {
  samples: Float32Array
  sampleRate: number
  bitrate: number
} {
  const { header, packets } = unpackPackets(bytes)
  if (header.sampleRate !== SAMPLE_RATE_HZ) {
    throw new Error(`Нужен ${SAMPLE_RATE_HZ} Гц, в файле ${header.sampleRate}`)
  }
  const decoder = new Decoder({ channels: 1, sample_rate: SAMPLE_RATE_HZ })
  const frames: Int16Array[] = []
  let total = 0
  for (const packet of packets) {
    const decoded = bytesToInt16(decoder.decode(packet))
    frames.push(decoded)
    total += decoded.length
  }
  const pcm = new Int16Array(total)
  let offset = 0
  for (const frame of frames) {
    pcm.set(frame, offset)
    offset += frame.length
  }
  return {
    samples: int16ToFloat(pcm),
    sampleRate: header.sampleRate,
    bitrate: header.bitrate,
  }
}
