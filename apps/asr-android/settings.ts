import {
  documentDirectory,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy"

export interface StandSettings {
  correctorEnabled: boolean
  autoTranscribeOnStop: boolean
  ignoreCache: boolean
  showSegments: boolean
  vadThreshold: number
  listenVadThreshold: number
  vadMinSpeechSec: number
  vadMinSilenceSec: number
  listenEndSilenceSec: number
  numThreads: number
  brandMinScore: number
  hotwords: string[]
}

export const DEFAULT_SETTINGS: StandSettings = {
  correctorEnabled: true,
  autoTranscribeOnStop: true,
  ignoreCache: false,
  showSegments: true,
  vadThreshold: 0.15,
  listenVadThreshold: 0.5,
  vadMinSpeechSec: 0.25,
  vadMinSilenceSec: 0.25,
  listenEndSilenceSec: 1.0,
  numThreads: 2,
  brandMinScore: 0.72,
  hotwords: [],
}

function settingsUri(): string {
  return `${documentDirectory}naslukh-stand-settings.json`
}

export async function loadSettings(): Promise<StandSettings> {
  try {
    const info = await getInfoAsync(settingsUri())
    if (!info.exists) return { ...DEFAULT_SETTINGS }
    const raw = await readAsStringAsync(settingsUri())
    const parsed = JSON.parse(raw) as Partial<StandSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      hotwords: Array.isArray(parsed.hotwords)
        ? parsed.hotwords.map(String).filter(Boolean)
        : [],
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: StandSettings): Promise<void> {
  await writeAsStringAsync(settingsUri(), JSON.stringify(settings, null, 2))
}
