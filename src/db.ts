import Database from "better-sqlite3";
import path from "path";

const SCHEMA = `
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
`;

// Exposed so tests (and anyone embedding the app) can spin up an isolated
// database — e.g. createDb(":memory:") — instead of always touching the
// real data/tekla.sqlite file.
export function createDb(dbPath: string): Database.Database {
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(SCHEMA);
  return database;
}

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
