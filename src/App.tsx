import { useEffect, useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { transcribeOnDevice, type AsrProgress } from '@/lib/asr'
import { blobTo16kMono, formatClock, formatMegabytes } from '@/lib/audio'
import { cn } from '@/lib/utils'
import { synthesizeRussian, VOICE_BYTES } from '@/lib/tts'

const MAX_SECONDS = 45
const ASR_BYTES = 82_000_000

const SAMPLES = [
  'Наслух держит речь на устройстве. Ни запись, ни текст не уходят на сервер.',
  'Завтра в девять встреча у метро Площадь Ленина. Возьми договор и паспорт.',
]

type Mode = 'listen' | 'speak'
type Phase = 'idle' | 'loading' | 'ready' | 'working' | 'error'

function Meter({ progress, label }: { progress: number | null; label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
        aria-label={label}
      >
        <div
          className={cn('h-full bg-primary', progress === null && 'w-1/3 animate-pulse')}
          style={progress === null ? undefined : { width: `${Math.max(4, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState<Mode>('listen')
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [asrPhase, setAsrPhase] = useState<Phase>('idle')
  const [asrProgress, setAsrProgress] = useState<AsrProgress | null>(null)
  const [transcript, setTranscript] = useState('')
  const [listenError, setListenError] = useState('')
  const [draft, setDraft] = useState(SAMPLES[0])
  const [ttsPhase, setTtsPhase] = useState<Phase>('idle')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [spokenBlob, setSpokenBlob] = useState<Blob | null>(null)
  const [speakError, setSpeakError] = useState('')
  const [isolated] = useState(() => self.crossOriginIsolated)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const elapsedRef = useRef(0)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    }
  }, [])

  function stopTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function recognize(blob: Blob) {
    setMode('listen')
    setListenError('')
    setAsrPhase('loading')
    setAsrProgress(null)
    try {
      const audio = await blobTo16kMono(blob)
      if (audio.length < 1_600) {
        throw new Error('Слишком короткая запись. Нужно хотя бы около секунды речи.')
      }
      const text = await transcribeOnDevice(audio, (progress) => {
        setAsrProgress(progress)
        setAsrPhase(progress.status === 'working' ? 'working' : 'loading')
      })
      setAsrPhase('ready')
      setTranscript(text || 'Речь не разобрана. Попробуйте тише фоновый шум и говорите ближе к микрофону.')
      setMode('listen')
    } catch (error) {
      setAsrPhase('error')
      const message = error instanceof Error ? error.message : 'Не удалось распознать речь'
      if (message.includes('decodeAudioData') || message.includes('EncodingError')) {
        setListenError('Этот файл браузер не открыл. Подойдёт wav, mp3 или запись с микрофона.')
      } else {
        setListenError(message)
      }
    }
  }

  function stopRecording() {
    stopTimer()
    setRecording(false)
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  async function startRecording() {
    setListenError('')
    setTranscript('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        void recognize(blob)
      }
      recorderRef.current = recorder
      recorder.start()
      elapsedRef.current = 0
      setElapsed(0)
      setRecording(true)
      timerRef.current = window.setInterval(() => {
        const next = Math.min(MAX_SECONDS, elapsedRef.current + 1)
        elapsedRef.current = next
        setElapsed(next)
        if (next >= MAX_SECONDS) stopRecording()
      }, 1000)
    } catch {
      setListenError('Нет доступа к микрофону. Разрешите его в браузере или откройте звуковой файл.')
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setTranscript('')
    await recognize(file)
  }

  async function speak() {
    setSpeakError('')
    setTtsPhase('loading')
    try {
      const blob = await synthesizeRussian(draft)
      setSpokenBlob(blob)
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      setAudioUrl(url)
      setTtsPhase('ready')
      queueMicrotask(() => {
        audioRef.current?.play().catch(() => {
          setSpeakError('Браузер заблокировал автозапуск. Нажмите воспроизведение на плеере.')
        })
      })
    } catch (error) {
      setTtsPhase('error')
      setSpeakError(error instanceof Error ? error.message : 'Не удалось синтезировать речь')
    }
  }

  const asrLabel =
    asrPhase === 'working' || (asrPhase === 'loading' && asrProgress && asrProgress.progress > 99)
      ? 'Считаю расшифровку на этом устройстве'
      : asrProgress && asrProgress.total > 0
        ? `Скачиваю модель распознавания: ${formatMegabytes(asrProgress.loaded)} из ${formatMegabytes(asrProgress.total)}`
        : `Скачиваю Whisper base, около ${formatMegabytes(ASR_BYTES)}. Это один раз, дальше файл берётся из кэша.`

  return (
    <div className="min-h-dvh">
      <div className="h-1 bg-primary" />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <header className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
            На устройстве · русский
          </p>
          <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Наслух</h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            Диктовка и озвучка считаются в браузере. Запись и текст не отправляются на сервер.
            Это веб-срез того же принципа, на котором стоит собирать iOS и Android.
          </p>
        </header>

        {!isolated && (
          <p className="rounded-lg border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive" role="alert">
            Страница открыта без изоляции потоков. Модели не запустятся. Откройте адрес dev-сервера
            напрямую, не через встроенный просмотр без заголовков безопасности.
          </p>
        )}

        <div className="flex rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Режим">
          {(
            [
              ['listen', 'Слушать'],
              ['speak', 'Говорить'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              variant={mode === value ? 'default' : 'ghost'}
              className="h-11 flex-1 text-base"
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {mode === 'listen' ? (
          <section className="space-y-5" role="tabpanel" aria-label="Слушать">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Первая расшифровка скачает квантованную модель Whisper base, около 80 МБ. На телефоне
              вместо неё стоит GigaAM v3: она точнее на русском и весит около 220 МБ. Демо намеренно
              легче, чтобы страница открывалась без установки.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                size="lg"
                variant={recording ? 'destructive' : 'default'}
                className="h-14 px-6 text-base sm:min-w-52"
                aria-pressed={recording}
                onClick={() => (recording ? stopRecording() : void startRecording())}
                disabled={asrPhase === 'loading'}
              >
                {recording ? 'Остановить' : 'Записать'}
              </Button>
              <span className="font-serif text-3xl tabular-nums" aria-live="polite">
                {formatClock(elapsed)}
                <span className="ml-2 text-base text-muted-foreground">/ {formatClock(MAX_SECONDS)}</span>
              </span>
              <label className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-14 cursor-pointer px-5 text-base')}>
                Открыть файл
                <input
                  className="sr-only"
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void onFile(file)
                  }}
                />
              </label>
            </div>

            {(asrPhase === 'loading' || asrPhase === 'working') && (
              <Meter
                progress={asrPhase === 'working' ? null : (asrProgress?.progress ?? null)}
                label={asrPhase === 'working' ? 'Считаю расшифровку на этом устройстве' : asrLabel}
              />
            )}

            {listenError && (
              <p className="rounded-lg border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive" role="alert">
                {listenError}
              </p>
            )}

            <figure className="min-h-40 rounded-2xl border border-border bg-card px-5 py-6">
              <figcaption className="mb-3 text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                Расшифровка
              </figcaption>
              <blockquote className="font-serif text-2xl leading-snug" aria-live="polite">
                {transcript || 'Здесь появится текст. Говорите обычным голосом, до сорока пяти секунд.'}
              </blockquote>
            </figure>

            <Button
              type="button"
              variant="outline"
              className="h-11 px-4 text-base"
              disabled={!transcript || ttsPhase === 'loading'}
              onClick={() => {
                setDraft(transcript)
                setMode('speak')
              }}
            >
              Озвучить эту расшифровку
            </Button>
          </section>
        ) : (
          <section className="space-y-5" role="tabpanel" aria-label="Говорить">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Голос Ирины, Piper medium, {formatMegabytes(VOICE_BYTES)}. Тот же тип модели, что и в
              мобильном приложении: нейросеть на устройстве, не системный диктор и не облако.
            </p>

            <div className="flex flex-wrap gap-2">
              {SAMPLES.map((sample) => (
                <Button
                  key={sample}
                  type="button"
                  variant="outline"
                  className="h-auto max-w-full px-3 py-2 text-left text-sm whitespace-normal"
                  onClick={() => setDraft(sample)}
                >
                  {sample.slice(0, 42)}…
                </Button>
              ))}
            </div>

            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-40 bg-card px-4 py-3 font-serif text-xl leading-relaxed md:text-xl"
              aria-label="Текст для озвучки"
              maxLength={600}
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                className="h-14 px-6 text-base"
                disabled={ttsPhase === 'loading' || draft.trim().length === 0}
                onClick={() => void speak()}
              >
                {ttsPhase === 'loading' ? 'Готовлю голос' : 'Произнести'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-14 px-6 text-base"
                disabled={!spokenBlob || asrPhase === 'loading'}
                onClick={() => spokenBlob && void recognize(spokenBlob)}
              >
                Распознать этот звук
              </Button>
            </div>

            {ttsPhase === 'loading' && (
              <Meter
                progress={null}
                label={`Скачиваю голос Ирины, ${formatMegabytes(VOICE_BYTES)}, и считаю звук локально. Первый запуск длиннее.`}
              />
            )}

            {speakError && (
              <p className="rounded-lg border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive" role="alert">
                {speakError}
              </p>
            )}

            {audioUrl && (
              <audio ref={audioRef} className="w-full" controls src={audioUrl} preload="auto" />
            )}
          </section>
        )}

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-serif text-2xl">Как собирать приложение</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            В аудиотракт не ставить языковую модель. Распознавание — GigaAM v3 через sherpa-onnx,
            озвучка — Piper в том же рантайме. Оболочка одна: React Native на iOS и Android, на вебе
            тот же контракт через WebAssembly. Ionic для этого слабее: WebView хуже держит микрофон
            и тяжелее считает модель. Два отдельных нативных приложения имеют смысл, только если есть
            две платформенные команды.
          </p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['216 МБ', 'GigaAM v3 int8'],
              ['63 МБ', 'голос Piper'],
              ['8,3%', 'средний WER v3 RNN-T'],
              ['0', 'сеть во время диктовки'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-border bg-card px-3 py-3">
                <dt className="font-serif text-2xl">{value}</dt>
                <dd className="mt-1 text-xs leading-snug text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  )
}
