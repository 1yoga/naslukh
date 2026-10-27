/** Единая шкала: моно PCM. */
export const SAMPLE_RATE_HZ = 16_000

/** Кусок длиннее этого в модель не попадает. */
export const MAX_CHUNK_SEC = 30

export const MAX_CHUNK_SAMPLES = MAX_CHUNK_SEC * SAMPLE_RATE_HZ

/**
 * Нижняя граница окна, где рез предпочитают ставить на паузу.
 * Верхняя — MAX_CHUNK_SEC.
 */
export const SOFT_CUT_MIN_SEC = 20

export const SOFT_CUT_MIN_SAMPLES = SOFT_CUT_MIN_SEC * SAMPLE_RATE_HZ

/** Отступ Silero с каждой стороны интервала. */
export const VAD_PAD_SEC = 0.25

export const VAD_PAD_SAMPLES = Math.round(VAD_PAD_SEC * SAMPLE_RATE_HZ)

/**
 * Перехлёст, когда рез идёт по речи (D2, старт).
 * Итог заменит приёмка фазы 8.
 */
export const OVERLAP_SEC = 0.8

export const OVERLAP_SAMPLES = Math.round(OVERLAP_SEC * SAMPLE_RATE_HZ)

/** Как часто проход VAD фиксирует курсор вместе с новыми интервалами. */
export const VAD_COMMIT_SEC = 60

export const VAD_COMMIT_SAMPLES = VAD_COMMIT_SEC * SAMPLE_RATE_HZ

/**
 * Стартовый битрейт Opus (D5). Итог пишет замер на корпусе.
 * Единица — бит/с.
 */
export const OPUS_BITRATE_BPS = 24_000

/** Длина кадра Opus: 20 мс на шкале 16 кГц. */
export const OPUS_FRAME_SAMPLES = 320

/**
 * Минимум свободной памяти для старта (D3).
 * Смена только по замеру до выпуска.
 */
export const MIN_FREE_MEMORY_BYTES = 600 * 1024 * 1024

/** Бюджет пробы WASM после загрузки модели (D10). */
export const WASM_PROBE_SEC = 30

/** feature_dim GigaAM v3 e2e RNN-T. */
export const GIGAAM_FEATURE_DIM = 64

/** Меняется, когда меняется запись чекпоинта на диске. */
export const CHECKPOINT_FORMAT = 1

/** Меняется, когда меняются нарезка, склейка или нормализация. */
export const PIPELINE_VERSION = 1

export const LIBRARY_VERSION = "0.1.0"
