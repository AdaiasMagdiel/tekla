import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { migrations } from "../src/db.js";
import { createSqliteAdapter } from "../src/db/sqlite.js";
import { runMigrationsUp, runMigrationsDown, dropAll } from "../src/db/migrator.js";

// These tests exercise the migrator's own mechanics (idempotency, down,
// drop-all), which is engine-agnostic logic living in src/db/migrator.ts —
// always against a real SQLite adapter directly (not connectDb()/createDb(),
// which honor DB_DRIVER) so they stay fast and isolated even when the rest
// of the suite is pointed at a shared MySQL database via DB_DRIVER=mysql;
// per-engine SQL correctness is what the other test files already cover by
// going through testDb().

function tmpSqlitePath(): string {
  return path.join(os.tmpdir(), `tekla-test-${Date.now()}-${Math.random()}.sqlite`);
}

function cleanupSqlite(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      // ignore missing sidecar files
    }
  }
}

describe("createDb", () => {
  it("creates all expected tables", async () => {
    const db = createSqliteAdapter(":memory:");
    await runMigrationsUp(db, migrations);
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(
      (r) => r.name
    );

    expect(tables).toEqual(expect.arrayContaining(["users", "texts", "rooms", "race_results", "characters"]));
  });

  it("is idempotent — creating the same db path twice doesn't error", async () => {
    const dbPath = tmpSqlitePath();
    try {
      await runMigrationsUp(createSqliteAdapter(dbPath), migrations);
      await expect(runMigrationsUp(createSqliteAdapter(dbPath), migrations)).resolves.toBeDefined();
    } finally {
      cleanupSqlite(dbPath);
    }
  });

  it("gives users a character_id column referencing characters", async () => {
    const db = createSqliteAdapter(":memory:");
    await runMigrationsUp(db, migrations);
    const cols = await db.all<{ name: string }>("PRAGMA table_info(users)");
    expect(cols.some((c) => c.name === "character_id")).toBe(true);
  });
});

describe("migrations", () => {
  it("runMigrationsUp is a no-op the second time it's called", async () => {
    const db = createSqliteAdapter(":memory:");
    const first = await runMigrationsUp(db, migrations);
    const second = await runMigrationsUp(db, migrations);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });

  it("runMigrationsDown reverts the schema — tables are gone afterward", async () => {
    const db = createSqliteAdapter(":memory:");
    await runMigrationsUp(db, migrations);
    await db.run("INSERT INTO texts (content, lang) VALUES (?, ?)", ["hello", "en"]);

    const reverted = await runMigrationsDown(db, migrations, migrations.length);
    expect(reverted.length).toBe(migrations.length);

    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
      (r) => r.name
    );
    expect(tables).not.toEqual(expect.arrayContaining(["texts"]));
  });

  it("dropAll reverts everything and removes the tracking table, ready for a fresh up()", async () => {
    const db = createSqliteAdapter(":memory:");
    await runMigrationsUp(db, migrations);

    await dropAll(db, migrations);
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
      (r) => r.name
    );
    expect(tables).not.toEqual(expect.arrayContaining(["_migrations", "texts", "users"]));

    const ran = await runMigrationsUp(db, migrations);
    expect(ran.length).toBe(migrations.length);
  });
});
