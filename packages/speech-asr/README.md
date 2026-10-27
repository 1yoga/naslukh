# @naslukh/speech-asr

Node-харнесс длинного файла: импорт WAV → Opus NSOP → Silero VAD → куски ≤30 с → GigaAM v3 e2e RNN-T → сегменты в `@naslukh/speech-store`. Склейка перехлёста — по центрам токенов (D1).

`createNodeEngine` реализует контракт `SpeechEngine` из `@naslukh/speech-core` для файлов (без микрофона). Приложение вызывает `transcribeFile` и слушает `state` / `segment` / `progress`.

Модель скачивается в `.cache/models/` при первом запуске (~232 МБ), SHA-256 энкодера сверяется с `docs/decisions.md`.

## Проверка

```bash
npm run test:speech-asr
npm run asr:file
npm run asr:pipeline
npm run asr:engine
```

Свой WAV 16 кГц: `npm run asr:engine -- path/to/file.wav`.
