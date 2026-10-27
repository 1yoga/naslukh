# @naslukh/speech-web

Ворота D6: проба GigaAM v3 в **ONNX Runtime WASM** (без серверного рантайма). Официального prebuilt sherpa-onnx WASM с GigaAM нет — проверяем загрузку трёх графов и короткий проход энкодера.

## Проверка

```bash
npm run wasm:probe
npm run test:speech-web
```

Результат пишется в `.cache/wasm-probe-gigaam.json`.
