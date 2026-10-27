/** Единая шкала: моно PCM. */
export const SAMPLE_RATE_HZ = 16_000

/** Кусок длиннее этого в модель не попадает. */
export const MAX_CHUNK_SEC = 30

export const MAX_CHUNK_SAMPLES = MAX_CHUNK_SEC * SAMPLE_RATE_HZ

/** Отступ Silero с каждой стороны интервала. */
export const VAD_PAD_SEC = 0.25

export const VAD_PAD_SAMPLES = Math.round(VAD_PAD_SEC * SAMPLE_RATE_HZ)

/** Как часто проход VAD фиксирует курсор вместе с новыми интервалами. */
export const VAD_COMMIT_SEC = 60

export const VAD_COMMIT_SAMPLES = VAD_COMMIT_SEC * SAMPLE_RATE_HZ

/** Меняется, когда меняется запись чекпоинта на диске. */
export const CHECKPOINT_FORMAT = 1

/** Меняется, когда меняются нарезка, склейка или нормализация. */
export const PIPELINE_VERSION = 1

export const LIBRARY_VERSION = "0.1.0"
