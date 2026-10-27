import { MIN_FREE_MEMORY_BYTES } from "./limits.ts"

export class MemoryError extends Error {
  readonly freeBytes: number
  readonly requiredBytes: number

  constructor(freeBytes: number, requiredBytes = MIN_FREE_MEMORY_BYTES) {
    super(
      `Не хватает памяти для старта: свободно ${formatMb(freeBytes)}, нужно ${formatMb(requiredBytes)}`,
    )
    this.name = "MemoryError"
    this.freeBytes = freeBytes
    this.requiredBytes = requiredBytes
  }
}

export function canStartRecognition(
  freeBytes: number,
  requiredBytes = MIN_FREE_MEMORY_BYTES,
): boolean {
  if (!Number.isFinite(freeBytes) || freeBytes < 0) {
    throw new Error("Свободная память должна быть неотрицательным числом")
  }
  return freeBytes >= requiredBytes
}

/** Старт запрещён, если свободно меньше порога D3. */
export function assertCanStartRecognition(
  freeBytes: number,
  requiredBytes = MIN_FREE_MEMORY_BYTES,
): void {
  if (!canStartRecognition(freeBytes, requiredBytes)) {
    throw new MemoryError(freeBytes, requiredBytes)
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} МБ`
}
