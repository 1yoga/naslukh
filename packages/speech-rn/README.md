# @naslukh/speech-rn

Android-оболочка контракта `SpeechEngine` для приложений (тайный покупатель и др.).

- `ensureModel` / `transcribeFile` — нативный модуль `NaslukhSpeech`
- запись с микрофона остаётся в приложении
- в `__DEV__` без нативного модуля допускается JS-заглушка для отладки UI

Подключение в Expo: `file:` на этот пакет + `npx expo prebuild` / `expo run:android`.
