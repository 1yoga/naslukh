# @naslukh/speech-core

Контракт офлайн-транскрибации русской речи. Здесь типы задания, возможности среды, манифест модели, миграция базы, нормализатор для WER, нарезка кусков после Silero, правила чекпоинта VAD и ворота памяти D3.

Движков в этом пакете нет. Node-оболочка файла — `createNodeEngine` в `@naslukh/speech-asr`. `speech-rn` и полный `speech-web` появятся отдельно и исполнят тот же контракт. Приложение вызывает `SpeechEngine` и не знает про Opus, SQLite, нарезку и WASM.

Решения, которые ещё не закрыты замером, лежат в [`docs/decisions.md`](../../docs/decisions.md).

## Проверка

Из корня репозитория:

```bash
npm run typecheck:speech-core
npm run test:speech-core
```
