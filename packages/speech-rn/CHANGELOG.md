# Changelog

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
