import type { DbAdapter, Migration } from "./types.js";

// Bootstrap table, not a numbered migration itself — created directly here
// rather than via migrations/0001_init.ts so the migrator never depends on
// a migration having already run to know what's been applied.
async function ensureMigrationsTable(db: DbAdapter): Promise<void> {
  const ddl =
    db.driver === "sqlite"
      ? `CREATE TABLE IF NOT EXISTS _migrations (
           id TEXT PRIMARY KEY,
           applied_at INTEGER NOT NULL
         );`
      : `CREATE TABLE IF NOT EXISTS _migrations (
           id VARCHAR(255) PRIMARY KEY,
           applied_at BIGINT NOT NULL
         ) ENGINE=InnoDB;`;
  await db.exec(ddl);
}

async function getAppliedIds(db: DbAdapter): Promise<string[]> {
  const rows = await db.all<{ id: string }>("SELECT id FROM _migrations ORDER BY applied_at ASC, id ASC");
  return rows.map((r) => r.id);
}

// Applies every migration in `migrations` not yet recorded in _migrations,
// in array order. Called automatically by createDb() on every boot — safe
// to run repeatedly, a no-op once caught up.
//
// Deliberately NOT wrapped in db.transaction(): migrations are mostly DDL,
// and MySQL implicitly commits any open transaction the moment a DDL
// statement runs — the client (mysql2) has no way to know that happened, so
// a later explicit COMMIT/ROLLBACK on that same pooled connection can leave
// it in a stuck, inconsistent transaction state that then blocks unrelated
// queries reusing that connection later. Each statement just runs directly.
export async function runMigrationsUp(db: DbAdapter, migrations: Migration[]): Promise<string[]> {
  await ensureMigrationsTable(db);
  const applied = new Set(await getAppliedIds(db));
  const pending = migrations.filter((m) => !applied.has(m.id));

  const ran: string[] = [];
  for (const migration of pending) {
    await migration.up(db);
    await db.run("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", [migration.id, Date.now()]);
    ran.push(migration.id);
  }
  return ran;
}

// Reverts the last `steps` applied migrations (default 1), most recent
// first, using each migration's own down().
export async function runMigrationsDown(
  db: DbAdapter,
  migrations: Migration[],
  steps = 1
): Promise<string[]> {
  await ensureMigrationsTable(db);
  const applied = await getAppliedIds(db);
  const toRevert = applied
    .slice(-steps)
    .reverse()
    .map((id) => migrations.find((m) => m.id === id))
    .filter((m): m is Migration => Boolean(m));

  const reverted: string[] = [];
  for (const migration of toRevert) {
    await migration.down(db);
    await db.run("DELETE FROM _migrations WHERE id = ?", [migration.id]);
    reverted.push(migration.id);
  }
  return reverted;
}

// Reverts every applied migration (reusing their down(), so there's only
// one place that knows how to tear down each table) and finally drops the
// tracking table itself — a full reset, ready for runMigrationsUp() to
// start fresh.
export async function dropAll(db: DbAdapter, migrations: Migration[]): Promise<string[]> {
  await ensureMigrationsTable(db);
  const applied = await getAppliedIds(db);
  const reverted = await runMigrationsDown(db, migrations, applied.length);
  await db.exec("DROP TABLE IF EXISTS _migrations");
  return reverted;
}
