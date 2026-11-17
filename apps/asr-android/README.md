# Naslukh ASR (Android)

Маленькое приложение только для проверки `@naslukh/speech-rn`: запись / файл → офлайн GigaAM → текст.

Mystery Shopper сюда не входит.

```bash
cd apps/asr-android
npm install
npx expo prebuild --platform android
# в android/build.gradle уже нужен JitPack (prebuild + правка)
npm run android
```

Пакет: `ru.naslukh.asrdemo`. Модели (~230 МБ) — в `files/naslukh-models/` (скачивание или adb push).
