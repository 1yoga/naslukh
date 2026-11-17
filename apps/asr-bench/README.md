# asr-bench

Стенд: прогнать `@naslukh/speech-asr` (GigaAM) по локальным файлам и **сравнить с текстом Gemini** (или другим примером).

Gemini тут **не ground truth** — просто удобный ориентир «как облако услышало тот же ролик». Расхождения ≠ обязательно ошибка naslukh.

## Раскладка сэмплов

```
apps/asr-bench/samples/
  case-001/
    audio.wav          # предпочтительно PCM 16 kHz mono
    # или audio.m4a / audio.mp3 / audio.ogg — нужен ffmpeg
    reference.txt      # пример транскрипта (часто Gemini / TR map)
  case-002/
    audio.wav
    reference.txt
```

Имена `audio.*` и `reference.txt` фиксированные. Имя папки = id в отчёте.

## Запуск

Из корня репо:

```bash
npm run asr:bench
npm run asr:bench -- --case case-001
npm run asr:score   # WER + бренды/фразы vs Gemini-пример (без повторного ASR)
```

Отчёт: `apps/asr-bench/out/report.json`, `task-report.json`, рядом `samples/<id>/naslukh.txt`.
