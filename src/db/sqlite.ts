import Database from "better-sqlite3";
import type { DbAdapter, RunResult } from "./types.js";

// All methods here are declared `async` for interface uniformity with the
// MySQL adapter, but do real synchronous work under the hood (better-sqlite3
// has no async API) — the `await` a caller does just yields one microtask
// tick, no actual I/O wait, so performance is unchanged from before.
export function createSqliteAdapter(path: string): DbAdapter {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  const adapter: DbAdapter = {
    driver: "sqlite",

    async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      return raw.prepare(sql).get(...params) as T | undefined;
    },

    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...params) as T[];
    },

    async run(sql: string, params: unknown[] = []): Promise<RunResult> {
      const info = raw.prepare(sql).run(...params);
      return { lastInsertRowid: Number(info.lastInsertRowid), changes: info.changes };
    },

    async exec(sql: string): Promise<void> {
      raw.exec(sql);
    },

    // Deliberately not better-sqlite3's own `db.transaction(fn)` — that
    // wrapper requires `fn` to be fully synchronous and commits as soon as
    // it returns, which for an `async fn` would be right after the first
    // `await` suspends it (before the real work inside has run). Plain
    // BEGIN/COMMIT/ROLLACK statements don't have that assumption.
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      raw.exec("BEGIN");
      try {
        const result = await fn(adapter);
        raw.exec("COMMIT");
        return result;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },

    async close(): Promise<void> {
      raw.close();
    },
  };

  return adapter;
}
