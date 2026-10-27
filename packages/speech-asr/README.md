# @naslukh/speech-asr

Node-харнесс длинного файла: Silero VAD → куски ≤30 с → GigaAM v3 e2e RNN-T → сегменты в `@naslukh/speech-store`. Склейка перехлёста — по центрам токенов (D1).

Модель скачивается в `.cache/models/` при первом запуске (~232 МБ), SHA-256 энкодера сверяется с `docs/decisions.md`.

## Проверка

```bash
npm run test:speech-asr
npm run asr:file
```

Свой WAV 16 кГц: `npm run asr:file -- path/to/file.wav`.
