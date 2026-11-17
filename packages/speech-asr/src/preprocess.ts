/**
 * Предобработка тихой речи в шуме перед VAD/GigaAM:
 * high-pass → denoise (ffmpeg afftdn) → оконный AGC → пик.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { SAMPLE_RATE_HZ } from "../../speech-core/src/index.ts"
import { readWavPcm16, writeWavPcm16 } from "../../speech-audio/src/index.ts"

export interface PreprocessOptions {
  /** Пропустить ffmpeg-denoise (только JS AGC/highpass). */
  skipFfmpeg?: boolean
  targetPeak?: number
}

function findFfmpeg(): string | null {
  try {
    const require = createRequire(import.meta.url)
    const packed = require("ffmpeg-static") as string | null
    if (packed) return packed
  } catch {
    /* optional dep */
  }
  const which = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["ffmpeg"], {
    encoding: "utf8",
  })
  if (which.status === 0) {
    return which.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null
  }
  return null
}

/** Однополюсный high-pass ~100 Hz @ 16 kHz — убирает гул витрин. */
export function highpass100(samples: Float32Array, sampleRate = SAMPLE_RATE_HZ): Float32Array {
  const rc = 1 / (2 * Math.PI * 100)
  const dt = 1 / sampleRate
  const alpha = rc / (rc + dt)
  const out = new Float32Array(samples.length)
  let prevX = 0
  let prevY = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!
    const y = alpha * (prevY + x - prevX)
    out[i] = y
    prevX = x
    prevY = y
  }
  return out
}

/**
 * Оконный AGC: тянет RMS каждого окна к targetRms.
 * Тихие реплики рядом с громкой кассой поднимаются отдельно.
 */
export function windowedAgc(
  samples: Float32Array,
  options?: { windowSec?: number; targetRms?: number; maxGain?: number },
): Float32Array {
  const windowSec = options?.windowSec ?? 0.4
  const targetRms = options?.targetRms ?? 0.08
  const maxGain = options?.maxGain ?? 12
  const win = Math.max(1, Math.round(windowSec * SAMPLE_RATE_HZ))
  const hop = Math.max(1, Math.floor(win / 2))
  const out = new Float32Array(samples.length)
  const weight = new Float32Array(samples.length)

  for (let start = 0; start < samples.length; start += hop) {
    const end = Math.min(samples.length, start + win)
    let sumSq = 0
    for (let i = start; i < end; i++) sumSq += samples[i]! * samples[i]!
    const rms = Math.sqrt(sumSq / (end - start))
    const gain = rms < 1e-5 ? 1 : Math.min(maxGain, targetRms / rms)
    for (let i = start; i < end; i++) {
      // Hann-подобное окно на краях hop — без щелчков при overlap
      const local = i - start
      const len = end - start
      const taper =
        len <= 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * local) / (len - 1))
      out[i]! += samples[i]! * gain * taper
      weight[i]! += taper
    }
  }
  for (let i = 0; i < samples.length; i++) {
    out[i] = weight[i]! > 1e-8 ? out[i]! / weight[i]! : samples[i]!
  }
  return out
}

export function normalizePeakGain(
  samples: Float32Array,
  targetPeak = 0.95,
): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!)
    if (a > peak) peak = a
  }
  if (peak < 1e-4 || peak >= targetPeak) return samples
  const gain = targetPeak / peak
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * gain
  return out
}

/**
 * Denoise (ffmpeg afftdn или JS high-pass) → оконный AGC → пик.
 * Если ffmpeg нет — только JS-fallback.
 */
export function enhanceForAsr(
  samples: Float32Array,
  options?: PreprocessOptions,
): Float32Array {
  const targetPeak = options?.targetPeak ?? 0.95
  const ffmpeg = options?.skipFfmpeg ? null : findFfmpeg()
  let cleaned = samples

  if (ffmpeg) {
    const dir = mkdtempSync(join(tmpdir(), "naslukh-pre-"))
    const input = join(dir, "in.wav")
    const output = join(dir, "out.wav")
    try {
      writeWavPcm16(input, samples, SAMPLE_RATE_HZ)
      // afftdn — спектральный denoise под тихую речь в зале
      const af = ["highpass=f=100", "lowpass=f=7600", "afftdn=nr=12:nf=-25:tn=1"].join(",")
      const r = spawnSync(
        ffmpeg,
        ["-y", "-i", input, "-af", af, "-ac", "1", "-ar", String(SAMPLE_RATE_HZ), "-c:a", "pcm_s16le", output],
        { encoding: "utf8" },
      )
      if (r.status === 0) {
        cleaned = readWavPcm16(output).samples
      } else {
        cleaned = highpass100(samples)
      }
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  } else {
    cleaned = highpass100(samples)
  }

  return normalizePeakGain(windowedAgc(cleaned), targetPeak)
}
