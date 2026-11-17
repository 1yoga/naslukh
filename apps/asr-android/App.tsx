import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native"
import { StatusBar } from "expo-status-bar"
import { useKeepAwake } from "expo-keep-awake"
import * as Clipboard from "expo-clipboard"
import { File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio"
import * as DocumentPicker from "expo-document-picker"
import {
  addNaslukhProgressListener,
  createSpeechEngine,
  GIGAAM_MODEL_ID,
} from "@naslukh/speech-rn"
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type StandSettings,
} from "./settings"

const engine = createSpeechEngine({ allowStub: false })

const REC_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
}

type ProgressState = {
  visible: boolean
  phase: string
  progress: number
  message: string
}

export default function App() {
  useKeepAwake()

  const recorder = useAudioRecorder(REC_OPTIONS)
  const recorderState = useAudioRecorderState(recorder, 80)
  const [uri, setUri] = useState<string | null>(null)
  const [status, setStatus] = useState("Готово к работе")
  const [text, setText] = useState("")
  const [rawText, setRawText] = useState("")
  const [busy, setBusy] = useState(false)
  const [screen, setScreen] = useState<"main" | "settings">("main")
  const [settings, setSettings] = useState<StandSettings>(DEFAULT_SETTINGS)
  const [hotwordDraft, setHotwordDraft] = useState("")
  const [progress, setProgress] = useState<ProgressState>({
    visible: false,
    phase: "",
    progress: 0,
    message: "",
  })
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const player = useAudioPlayer(uri)
  const playerStatus = useAudioPlayerStatus(player)

  useEffect(() => {
    void loadSettings().then(setSettings)
  }, [])

  useEffect(() => {
    return addNaslukhProgressListener((e) => {
      setProgress({
        visible: true,
        phase: e.phase,
        progress: e.progress,
        message: e.message,
      })
      setStatus(e.message)
    })
  }, [])

  async function patchSettings(next: StandSettings) {
    setSettings(next)
    await saveSettings(next)
  }

  const transcribeUri = useCallback(
    async (audioUri: string) => {
      const s = settingsRef.current
      if (playerStatus.playing) player.pause()
      setBusy(true)
      setText("")
      setRawText("")
      setProgress({
        visible: true,
        phase: "asr",
        progress: 0,
        message: "Подготовка…",
      })
      try {
        setStatus("Проверка модели…")
        await engine.ensureModel(GIGAAM_MODEL_ID)
        setStatus("Распознаём…")
        const job = engine.transcribeFile({
          uri: audioUri,
          language: "ru",
          options: {
            ignoreCache: s.ignoreCache,
            vadThreshold: s.vadThreshold,
            vadMinSpeechSec: s.vadMinSpeechSec,
            vadMinSilenceSec: s.vadMinSilenceSec,
            numThreads: s.numThreads,
            hotwords: s.hotwords,
            correctorEnabled: s.correctorEnabled,
            brandMinScore: s.brandMinScore,
          },
        })
        const result = await job.result()
        const body = result.text.trim() || "(пусто)"
        setRawText(body)
        if (s.showSegments && result.segments.length > 0) {
          const lined = result.segments
            .filter((seg) => seg.text.trim())
            .map((seg) => {
              const a = (seg.startSample / 16000).toFixed(1)
              const b = (seg.endSample / 16000).toFixed(1)
              return `${a}–${b} с  ${seg.text.trim()}`
            })
            .join("\n\n")
          setText(lined || body)
        } else {
          setText(body)
        }
        const tag = result.fromCache
          ? "из кэша"
          : result.resumed
            ? "продолжение"
            : "новое"
        setStatus(
          `Готово · ${tag}` +
            (result.jobId ? ` · ${result.jobId.slice(0, 10)}` : "") +
            (s.correctorEnabled ? " · corrector" : ""),
        )
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
        setProgress((p) => ({ ...p, visible: false, progress: 1 }))
      }
    },
    [player, playerStatus.playing],
  )

  async function startRec() {
    if (playerStatus.playing) player.pause()
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) {
      setStatus("Нужен доступ к микрофону")
      return
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    setUri(null)
    setText("")
    setRawText("")
    setStatus("Идёт запись — экран не гаснет")
  }

  async function stopRec() {
    if (!recorderState.isRecording) return
    await recorder.stop()
    const nextUri = recorder.uri
    setUri(nextUri)
    if (!nextUri) {
      setStatus("Файл записи не получился")
      return
    }
    setStatus("Запись сохранена")
    if (settingsRef.current.autoTranscribeOnStop) {
      await transcribeUri(nextUri)
    }
  }

  async function pickFile() {
    if (playerStatus.playing) player.pause()
    const result = await DocumentPicker.getDocumentAsync({
      type: ["audio/*"],
      copyToCacheDirectory: true,
    })
    if (result.canceled || !result.assets?.[0]) return
    setUri(result.assets[0].uri)
    setText("")
    setRawText("")
    setStatus("Файл выбран — можно распознать")
  }

  async function togglePlay() {
    if (!uri) {
      setStatus("Сначала сделай запись или выбери файл")
      return
    }
    if (playerStatus.playing) {
      player.pause()
      setStatus("Пауза")
      return
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    if (
      playerStatus.didJustFinish ||
      playerStatus.currentTime >= playerStatus.duration
    ) {
      await player.seekTo(0)
    }
    player.play()
    setStatus("Слушаем…")
  }

  function addHotword() {
    const w = hotwordDraft.trim()
    if (!w) return
    if (settings.hotwords.some((h) => h.toLowerCase() === w.toLowerCase())) {
      setHotwordDraft("")
      return
    }
    void patchSettings({ ...settings, hotwords: [...settings.hotwords, w] })
    setHotwordDraft("")
  }

  function removeHotword(word: string) {
    void patchSettings({
      ...settings,
      hotwords: settings.hotwords.filter((h) => h !== word),
    })
  }

  const exportableText = text.trim()
  const canExport = Boolean(exportableText) && !busy

  async function copyTranscript() {
    if (!canExport) {
      setStatus("Нечего копировать — сначала распознай")
      return
    }
    try {
      await Clipboard.setStringAsync(exportableText)
      setStatus("Текст скопирован")
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  async function exportTranscript() {
    if (!canExport) {
      setStatus("Нечего экспортировать — сначала распознай")
      return
    }
    try {
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19)
      const file = new File(Paths.cache, `naslukh-${stamp}.txt`)
      file.create({ intermediates: true, overwrite: true })
      await file.write(exportableText)

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "text/plain",
          dialogTitle: "Экспорт расшифровки",
          UTI: "public.plain-text",
        })
        setStatus("Экспорт…")
        return
      }

      await Share.share({
        message: exportableText,
        title: "Расшифровка Naslukh",
      })
      setStatus("Текст отправлен в шаринг")
    } catch (e) {
      // Пользователь мог просто закрыть шторку шаринга
      const msg = e instanceof Error ? e.message : String(e)
      if (/cancel|dismiss/i.test(msg)) return
      setStatus(msg)
    }
  }

  const recording = recorderState.isRecording
  const playing = playerStatus.playing
  const meter = recorderState.metering ?? -160

  if (screen === "settings") {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <View style={styles.topBar}>
          <Text style={styles.screenTitle}>Настройки</Text>
          <Pressable style={styles.ghostBtn} onPress={() => setScreen("main")}>
            <Text style={styles.ghostBtnText}>Готово</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.settingsPad}>
          <SettingCard
            title="Post-ASR corrector"
            hint="После распознавания подтягивает бренды из каталога к похожим словам. Не нейросеть."
            value={settings.correctorEnabled}
            onChange={(v) => void patchSettings({ ...settings, correctorEnabled: v })}
          />
          <SettingCard
            title="Авто после Стоп"
            hint="Сразу запускает распознавание, когда остановил запись. Живой текст во время записи не показываем."
            value={settings.autoTranscribeOnStop}
            onChange={(v) => void patchSettings({ ...settings, autoTranscribeOnStop: v })}
          />
          <SettingCard
            title="Игнор кэша"
            hint="Не брать готовый текст из SQLite — каждый раз новый прогон. Удобно сравнивать настройки."
            value={settings.ignoreCache}
            onChange={(v) => void patchSettings({ ...settings, ignoreCache: v })}
          />
          <SettingCard
            title="Таймкоды сегментов"
            hint="Показать куски с секундами вместо одного сплошного текста."
            value={settings.showSegments}
            onChange={(v) => void patchSettings({ ...settings, showSegments: v })}
          />

          <Text style={styles.groupLabel}>Фильтры Silero VAD</Text>
          <Hint>
            VAD решает, где речь, а где тишина. Ниже порог — ловит шёпот и шум. Выше — только
            громкую речь.
          </Hint>
          <NumCard
            title="Порог чувствительности"
            hint="0.05…0.90. Меньше = чувствительнее (больше фона в ASR)."
            value={settings.vadThreshold.toFixed(2)}
            onMinus={() =>
              void patchSettings({
                ...settings,
                vadThreshold: Math.max(0.05, +(settings.vadThreshold - 0.05).toFixed(2)),
              })
            }
            onPlus={() =>
              void patchSettings({
                ...settings,
                vadThreshold: Math.min(0.9, +(settings.vadThreshold + 0.05).toFixed(2)),
              })
            }
          />
          <NumCard
            title="Мин. длительность речи"
            hint="Короче этого — не считаем речью (отрезает щелчки)."
            value={`${settings.vadMinSpeechSec.toFixed(2)} с`}
            onMinus={() =>
              void patchSettings({
                ...settings,
                vadMinSpeechSec: Math.max(0.05, +(settings.vadMinSpeechSec - 0.05).toFixed(2)),
              })
            }
            onPlus={() =>
              void patchSettings({
                ...settings,
                vadMinSpeechSec: Math.min(1, +(settings.vadMinSpeechSec + 0.05).toFixed(2)),
              })
            }
          />
          <NumCard
            title="Мин. тишина для разреза"
            hint="Пауза дольше этого — конец фразы. Меньше = чаще режет на куски."
            value={`${settings.vadMinSilenceSec.toFixed(2)} с`}
            onMinus={() =>
              void patchSettings({
                ...settings,
                vadMinSilenceSec: Math.max(0.05, +(settings.vadMinSilenceSec - 0.05).toFixed(2)),
              })
            }
            onPlus={() =>
              void patchSettings({
                ...settings,
                vadMinSilenceSec: Math.min(1.5, +(settings.vadMinSilenceSec + 0.05).toFixed(2)),
              })
            }
          />
          <NumCard
            title="Потоки CPU"
            hint="1–4. Больше — быстрее на мощных телефонах, сильнее греет."
            value={String(settings.numThreads)}
            onMinus={() =>
              void patchSettings({
                ...settings,
                numThreads: Math.max(1, settings.numThreads - 1),
              })
            }
            onPlus={() =>
              void patchSettings({
                ...settings,
                numThreads: Math.min(4, settings.numThreads + 1),
              })
            }
          />
          <NumCard
            title="Порог совпадения бренда"
            hint="Насколько похожим должно быть слово на бренд (0.50…0.95). Выше — строже."
            value={settings.brandMinScore.toFixed(2)}
            onMinus={() =>
              void patchSettings({
                ...settings,
                brandMinScore: Math.max(0.5, +(settings.brandMinScore - 0.02).toFixed(2)),
              })
            }
            onPlus={() =>
              void patchSettings({
                ...settings,
                brandMinScore: Math.min(0.95, +(settings.brandMinScore + 0.02).toFixed(2)),
              })
            }
          />

          <Text style={styles.groupLabel}>Каталог брендов</Text>
          <Hint>
            Добавь названия. Corrector заменит близкие формы в тексте. Нажми на чип, чтобы убрать.
          </Hint>
          <View style={styles.hotRow}>
            <TextInput
              style={styles.input}
              value={hotwordDraft}
              onChangeText={setHotwordDraft}
              placeholder="Например: Магнит"
              placeholderTextColor="#8A9AA8"
              onSubmitEditing={addHotword}
            />
            <Pressable style={styles.primaryBtn} onPress={addHotword}>
              <Text style={styles.primaryBtnText}>Добавить</Text>
            </Pressable>
          </View>
          <View style={styles.chips}>
            {settings.hotwords.length === 0 ? (
              <Text style={styles.muted}>Пока пусто</Text>
            ) : (
              settings.hotwords.map((h) => (
                <Pressable key={h} onPress={() => removeHotword(h)} style={styles.chip}>
                  <Text style={styles.chipText}>{h}  ×</Text>
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.logo}>Naslukh</Text>
          <Text style={styles.tagline}>Офлайн распознавание русской речи</Text>
        </View>
        <Pressable style={styles.settingsHit} onPress={() => setScreen("settings")}>
          <Text style={styles.settingsHitText}>Настройки</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        {!recording ? (
          <Action label="Запись" onPress={startRec} disabled={busy} />
        ) : (
          <Action label="Стоп" onPress={stopRec} tone="danger" />
        )}
        <Action label="Файл" onPress={pickFile} disabled={busy || recording} />
        <Action
          label={playing ? "Пауза" : "Слушать"}
          onPress={togglePlay}
          disabled={busy || recording || !uri}
        />
        <Action
          label="Распознать"
          onPress={() =>
            uri ? void transcribeUri(uri) : setStatus("Сначала запись или файл")
          }
          disabled={busy || !uri || recording}
          tone="primary"
        />
      </View>

      {recording ? (
        <MeterBars levelDb={meter} durationMs={recorderState.durationMillis} />
      ) : null}

      {progress.visible || busy ? (
        <ProgressPanel
          message={progress.message || status}
          progress={progress.progress}
          phase={progress.phase}
        />
      ) : (
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Статус</Text>
          <Text style={styles.statusValue}>{status}</Text>
          {uri ? (
            <Text style={styles.muted} numberOfLines={1}>
              {uri.replace(/^file:\/\//, "")}
            </Text>
          ) : (
            <Text style={styles.muted}>Аудио ещё нет — запиши или выбери файл</Text>
          )}
          {settings.hotwords.length > 0 ? (
            <Text style={styles.muted}>Бренды: {settings.hotwords.join(", ")}</Text>
          ) : null}
        </View>
      )}

      <View style={styles.transcript}>
        <View style={styles.transcriptHead}>
          <Text style={styles.transcriptLabel}>Текст</Text>
          <View style={styles.transcriptActions}>
            <Pressable
              style={[styles.miniBtn, !canExport && styles.actionDisabled]}
              disabled={!canExport}
              onPress={() => void copyTranscript()}
            >
              <Text style={styles.miniBtnText}>Копировать</Text>
            </Pressable>
            <Pressable
              style={[styles.miniBtn, styles.miniBtnPrimary, !canExport && styles.actionDisabled]}
              disabled={!canExport}
              onPress={() => void exportTranscript()}
            >
              <Text style={[styles.miniBtnText, styles.miniBtnTextOn]}>Экспорт</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
          <Text style={styles.transcriptBody}>{text || "Здесь появится расшифровка"}</Text>
          {settings.correctorEnabled && rawText && text !== rawText ? (
            <Text style={[styles.muted, { marginTop: 18 }]}>До corrector: {rawText}</Text>
          ) : null}
        </ScrollView>
      </View>
    </View>
  )
}

function ProgressPanel({
  message,
  progress,
  phase,
}: {
  message: string
  progress: number
  phase: string
}) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100)
  const title =
    phase === "download" ? "Скачивание моделей" : phase === "asr" ? "Распознавание" : "Работаем"
  return (
    <View style={styles.progressCard}>
      <Text style={styles.statusLabel}>{title}</Text>
      <Text style={styles.statusValue}>{message}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.pct}>{pct}%</Text>
    </View>
  )
}

