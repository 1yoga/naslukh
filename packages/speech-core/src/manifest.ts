import type { ModelManifest, SpeechModel } from "./types.ts"

const SHA256_HEX = /^[a-f0-9]{64}$/

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ManifestError"
  }
}

export function assertManifest(manifest: ModelManifest): void {
  if (manifest.version !== 1) {
    throw new ManifestError("Поддерживается только манифест версии 1")
  }
  const enabledBatch = manifest.models.filter(
    (model) => model.enabled && model.kind === "stt" && model.role === "batch",
  )
  if (enabledBatch.length !== 1) {
    throw new ManifestError("В выпуске включена ровно одна модель stt batch")
  }
  for (const model of manifest.models) validateModel(model)
}

function validateModel(model: SpeechModel): void {
  if (model.runtime !== "native" && model.runtime !== "wasm") {
    throw new ManifestError(`У модели ${model.id} неизвестный рантайм`)
  }
  if (model.id === "gigaam-v3-e2e-rnnt-int8") {
    if (model.init?.featureDim !== 64 || model.init.modelType !== "nemo_transducer") {
      throw new ManifestError(
        "GigaAM инициализируется с featureDim=64 и modelType=nemo_transducer",
      )
    }
  }
  if (model.kind === "vad") {
    if (model.role !== "vad") {
      throw new ManifestError(`VAD-модель ${model.id} должна иметь role=vad`)
    }
    if (model.files.length < 1) {
      throw new ManifestError(`У VAD-модели ${model.id} нет файлов`)
    }
  }
  for (const file of model.files) {
    if (!Number.isInteger(file.size) || file.size < 0) {
      throw new ManifestError(`У файла ${file.path} некорректный размер`)
    }
    if (!SHA256_HEX.test(file.sha256)) {
      throw new ManifestError(`У файла ${file.path} нет SHA-256`)
    }
  }
}

export function fingerprintKey(size: number, sha256: string): string {
  if (!Number.isInteger(size) || size < 0) {
    throw new Error("Размер файла должен быть целым неотрицательным")
  }
  if (!SHA256_HEX.test(sha256)) {
    throw new Error("Отпечаток ждёт полный SHA-256 в hex")
  }
  return `${size}:${sha256}`
}
