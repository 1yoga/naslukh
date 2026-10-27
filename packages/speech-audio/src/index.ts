export {
  OPUS_CONTAINER,
  buildHeader,
  packPackets,
  parseHeader,
  unpackPackets,
} from "./container.ts"
export type { OpusHeader } from "./container.ts"
export { decodeOpus, encodeOpus } from "./opus.ts"
export type { EncodeOpusOptions } from "./opus.ts"
export { floatToInt16, int16ToFloat } from "./pcm.ts"