function MeterBars({ levelDb, durationMs }: { levelDb: number; durationMs: number }) {
  const pulse = useRef(new Animated.Value(0.45)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 480, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 480, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  const norm = Math.max(0, Math.min(1, (levelDb + 50) / 50))
  const heights = [0.4, 0.7, 1, 0.65, 0.45].map((b) => 14 + (b * 0.45 + norm * 0.55) * 40)

  return (
    <View style={styles.meterCard}>
      <Animated.View style={[styles.recDot, { opacity: pulse }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.meterTitle}>Запись {(durationMs / 1000).toFixed(1)} с</Text>
        <Text style={styles.muted}>Экран не гаснет · говори спокойно</Text>
      </View>
      <View style={styles.bars}>
        {heights.map((h, i) => (
          <View key={i} style={[styles.bar, { height: h }]} />
        ))}
      </View>
    </View>
  )
}

function SettingCard({
  title,
  hint,
  value,
  onChange,
}: {
  title: string
  hint: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <View style={styles.settingCard}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#D5DEE6", true: "#7DB8A8" }}
        thumbColor={value ? "#0F6B5C" : "#F7FAFC"}
      />
    </View>
  )
}

function NumCard({
  title,
  hint,
  value,
  onMinus,
  onPlus,
}: {
  title: string
  hint: string
  value: string
  onMinus: () => void
  onPlus: () => void
}) {
  return (
    <View style={styles.settingCard}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingHint}>{hint}</Text>
        <Text style={styles.numValue}>{value}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable style={styles.stepBtn} onPress={onMinus}>
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Pressable style={styles.stepBtn} onPress={onPlus}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

function Hint({ children }: { children: string }) {
  return <Text style={styles.groupHint}>{children}</Text>
}

function Action({
  label,
  onPress,
  disabled,
  tone,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: "primary" | "danger"
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.action,
        tone === "primary" && styles.actionPrimary,
        tone === "danger" && styles.actionDanger,
        disabled && styles.actionDisabled,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          (tone === "primary" || tone === "danger") && styles.actionTextOn,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#EEF3F6",
    paddingTop: 52,
    paddingHorizontal: 18,
  },
  hero: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 18,
    gap: 12,
  },
  logo: {
    fontSize: 36,
    fontWeight: "800",
    color: "#12323A",
    letterSpacing: -0.8,
  },
  tagline: {
    marginTop: 4,
    fontSize: 14,
    color: "#5B6E78",
  },
  settingsHit: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#E1EBEF",
  },
  settingsHitText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F6B5C",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  action: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#E1EBEF",
  },
  actionPrimary: { backgroundColor: "#0F6B5C" },
  actionDanger: { backgroundColor: "#B23B2F" },
  actionDisabled: { opacity: 0.4 },
  actionText: { fontSize: 15, fontWeight: "700", color: "#12323A" },
  actionTextOn: { color: "#FFF" },
  statusCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#F7FBFC",
    borderWidth: 1,
    borderColor: "#D7E3EA",
    gap: 4,
  },
  progressCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#E7F4F0",
    borderWidth: 1,
    borderColor: "#B7D9CF",
    gap: 8,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#5B6E78",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#12323A",
    lineHeight: 22,
  },
  muted: { fontSize: 12, color: "#7A8B96", marginTop: 2 },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#C9E4DC",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: "#0F6B5C",
    borderRadius: 999,
  },
  pct: {
    alignSelf: "flex-end",
    fontSize: 13,
    fontWeight: "700",
    color: "#0F6B5C",
  },
  transcript: {
    marginTop: 14,
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#FBFDFF",
    borderWidth: 1,
    borderColor: "#D7E3EA",
    padding: 16,
  },
  transcriptHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  transcriptLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#5B6E78",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  transcriptActions: {
    flexDirection: "row",
    gap: 6,
    flexShrink: 1,
  },
  miniBtn: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#E1EBEF",
  },
  miniBtnPrimary: {
    backgroundColor: "#0F6B5C",
  },
  miniBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#12323A",
  },
  miniBtnTextOn: {
    color: "#FFF",
  },
  transcriptBody: {
    fontSize: 17,
    lineHeight: 27,
    color: "#12323A",
  },
  meterCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#F8EDEA",
    borderWidth: 1,
    borderColor: "#E8C9C3",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  recDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#B23B2F",
  },
  meterTitle: { fontSize: 15, fontWeight: "700", color: "#12323A" },
  bars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    height: 48,
  },
  bar: {
    width: 7,
    borderRadius: 4,
    backgroundColor: "#B23B2F",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#12323A",
  },
  ghostBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#0F6B5C",
  },
  ghostBtnText: { color: "#FFF", fontWeight: "700" },
  settingsPad: { paddingBottom: 48, gap: 10 },
  groupLabel: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: "800",
    color: "#12323A",
  },
  groupHint: {
    fontSize: 13,
    lineHeight: 19,
    color: "#5B6E78",
    marginBottom: 4,
  },
  settingCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#F7FBFC",
    borderWidth: 1,
    borderColor: "#D7E3EA",
  },
  settingTitle: { fontSize: 15, fontWeight: "700", color: "#12323A" },
  settingHint: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: "#7A8B96",
  },
  numValue: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "800",
    color: "#0F6B5C",
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#E1EBEF",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { fontSize: 20, fontWeight: "700", color: "#12323A" },
  hotRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "#F7FBFC",
    borderWidth: 1,
    borderColor: "#D7E3EA",
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: "#12323A",
  },
  primaryBtn: {
    backgroundColor: "#0F6B5C",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryBtnText: { color: "#FFF", fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    backgroundColor: "#E1EBEF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontSize: 14, fontWeight: "600", color: "#12323A" },
})
