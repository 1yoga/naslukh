# @naslukh/speech-rn

Android-оболочка контракта `SpeechEngine`: **Silero VAD + GigaAM v3** через sherpa-onnx (JNI).

- `ensureModel` — локальные файлы в `filesDir/naslukh-models/`; если нет — скачивает zip со своего хоста (D16) и проверяет SHA-256
- `transcribeFile` — WAV / m4a / AAC → PCM 16 кГц mono; Silero (коммит раз в 60 с) → куски ≤30 с → GigaAM → сегменты в SQLite (`naslukh-speech.db`); повтор того же файла — из кэша / продолжение с курсора
- `listenOnce` — Android `AudioRecord` → Silero VAD в реальном времени → автоматический конец реплики после 1,0 с тишины по умолчанию → GigaAM; ручное завершение через `stopListenOnce`, отмена через `cancelListenOnce`
- расшифровка по ходу реплики (с 0.3.0): речь режется на куски по паузам внутри реплики и расшифровывается, пока человек говорит дальше; после конца речи остаётся последний кусок
- события живого диалога (с 0.2.0): уровень сигнала `onAudioLevel`, пауза внутри реплики `onSpeechPause` / `onSpeechResume`, захват с эхоподавлением и монитор речи во время воспроизведения (`monitorSpeech` → `listenOnce({ continueFromMonitor })`)
- ручная запись в приложение для обратной совместимости остаётся доступна отдельно
- ворота памяти D3: старт запрещён, если свободно меньше 600 МБ

## Модели (не npm)

Веса не в APK. URL/SHA-256 — в `ModelStore` (`MODELS_ZIP_URL`, `MODELS_ZIP_SHA256`).
После скачивания раскладка:

```
files/naslukh-models/silero_vad.onnx
files/naslukh-models/sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16/
  encoder.int8.onnx  decoder.onnx  joiner.onnx  tokens.txt
```

## Установка в сторонний Expo-проект (Android)

Проверено с Expo SDK 58. Нужна собственная Android-сборка приложения: Expo Go не содержит модуль `NaslukhSpeech`.

```bash
npm install @naslukh/speech-rn@0.3.0
npx expo install expo-build-properties
```

