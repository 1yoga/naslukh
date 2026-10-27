import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  CHECKPOINT_FORMAT,
  MIGRATION_001,
  MAX_CHUNK_SAMPLES,
  OVERLAP_SAMPLES,
  PIPELINE_VERSION,
  SAMPLE_RATE_HZ,
  VAD_COMMIT_SAMPLES,
  VAD_PAD_SAMPLES,
  assertManifest,
  buildSpeechChunks,
  canResumeCheckpoint,
  canTransition,
  desktopWebCapabilities,
  fingerprintKey,
  nativeAppCapabilities,
  normalizeForWer,
  padSpeechInterval,
  phoneWebCapabilities,
  planVadCommit,
  splitLongSpeech,
  unavailableCapabilities,
  werGapPoints,
  wordErrorRate,
} from "../src/index.ts"
import type { ModelManifest } from "../src/index.ts"

const HASH = "a".repeat(64)

const gigaam: ModelManifest = {
  version: 1,
  models: [
    {
      id: "gigaam-v3-e2e-rnnt-int8",
      kind: "stt",
      role: "batch",
      language: "ru",
      enabled: true,
      runtime: "native",
      init: { featureDim: 64, modelType: "nemo_transducer" },
      files: [
        { path: "encoder.int8.onnx", size: 214_000_000, sha256: HASH },
        { path: "decoder.onnx", size: 1_100_000, sha256: HASH },
        { path: "joiner.onnx", size: 700_000, sha256: HASH },
        { path: "tokens.txt", size: 20_000, sha256: HASH },
      ],
    },
  ],
}

describe("состояния задания", () => {
  it("закрытый файл уходит в распознавание, а не в запись", () => {
    assert.equal(canTransition("sealed", "recognizing"), true)
    assert.equal(canTransition("sealed", "recording"), false)
  })

  it("готовое задание никуда не переходит", () => {
    assert.equal(canTransition("done", "recognizing"), false)
    assert.equal(canTransition("cancelled", "paused"), false)
  })

  it("пауза возвращается и в запись, и в распознавание", () => {
    assert.equal(canTransition("paused", "recording"), true)
    assert.equal(canTransition("paused", "recognizing"), true)
  })
})

describe("нормализация и WER", () => {
  it("снимает регистр, ё и пунктуацию", () => {
    assert.equal(normalizeForWer("Ёлка, привет!"), "елка привет")
  })

  it("сводит число только по переданной таблице", () => {
    const map = [["один", "1"]] as const
    assert.equal(normalizeForWer("Один дом", map), "1 дом")
    assert.equal(normalizeForWer("Один дом"), "один дом")
  })

  it("считает удаление одного слова как треть ошибки", () => {
    assert.equal(wordErrorRate("а б в", "а в"), 1 / 3)
  })

  it("переводит разницу WER в процентные пункты", () => {
    assert.ok(Math.abs(werGapPoints(0.1, 0.12) - 2) < 1e-9)
  })
})

describe("манифест и отпечаток", () => {
  it("принимает GigaAM с нужными флагами", () => {
    assert.doesNotThrow(() => assertManifest(gigaam))
  })

  it("отклоняет GigaAM без nemo_transducer", () => {
    const broken: ModelManifest = structuredClone(gigaam)
    broken.models[0].init = { featureDim: 64, modelType: "transducer" }
    assert.throws(() => assertManifest(broken), /nemo_transducer/)
  })

  it("собирает ключ из размера и полного SHA-256", () => {
    assert.equal(fingerprintKey(10, HASH), `10:${HASH}`)
    assert.throws(() => fingerprintKey(10, "abcd"), /SHA-256/)
  })
})

describe("возможности среды", () => {
  it("на телефоне обещает десять часов и запись", () => {
    const caps = nativeAppCapabilities(["gigaam-v3-e2e-rnnt-int8"])
    assert.equal(caps.maxRecommendedDurationSec, 10 * 60 * 60)
    assert.equal(caps.recording, true)
    assert.equal(caps.partialResults, false)
    assert.equal(caps.tts, false)
    assert.equal(caps.background, false)
  })

  it("в телефонном браузере потолок пять минут после пробы", () => {
    const ok = phoneWebCapabilities({ models: ["gigaam-v3-e2e-rnnt-int8"], probeOk: true })
    const denied = phoneWebCapabilities({ models: ["gigaam-v3-e2e-rnnt-int8"], probeOk: false })
    assert.equal(ok.maxRecommendedDurationSec, 5 * 60)
    assert.equal(denied.fileTranscription, false)
  })

  it("без WASM на компьютере транскрибация выключена", () => {
    const caps = desktopWebCapabilities({
      models: ["gigaam-v3-e2e-rnnt-int8"],
      wasmOk: false,
      threads: 1,
      storageOk: true,
    })
    assert.equal(caps.fileTranscription, false)
    assert.equal(caps.models.length, 0)
  })

  it("недоступная среда не предлагает модель", () => {
    assert.equal(unavailableCapabilities().fileTranscription, false)
  })
})

