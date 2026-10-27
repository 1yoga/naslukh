# @naslukh/speech-vad

Node-харнесс одного прохода Silero VAD по WAV 16 кГц. Интервалы и курсор пишутся в `@naslukh/speech-store`; куски для распознавания собирает `@naslukh/speech-core`.

Модель и тестовый файл лежат в `.cache/` (в git не входят) и скачиваются при первом запуске.

## Проверка

```bash
npm run test:speech-vad
npm run vad:file
```

Свой файл: `npm run vad:file -- path/to/file.wav`.
