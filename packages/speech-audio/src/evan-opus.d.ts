declare module "@evan/opus" {
  export class Encoder {
    constructor(options: { channels: number; sample_rate: number })
    bitrate: number
    application: string
    vbr: boolean
    encode(pcm: Int16Array): Uint8Array
  }

  export class Decoder {
    constructor(options: { channels: number; sample_rate: number })
    decode(packet: Uint8Array): Uint8Array
  }
}
