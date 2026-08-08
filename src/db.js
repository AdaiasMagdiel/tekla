import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "data", "typegp.sqlite");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS texts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'pt'
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  host_user_id TEXT NOT NULL REFERENCES users(id),
  text_id INTEGER REFERENCES texts(id),
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | countdown | racing | finished
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS race_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  wpm REAL NOT NULL,
  accuracy REAL NOT NULL,
  position INTEGER NOT NULL,
  time_ms INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_results_user ON race_results(user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
`);
