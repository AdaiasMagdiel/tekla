import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import type { UserRow } from "./types.js";

export function createUser(db: Database.Database, username: string, displayName: string): UserRow {
  const id = nanoid(12);
  const now = Date.now();
  db.prepare(
    "INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, username, displayName, now);
  return { id, username, display_name: displayName, created_at: now };
}

export function getUserByUsername(db: Database.Database, username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function getUserById(db: Database.Database, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,16}$/;

export function isValidUsername(username: unknown): username is string {
  return typeof username === "string" && USERNAME_RE.test(username);
}
