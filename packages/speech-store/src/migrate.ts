import {
  CHECKPOINT_FORMAT,
  MIGRATION_001,
  PIPELINE_VERSION,
} from "../../speech-core/src/index.ts"
import type { SqlDatabase } from "./types.ts"

const META = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`.trim()

export function migrate(db: SqlDatabase): void {
  db.exec(META)
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = ?").get("migration")
  const current = row ? Number(row.value) : 0
  if (current < 1) {
    db.exec(MIGRATION_001)
    db.prepare(
      "INSERT INTO schema_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run("migration", "1")
  }
  db.prepare(
    "INSERT INTO schema_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("pipeline_version", String(PIPELINE_VERSION))
  db.prepare(
    "INSERT INTO schema_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("checkpoint_format", String(CHECKPOINT_FORMAT))
}
