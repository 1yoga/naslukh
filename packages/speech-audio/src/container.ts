import {
  OPUS_BITRATE_BPS,
  OPUS_FRAME_SAMPLES,
  SAMPLE_RATE_HZ,
} from "../../speech-core/src/index.ts"

/** Контейнер кадров Opus без Ogg: NSOP v1. */
export const OPUS_CONTAINER = "nsop" as const

const MAGIC = Buffer.from("NSOP")
const VERSION = 1
const HEADER_SIZE = 16

export interface OpusHeader {
  sampleRate: number
  channels: 1
  frameSamples: number
  bitrate: number
}

export function buildHeader(
  options: Partial<OpusHeader> = {},
): Buffer {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE_HZ
  const frameSamples = options.frameSamples ?? OPUS_FRAME_SAMPLES
  const bitrate = options.bitrate ?? OPUS_BITRATE_BPS
  const header = Buffer.alloc(HEADER_SIZE)
  MAGIC.copy(header, 0)
  header.writeUInt8(VERSION, 4)
  header.writeUInt8(1, 5)
  header.writeUInt16LE(0, 6)
  header.writeUInt32LE(sampleRate, 8)
  header.writeUInt16LE(frameSamples, 12)
  header.writeUInt16LE(Math.round(bitrate / 1000), 14)
  return header
}

export function parseHeader(bytes: Buffer): OpusHeader & { headerSize: number } {
  if (bytes.length < HEADER_SIZE) throw new Error("Слишком короткий файл Opus")
  if (!bytes.subarray(0, 4).equals(MAGIC)) throw new Error("Не контейнер NSOP")
  if (bytes.readUInt8(4) !== VERSION) throw new Error("Неизвестная версия NSOP")
  const channels = bytes.readUInt8(5)
  if (channels !== 1) throw new Error("Поддерживается только моно")
  return {
    sampleRate: bytes.readUInt32LE(8),
    channels: 1,
    frameSamples: bytes.readUInt16LE(12),
    bitrate: bytes.readUInt16LE(14) * 1000,
    headerSize: HEADER_SIZE,
  }
}

export function packPackets(packets: readonly Uint8Array[], header = buildHeader()): Buffer {
  const parts: Buffer[] = [header]
  for (const packet of packets) {
    if (packet.byteLength > 0xffff) throw new Error("Пакет Opus слишком длинный")
    const len = Buffer.alloc(2)
    len.writeUInt16LE(packet.byteLength, 0)
    parts.push(len, Buffer.from(packet))
  }
  return Buffer.concat(parts)
}

export function unpackPackets(bytes: Buffer): {
  header: OpusHeader
  packets: Uint8Array[]
} {
  const header = parseHeader(bytes)
  const packets: Uint8Array[] = []
  let offset = header.headerSize
  while (offset + 2 <= bytes.length) {
    const size = bytes.readUInt16LE(offset)
    offset += 2
    if (offset + size > bytes.length) throw new Error("Обрезанный пакет Opus")
    packets.push(bytes.subarray(offset, offset + size))
    offset += size
  }
  return { header, packets }
}
