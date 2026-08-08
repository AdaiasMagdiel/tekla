import { nanoid } from "nanoid";

export function createUser(db, username, displayName) {
  const id = nanoid(12);
  const now = Date.now();
  db.prepare(
    "INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, username, displayName, now);
  return { id, username, display_name: displayName };
}

export function getUserByUsername(db, username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

export function getUserById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

export function isValidUsername(username) {
  return typeof username === "string" && USERNAME_RE.test(username);
}
