import sherpa from "sherpa-onnx-node"
import {
  SAMPLE_RATE_HZ,
  stitchByTokenCenters,
} from "../../speech-core/src/index.ts"
import type {
  ChunkTranscript,
  SpeechChunk,
  TimedToken,
} from "../../speech-core/src/index.ts"
import {
  GIGAAM_FEATURE_DIM,
  GIGAAM_MODEL_ID,
  gigaamFiles,
} from "./paths.ts"

export interface RecognizerHandle {
  decodeChunk(chunk: SpeechChunk, samples: Float32Array): ChunkTranscript
  close(): void
}

export function createGigaamRecognizer(modelDir: string): RecognizerHandle {
  const files = gigaamFiles(modelDir)
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: {
      sampleRate: SAMPLE_RATE_HZ,
      featureDim: GIGAAM_FEATURE_DIM,
    },
    modelConfig: {
      transducer: {
        encoder: files.encoder,
        decoder: files.decoder,
        joiner: files.joiner,
      },
      tokens: files.tokens,
      modelType: "nemo_transducer",
      numThreads: 2,
      provider: "cpu",
    },
  })

  return {
    decodeChunk(chunk, samples) {
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE_HZ })
      recognizer.decode(stream)
      const result = recognizer.getResult(stream)
      const tokens = toTimedTokens(result)
      return {
        startSample: chunk.startSample,
        endSample: chunk.endSample,
        tokens,
      }
    },
    close() {
      // native handle освобождается GC; явного dispose в API нет
    },
  }
}

function toTimedTokens(result: {
  text: string
  tokens?: string[]
  timestamps?: number[]
}): TimedToken[] {
  const tokens = result.tokens ?? []
  const timestamps = result.timestamps ?? []
  if (tokens.length === 0 && result.text) {
    return [{ token: result.text, centerSec: 0 }]
  }
  return tokens.map((token, index) => {
    const start = timestamps[index] ?? 0
    const next = timestamps[index + 1]
    const centerSec = next === undefined ? start : (start + next) / 2
    return { token, centerSec }
  })
}

export function stitchChunks(chunks: readonly ChunkTranscript[]): string {
  return stitchByTokenCenters(chunks).text
}

export { GIGAAM_MODEL_ID }
