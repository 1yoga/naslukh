import { DatabaseSync } from "node:sqlite"
import type { SqlDatabase, SqlStatement, SqlValue } from "./types.ts"

export interface NodeSqliteDatabase extends SqlDatabase {
  close(): void
}

/** Адаптер node:sqlite для харнесса и тестов. */
export function openNodeSqlite(path = ":memory:"): NodeSqliteDatabase {
  const db = new DatabaseSync(path)
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL")
  }
  db.exec("PRAGMA foreign_keys = ON")
  return {
    exec(sql: string) {
      db.exec(sql)
    },
    prepare(sql: string): SqlStatement {
      const statement = db.prepare(sql)
      return {
        run(...params: SqlValue[]) {
          statement.run(...params)
        },
        get(...params: SqlValue[]) {
          return statement.get(...params) as Record<string, SqlValue> | undefined
        },
        all(...params: SqlValue[]) {
          return statement.all(...params) as Record<string, SqlValue>[]
        },
      }
    },
    close() {
      db.close()
    },
  }
}