describe("схема", () => {
  it("хранит курсор VAD, сегмент и журнал без текста звука", () => {
    assert.match(MIGRATION_001, /vad_cursor_sample/)
    assert.match(MIGRATION_001, /UNIQUE \(job_id, start_sample\)/)
    assert.match(MIGRATION_001, /CREATE TABLE journal/)
    assert.equal(MIGRATION_001.includes("audio_bytes"), false)
    assert.equal(CHECKPOINT_FORMAT, 1)
    assert.equal(PIPELINE_VERSION, 1)
    assert.equal(MAX_CHUNK_SAMPLES, 30 * SAMPLE_RATE_HZ)
  })
})

describe("нарезка Silero", () => {
  it("добавляет отступ и не раздувает кусок дальше 30 с", () => {
    const total = 40 * SAMPLE_RATE_HZ
    const padded = padSpeechInterval(
      { startSample: 0, endSample: MAX_CHUNK_SAMPLES },
      total,
    )
    assert.equal(padded.startSample, 0)
    assert.equal(padded.endSample - padded.startSample, MAX_CHUNK_SAMPLES)
  })

  it("режет длинную речь с перехлёстом", () => {
    const total = 80 * SAMPLE_RATE_HZ
    const parts = splitLongSpeech(
      { startSample: 0, endSample: 65 * SAMPLE_RATE_HZ },
      total,
    )
    assert.equal(parts.length, 3)
    assert.equal(parts[0].cutThroughSpeech, true)
    assert.equal(parts[1].startSample, MAX_CHUNK_SAMPLES - OVERLAP_SAMPLES - VAD_PAD_SAMPLES)
  })

  it("в окне 20–30 с ставит рез на самую длинную паузу", () => {
    const sr = SAMPLE_RATE_HZ
    const intervals = [
      { startSample: 0, endSample: 5 * sr },
      { startSample: 6 * sr, endSample: 12 * sr },
      { startSample: 13 * sr, endSample: 22 * sr },
      { startSample: 22.2 * sr, endSample: 28 * sr },
      { startSample: 35 * sr, endSample: 40 * sr },
    ]
    const chunks = buildSpeechChunks(intervals, 40 * sr)
    assert.equal(chunks.length, 2)
    // Пауза после 28 с длиннее паузы после 22 с — рез после 28 с.
    assert.equal(chunks[0].endSample, 28 * sr + VAD_PAD_SAMPLES)
    assert.equal(chunks[0].cutThroughSpeech, false)
    assert.equal(chunks[1].startSample, 35 * sr - VAD_PAD_SAMPLES)
  })
})

describe("чекпоинт VAD", () => {
  it("коммитит курсор вместе с интервалами раз в 60 с", () => {
    const early = planVadCommit({
      scannedSample: VAD_COMMIT_SAMPLES - 1,
      lastCommittedSample: 0,
      pendingIntervals: [{ startSample: 0, endSample: 100 }],
      atEnd: false,
    })
    assert.equal(early, null)

    const ready = planVadCommit({
      scannedSample: VAD_COMMIT_SAMPLES,
      lastCommittedSample: 0,
      pendingIntervals: [{ startSample: 0, endSample: 100 }],
      atEnd: false,
    })
    assert.deepEqual(ready, {
      intervals: [{ startSample: 0, endSample: 100 }],
      cursorSample: VAD_COMMIT_SAMPLES,
    })
  })

  it("в конце файла коммитит остаток раньше минуты", () => {
    const tail = planVadCommit({
      scannedSample: 1000,
      lastCommittedSample: 0,
      pendingIntervals: [],
      atEnd: true,
    })
    assert.deepEqual(tail, { intervals: [], cursorSample: 1000 })
  })

  it("не продолжает чекпоинт с другой версией модели", () => {
    assert.equal(
      canResumeCheckpoint(
        {
          modelVersion: "a",
          pipelineVersion: PIPELINE_VERSION,
          checkpointFormat: CHECKPOINT_FORMAT,
        },
        "b",
      ),
      false,
    )
    assert.equal(
      canResumeCheckpoint(
        {
          modelVersion: "a",
          pipelineVersion: PIPELINE_VERSION,
          checkpointFormat: CHECKPOINT_FORMAT,
        },
        "a",
      ),
      true,
    )
  })
})

describe("манифест VAD", () => {
  it("принимает Silero рядом с GigaAM", () => {
    const withVad: ModelManifest = structuredClone(gigaam)
    withVad.models.push({
      id: "silero-vad",
      kind: "vad",
      role: "vad",
      language: "ru",
      enabled: true,
      runtime: "native",
      files: [{ path: "silero_vad.onnx", size: 900_000, sha256: HASH }],
    })
    assert.doesNotThrow(() => assertManifest(withVad))
  })
})
