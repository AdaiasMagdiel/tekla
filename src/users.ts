import { nanoid } from "nanoid";
import type { DbAdapter } from "./db.js";
import type { UserRow } from "./types.js";

export async function createUser(
  db: DbAdapter,
  username: string,
  displayName: string,
  passwordHash: string
): Promise<UserRow> {
  const id = nanoid(12);
  const now = Date.now();
  await db.run(
    "INSERT INTO users (id, username, display_name, created_at, password_hash) VALUES (?, ?, ?, ?, ?)",
    [id, username, displayName, now, passwordHash]
  );
  return { id, username, display_name: displayName, created_at: now, character_id: null, password_hash: passwordHash };
}

export async function getUserByUsername(db: DbAdapter, username: string): Promise<UserRow | undefined> {
  return db.get<UserRow>("SELECT * FROM users WHERE username = ?", [username]);
}

export async function getUserById(db: DbAdapter, id: string): Promise<UserRow | undefined> {
  return db.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,16}$/;

export function isValidUsername(username: unknown): username is string {
  return typeof username === "string" && USERNAME_RE.test(username);
}
