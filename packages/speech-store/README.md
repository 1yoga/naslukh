# @naslukh/speech-store

SQLite-слой чекпоинта: миграция из `@naslukh/speech-core`, создание задания, атомарная запись интервалов Silero вместе с курсором, продолжение после сбоя.

Движка распознавания здесь нет. Node-адаптер (`node:sqlite`) — для харнесса и тестов; React Native и веб подставят свой SQL.

## Проверка

Из корня репозитория:

```bash
npm run typecheck:speech-store
npm run test:speech-store
```
