/** Миграция 001. Её же выполняют нативный SQLite и SQLite WASM. */
export const MIGRATION_001 = `
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  source TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  pipeline_version INTEGER NOT NULL,
  checkpoint_format INTEGER NOT NULL,
  language TEXT NOT NULL,
  audio_path TEXT,
  audio_container TEXT,
  fingerprint_size INTEGER,
  fingerprint_sha256 TEXT,
  vad_cursor_sample INTEGER NOT NULL DEFAULT 0,
  last_committed_sample INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE vad_intervals (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  start_sample INTEGER NOT NULL,
  end_sample INTEGER NOT NULL
);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  vad_interval_id INTEGER REFERENCES vad_intervals(id),
  start_sample INTEGER NOT NULL,
  end_sample INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  model_version TEXT NOT NULL,
  UNIQUE (job_id, start_sample)
);

CREATE TABLE journal (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  event TEXT NOT NULL,
  job_id TEXT,
  state_from TEXT,
  state_to TEXT,
  model_version TEXT NOT NULL,
  pipeline_version INTEGER NOT NULL,
  checkpoint_format INTEGER NOT NULL,
  device_model TEXT NOT NULL,
  os_name TEXT NOT NULL,
  os_version TEXT NOT NULL,
  library_version TEXT NOT NULL
);
`.trim()
