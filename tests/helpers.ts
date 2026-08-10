import { createDb } from "../src/db.js";
import { createUser } from "../src/users.js";
import { hashPassword } from "../src/auth.js";
import type { DbAdapter } from "../src/db.js";
import type { UserRow } from "../src/types.js";

// Reverse dependency order, so a plain TRUNCATE (no FK-check juggling needed
// beyond this ordering) never hits a "row is referenced" error.
const TABLES = ["race_results", "rooms", "users", "texts", "characters"];

// SQLite gets a fresh ":memory:" database per call — cheap and fully
// isolated, same as before migrations existed. MySQL has no equivalent, so
// instead we connect once (migrations run once) and TRUNCATE everything
// before each call, which gives the same "clean slate" guarantee without
// reconnecting/re-migrating per test.
let mysqlDb: Promise<DbAdapter> | null = null;

export async function testDb(): Promise<DbAdapter> {
  if (process.env.DB_DRIVER === "mysql") {
    if (!mysqlDb) mysqlDb = createDb();
    const db = await mysqlDb;
    await db.exec("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) {
      await db.exec(`TRUNCATE TABLE ${table}`);
    }
    await db.exec("SET FOREIGN_KEY_CHECKS = 1");
    return db;
  }
  return createDb(":memory:");
}

export async function seedText(
  db: DbAdapter,
  content: string,
  lang = "pt",
  difficulty = "medium"
): Promise<number> {
  const info = await db.run("INSERT INTO texts (content, lang, difficulty) VALUES (?, ?, ?)", [
    content,
    lang,
    difficulty,
  ]);
  return info.lastInsertRowid;
}

export async function testUser(
  db: DbAdapter,
  username = "tester",
  displayName = "Tester",
  password = "testpassword"
): Promise<UserRow> {
  return createUser(db, username, displayName, hashPassword(password));
}
