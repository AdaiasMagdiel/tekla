import path from "path";
import { createSqliteAdapter } from "./db/sqlite.js";
import { createMysqlAdapter } from "./db/mysql.js";
import { runMigrationsUp } from "./db/migrator.js";
import { migrations } from "../migrations/index.js";
import type { DbAdapter } from "./db/types.js";

export type { DbAdapter, Driver } from "./db/types.js";
export { migrations } from "../migrations/index.js";

// A path, not a connection — resolving this has no side effects, so
// importing this module (e.g. just for createDb in tests) never touches
// disk. Callers decide when/whether to actually open a database.
//
// Resolved from process.cwd() rather than this file's own location: the app
// is always launched from the project root (npm scripts, Docker's WORKDIR),
// so this stays correct whether db.ts runs as source (tsx) or as compiled
// output nested under dist/, which sits at a different depth than src/.
export function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "tekla.sqlite");
}

// The database engine is chosen via DB_DRIVER ("sqlite", the default, or
// "mysql"), not a code change — see CONTRIBUTING.md. `overridePath` exists
// purely for the SQLite dev/test convenience of connectDb(":memory:"); it's
// ignored under DB_DRIVER=mysql, which is always configured via
// DATABASE_URL.
export function connectDb(overridePath?: string): DbAdapter {
  const driver = process.env.DB_DRIVER === "mysql" ? "mysql" : "sqlite";

  if (driver === "mysql") {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required when DB_DRIVER=mysql");
    return createMysqlAdapter(url);
  }

  const dbPath = overridePath ?? process.env.DATABASE_PATH ?? defaultDbPath();
  return createSqliteAdapter(dbPath);
}

// Connects and brings the schema up to date — what the app itself always
// wants. Schema setup (previously an inline CREATE TABLE block plus an
// ad-hoc ALTER TABLE for one column) is now just "run pending migrations" —
// see migrations/ and src/db/migrator.ts. scripts/migrate.ts uses
// connectDb() directly instead, since it decides for itself whether to run
// migrations up, down, or not at all.
export async function createDb(overridePath?: string): Promise<DbAdapter> {
  const db = connectDb(overridePath);
  await runMigrationsUp(db, migrations);
  return db;
}