Добавьте JitPack для зависимости **sherpa-onnx JNI** через готовый [config plugin Expo](https://docs.expo.dev/versions/latest/sdk/build-properties/) в `app.json`:

```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", {
        "android": { "extraMavenRepos": ["https://www.jitpack.io"] }
      }]
    ]
  }
}
```

Сохраните и другие плагины приложения в том же массиве. `expo-build-properties` применяет настройку при `expo prebuild`; собственный плагин для JitPack пакету не требуется. Если проект уже поддерживает `android/` вручную и не запускает prebuild, добавьте `maven { url 'https://www.jitpack.io' }` в репозитории `allprojects` файла `android/build.gradle` (как в тестовом приложении).

```bash
npx expo prebuild --platform android
npx expo run:android
```

Модуль и разрешение `RECORD_AUDIO` попадают в Android-проект через Expo autolinking и manifest библиотеки. Перед прослушиванием запросите разрешение у пользователя. При первом `ensureModel()` приложение скачивает модели со своего хоста, проверяет SHA-256 и сохраняет их в `filesDir/naslukh-models/`; нужен доступ к сети и свободное место. Последующие вызовы используют локальные файлы, модели не входят в npm-пакет или APK.

```ts
import { PermissionsAndroid } from "react-native"
import { createSpeechEngine, GIGAAM_MODEL_ID } from "@naslukh/speech-rn"

const engine = createSpeechEngine({ allowStub: false })
async function listen() {
  const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
  if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Нужен микрофон")
  await engine.ensureModel(GIGAAM_MODEL_ID)
  return (await engine.listenOnce({ language: "ru" })).text
}
// По окончании реплики промис вернёт окончательный текст.
// engine.stopListenOnce() завершает запись и распознаёт услышанное;
// engine.cancelListenOnce() отклоняет ожидающий промис без результата.
```

`npm run build` создаёт `dist/*.js` и `dist/*.d.ts`; npm вызывает сборку через `prepare` при упаковке и локальной установке папки пакета. Для проверки состава архива перед публикацией выполните `npm pack --dry-run` из `packages/speech-rn`.

`vadMinSilenceSec` задаёт паузу перед завершением `listenOnce()` (по умолчанию 1,0 с). Для `transcribeFile` значение по умолчанию остаётся 0,25 с.

У `listenOnce()` порог `vadThreshold` по умолчанию 0,5; у `transcribeFile` остаётся 0,15. Опция `saveAudio: true` сохраняет захваченную фразу как локальный WAV в кэше приложения и возвращает `audioUri`; при следующем таком вызове файл перезаписывается.

## События живого диалога (0.2.0)

Для голосовых собеседников и ассистентов, где важно, как человек говорит, а не только что он сказал. Все опции необязательные: без них `listenOnce()` ведёт себя как в 0.1.0. Подписки возвращают функцию отписки; после `cancelListenOnce()` и `monitor.stop()` событий нет. В событиях `listenOnce` приходит `sessionId`, он же возвращается в результате.

### Уровень сигнала

```ts
const off = engine.addAudioLevelListener(({ rmsDbfs, peak, speech }) => {
  // rmsDbfs: −90…0, peak: 0…1, speech: решение Silero VAD
})
await engine.listenOnce({ language: "ru" }) // ≈15 событий/с, пока есть подписчик
off()
```

Период задаёт `audioLevelIntervalMs` (50–1000 мс, по умолчанию 66; 0 — выключить). Считается по тем же кадрам, что идут в VAD, второго `AudioRecord` нет. Пока предыдущее событие не доставлено в JS, новое отбрасывается — очередь не растёт.

### Пауза внутри реплики

```ts
engine.addSpeechPauseListener(({ silenceMs, utteranceMs }) => { /* можно коротко отреагировать */ })
engine.addSpeechResumeListener(() => { /* человек продолжил */ })
const { text } = await engine.listenOnce({ language: "ru", speechPauseMs: 700, vadMinSilenceSec: 2.5 })
```

`onSpeechPause` приходит один раз на паузу длиной `speechPauseMs` (100–5000 мс, меньше `vadMinSilenceSec`); захват продолжается, итоговый текст содержит всю реплику. Пауза считается по вероятности речи на каждом окне (отдельный экземпляр Silero), а не по сегментам основного VAD, которые закрываются только после `vadMinSilenceSec`.

### Эхоподавление и перебивание

`echoCancellation: true` открывает микрофон с источником `VOICE_COMMUNICATION` и включает `AcousticEchoCanceler` / `NoiseSuppressor`, где устройство их даёт (`capabilities().echoCancellation`). Так можно слушать, пока телефон сам воспроизводит речь. Сравните распознавание с обычным режимом на своих устройствах: обработка голосового канала может немного влиять на WER.

Монитор речи слушает во время воспроизведения и сообщает, когда пользователь заговорил; `listenOnce({ continueFromMonitor })` забирает его захват — второй `AudioRecord` не открывается, начало фразы (`prerollMs`) не теряется:

```ts
const monitor = await engine.monitorSpeech({ minSpeechMs: 300, prerollMs: 600 }) // эхоподавление включено
monitor.onSpeech(async () => {
  await tts.stop() // приложение останавливает своё воспроизведение
  const { text } = await engine.listenOnce({
    language: "ru",
    continueFromMonitor: monitor.id,
    echoCancellation: true,
  })
})
await tts.speak(answer)
await monitor.stop() // ответ дослушан без перебивания; после continueFromMonitor stop() ничего не делает
```

Монитор и `listenOnce` не работают одновременно: пока монитор запущен, `listenOnce()` без `continueFromMonitor` отклоняется. Параметры монитора: `vadThreshold` (0,6 — строже, чем у `listenOnce`, чтобы не ловить остаток эха), `minSpeechMs` (300), `prerollMs` (600), `echoCancellation` (true).

## Расшифровка по ходу реплики (0.3.0)

По умолчанию `listenOnce()` не ждёт конца реплики, чтобы начать распознавание: речь режется на куски, и каждый кусок расшифровывается в фоне, пока человек говорит. После решения VAD «реплика кончилась» остаётся расшифровать только хвост, поэтому время до результата почти не зависит от длины реплики. Вызов и результат (`text`, `segments`) для приложения те же.

### Как режется

- **По паузе.** Когда внутри реплики тишина длится `incrementalPauseMs` (по умолчанию 400 мс), звук от прошлой точки реза до середины этой тишины становится куском. Режем только по тишине, чтобы не делить слова. Пауза считается по вероятности речи на каждом окне Silero (тот же отдельный оконный экземпляр, что и для `speechPauseMs`, счётчики независимые). К куску добавляется по 200 мс соседней тишины с каждой стороны; в `segments` границы куска без этого запаса, поэтому они идут встык.
- **Сплошная речь.** Если кусок дорос до `maxSegmentSec` (8 с), он режется в самом тихом месте последних 1,5 с (минимум энергии), чтобы хвост не вырастал.
- **Короткие реплики.** Куски короче `minSegmentSec` (2 с) не режутся, а копятся дальше. Реплика, где резов нет, расшифровывается одним куском, как в 0.2.0.
- **Конец реплики.** Расшифровывается хвост после последнего реза; если очередь ещё не дошла до него, `listenOnce()` её дожидается. Хвост из одной тишины (меньше 0,1 с речи) не расшифровывается: обычно последний кусок режется по паузе ещё до решения VAD, и к его концу текст уже готов.
- `incrementalPauseMs` должен быть меньше `vadMinSilenceSec` · 1000: иначе VAD завершит реплику раньше, чем наступит рез, и для этого вызова расшифровка по ходу реплики выключается (в logcat предупреждение).

### Опции

| Опция | Диапазон | По умолчанию | Смысл |
| --- | --- | --- | --- |
| `incrementalDecode` | boolean | `true` | `false` — вся реплика одним куском после конца речи, как в 0.2.0 |
| `incrementalPauseMs` | 200–2000 мс | 400 | пауза внутри реплики, по которой режется кусок |
| `maxSegmentSec` | 3–30 с | 8 | принудительный рез сплошной речи |
| `minSegmentSec` | 0,5–10 с | 2 | кусок короче не режем |

Значения 400 мс / 2 с / 8 с стартовые. Они не подобраны на тестовом наборе реплик; итоговые значения нужно записать здесь после подбора.

### Ресурсы

Один экземпляр модели и один фоновый поток расшифровки на процесс (`NaslukhDecode`, приоритет чуть ниже обычного; пока реплика дожидается результата, обычный). Куски стоят в очереди по порядку, захват их не ждёт и кадры не теряет. `numThreads` ONNX не увеличивается. `cancelListenOnce()` останавливает захват и снимает очередь; следующий `listenOnce()` не ждёт старую сессию, максимум встаёт в очередь за одним уже запущенным куском.

### Время и лог

```ts
const { text, timings } = await engine.listenOnce({ language: "ru" })
// timings: { finalizeMs, tailDecodeMs, totalDecodeMs, segments, endSilenceMs }
```

| Поле | Смысл |
| --- | --- |
| `finalizeMs` | от решения VAD «реплика кончилась» до готового текста, мс; считается в нативной части, пост-правка корректором в JS в него не входит |
| `tailDecodeMs` | расшифровка последнего куска; 0, если хвост состоял из тишины |
| `totalDecodeMs` | сумма расшифровки всех кусков |
| `segments` | сколько кусков |
| `endSilenceMs` | сколько тишины ждали до решения VAD (≈ `vadMinSilenceSec`) |

На каждую реплику пишется одна строка logcat: тег `NaslukhTiming`, префикс `listenOnceTiming:`, JSON с теми же цифрами и прежними полями (`recognitionMs`, `endToTextMs` и др.). Задержку можно сверить без приложения: `adb logcat -s NaslukhTiming`.

### Событие куска

```ts
const off = engine.addListenSegmentListener(({ sessionId, index, text, startMs, endMs }) => {
  // кусок расшифрован, реплика ещё идёт: можно показывать текст или готовить ответ
})
```

Событие приходит, когда кусок расшифрован. Текст черновой (к нему применяется корректор, если он включён, но куски не склеиваются): окончательный текст — в результате `listenOnce()`. После `cancelListenOnce()` события этой сессии не приходят. `capabilities().partialResults` равен `true`.

### Стыки кусков

Модель расшифровывает каждый кусок как отдельную реплику, поэтому на границе может поставить точку в конце и заглавную букву в начале. При склейке (`joinSegmentTexts`, `text` — куски по порядку через пробел, затем корректор на всём тексте):

- рез **по паузе** не трогаем: пауза от 400 мс чаще всего и есть граница предложения;
- рез **в сплошной речи** (`maxSegmentSec`) границей предложения быть не может: убираем замыкающую точку или многоточие и понижаем регистр первой буквы следующего куска (кроме «Я», аббревиатур и слов с несколькими заглавными). Имя собственное на таком стыке теряет заглавную букву; такой рез редок (речь дольше 8 с без паузы).

Это эвристика, написанная до проверки на реальных расшифровках GigaAM v3: поведение модели на границе куска нужно проверить на тестовом наборе реплик (сравнить `text` с цельной расшифровкой через `transcribeFile` по `saveAudio` WAV) и при необходимости поправить правила в `src/join.ts`.

## Ограничения v1

- Только Android (iOS позже)
- Opus/NSOP импорт как в Node пока нет — вход декодируется сразу в PCM
- `listenOnce()` отдаёт промежуточный текст только по кускам реплики (`addListenSegmentListener`, текст черновой), без побуквенных partial results; ограничивает фразу 30 секундами и требует, чтобы приложение заранее запросило `RECORD_AUDIO`
- постоянное фоновое прослушивание (D7/D17) — не в этой поставке
- `vadMinSilenceSec` у `listenOnce()` — не больше 3 с
- качество эхоподавления зависит от устройства; на телефонах без `AcousticEchoCanceler` монитор речи работает только с тихим воспроизведением или через гарнитуру

## Лицензии

Собственный код пакета — MIT, см. [LICENSE](LICENSE). Для sherpa-onnx и отдельно скачиваемых моделей GigaAM/Silero см. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Лицензия пакета не распространяется на эти компоненты.
