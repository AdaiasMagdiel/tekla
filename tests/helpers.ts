import { createDb } from "../src/db.js";
import { createUser } from "../src/users.js";
import type Database from "better-sqlite3";

export function testDb(): Database.Database {
  return createDb(":memory:");
}

export function seedText(db: Database.Database, content: string, lang = "pt"): number {
  const info = db.prepare("INSERT INTO texts (content, lang) VALUES (?, ?)").run(content, lang);
  return Number(info.lastInsertRowid);
}

export function testUser(db: Database.Database, username = "tester", displayName = "Tester") {
  return createUser(db, username, displayName);
}
