# @naslukh/speech-rn

Android-оболочка контракта `SpeechEngine`: **Silero VAD + GigaAM v3** через sherpa-onnx (JNI).

- `ensureModel` — локальные файлы в `filesDir/naslukh-models/`; если нет — скачивает zip со своего хоста (D16) и проверяет SHA-256
- `transcribeFile` — WAV / m4a / AAC → PCM 16 кГц mono; Silero (коммит раз в 60 с) → куски ≤30 с → GigaAM → сегменты в SQLite (`naslukh-speech.db`); повтор того же файла — из кэша / продолжение с курсора
- `listenOnce` — Android `AudioRecord` → Silero VAD в реальном времени → автоматический конец реплики → GigaAM; ручное завершение через `stopListenOnce`, отмена через `cancelListenOnce`
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

## Подключение (Expo)

1. Зависимость `file:` / npm на этот пакет (код).
2. JitPack в app `build.gradle` — для **sherpa-onnx JNI** (нативная либа ASR, не модели):

```gradle
maven { url 'https://www.jitpack.io' }
```

3. `npx expo prebuild` / `expo run:android`.

Приложение запрашивает у пользователя `RECORD_AUDIO` до вызова `listenOnce()`. Затем:

```ts
import { createSpeechEngine, GIGAAM_MODEL_ID } from "@naslukh/speech-rn"

const engine = createSpeechEngine({ allowStub: false })
await engine.ensureModel(GIGAAM_MODEL_ID)
const { text } = await engine.listenOnce({ language: "ru" })
// По окончании реплики промис вернёт окончательный текст.
// engine.stopListenOnce() завершает запись и распознаёт услышанное;
// engine.cancelListenOnce() отклоняет ожидающий промис без результата.
```

## Ограничения v1

- Только Android (iOS позже)
- Opus/NSOP импорт как в Node пока нет — вход декодируется сразу в PCM
- `listenOnce()` не даёт partial results, ограничивает фразу 30 секундами и требует, чтобы приложение заранее запросило `RECORD_AUDIO`
- постоянное фоновое прослушивание (D7/D17) — не в этой поставке
