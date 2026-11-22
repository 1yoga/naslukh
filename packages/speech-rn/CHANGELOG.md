# Changelog

## 0.3.0

Расшифровка реплики по ходу записи: `listenOnce()` режет речь на куски по паузам внутри реплики и расшифровывает их в фоне, пока человек говорит дальше. После конца речи остаётся расшифровать только последний кусок, поэтому задержка почти не зависит от длины реплики. Вызов и результат для приложения не меняются; обратно совместимо с 0.2.0: всё новое — необязательные опции, поля и события.

- Опции `listenOnce`: `incrementalDecode` (по умолчанию `true`; `false` — поведение 0.2.0), `incrementalPauseMs` (400), `maxSegmentSec` (8), `minSegmentSec` (2).
- `ListenOnceResult.timings`: `finalizeMs`, `tailDecodeMs`, `totalDecodeMs`, `segments`, `endSilenceMs`; те же цифры одной строкой в logcat (тег `NaslukhTiming`, префикс `listenOnceTiming:`).
- `addListenSegmentListener` — событие `onListenSegment`: кусок расшифрован, реплика ещё идёт (текст черновой).
- `capabilities()`: `incrementalDecode`; `partialResults` теперь `boolean` и `true`.
- `ListenOnceResult.segments` — куски реплики с `startSample` / `endSample` (в 0.2.0 был один сегмент на всю реплику).
- `transcribeFile` не менялся.

Задержка после конца речи (`finalizeMs`, медиана из 10 запусков, OnePlus 7 Pro / Snapdragon 855, release, `vadMinSilenceSec` 1,5 с):

| Случай | 0.2.0 | 0.3.0 | Цель |
| --- | --- | --- | --- |
| Реплика 2–4 с | 0,4–0,5 с | _не измерено_ | не хуже 0.2.0 (± 50 мс) |
| 10 с с двумя и более паузами по 0,5 с | ≈ 2 с | _не измерено_ | ≤ 0,6 с |
| 15 с непрерывной речи | — | _не измерено_ | ≤ 1,0 с |
| 30 с (лимит) | — | _не измерено_ | ≤ 1,0 с, текст полный |

Колонка 0.3.0 заполняется после замеров на устройстве. Значение по умолчанию `incrementalDecode: true` подтверждается тестовым набором (WER не хуже цельной расшифровки более чем на 1 п.п.); если разница больше — по умолчанию станет `false`, и это нужно записать здесь.

## 0.2.0

Новые возможности для живого голосового диалога. Обратно совместимо с 0.1.0: всё новое — необязательные опции, события и методы.

- `addAudioLevelListener` — уровень сигнала во время `listenOnce()` (`rmsDbfs`, `peak`, `speech`, `timestampMs`); опция `audioLevelIntervalMs`.
- `speechPauseMs` + `addSpeechPauseListener` / `addSpeechResumeListener` — пауза внутри реплики без её завершения.
- `echoCancellation` — захват через `VOICE_COMMUNICATION` с `AcousticEchoCanceler` и `NoiseSuppressor`, где они есть.
- `monitorSpeech()` — слушать во время воспроизведения и сообщить, когда пользователь заговорил; `listenOnce({ continueFromMonitor })` продолжает реплику с захвата монитора без потери начала.
- `ListenOnceResult.sessionId` — тот же идентификатор, что в событиях прослушивания.
- `capabilities()`: `audioLevel`, `speechPause`, `speechMonitor`, `echoCancellation`.
- Нативные события `onAudioLevel`, `onSpeechPause`, `onSpeechResume`, `onMonitorSpeech`; функции модуля `startSpeechMonitor`, `stopSpeechMonitor`, `isEchoCancellationAvailable`.

## 0.1.0

Первая публикация: `ensureModel`, `transcribeFile`, `listenOnce` на Android (Silero VAD + GigaAM v3 через sherpa-onnx).
