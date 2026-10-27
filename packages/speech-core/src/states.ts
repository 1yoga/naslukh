import type { JobState } from "./types.ts"

const NEXT: Record<JobState, readonly JobState[]> = {
  queued: ["recording", "recognizing", "cancelled", "failed"],
  recording: ["sealed", "paused", "cancelled", "failed"],
  sealed: ["recognizing", "cancelled", "failed"],
  recognizing: ["paused", "done", "failed", "cancelled"],
  paused: ["recording", "recognizing", "cancelled", "failed"],
  done: [],
  failed: [],
  cancelled: [],
}

export function canTransition(from: JobState, to: JobState): boolean {
  return NEXT[from].includes(to)
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Нельзя перейти из ${from} в ${to}`)
  }
}
