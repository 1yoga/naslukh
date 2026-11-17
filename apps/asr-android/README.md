# Naslukh ASR (Android)

Маленькое приложение только для проверки `@naslukh/speech-rn`: запись / файл → офлайн GigaAM → текст.

Кнопка **Фраза** запускает `listenOnce()`: скажите фразу и замолчите — Silero VAD сам завершит захват, затем GigaAM вернёт текст. **Завершить** распознаёт уже захваченную речь, **Отмена** прекращает прослушивание без результата. Ручная запись и распознавание файла доступны отдельно.

Mystery Shopper сюда не входит.

```bash
cd apps/asr-android
npm install
npx expo prebuild --platform android
# в android/build.gradle уже нужен JitPack (prebuild + правка)
npm run android
```

Пакет: `ru.naslukh.asrdemo`. Модели (~230 МБ) — в `files/naslukh-models/` (скачивание или adb push).
