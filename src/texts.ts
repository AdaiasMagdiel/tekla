import type Database from "better-sqlite3";
import type { RaceText } from "./types.js";

// Picks a random race text, preferring the given language when texts for it
// exist; falls back to any language otherwise so a room can always start.
export function pickRandomText(db: Database.Database, lang?: string | null): RaceText | undefined {
  if (lang) {
    const row = db
      .prepare("SELECT id, content FROM texts WHERE lang = ? ORDER BY RANDOM() LIMIT 1")
      .get(lang) as RaceText | undefined;
    if (row) return row;
  }
  return db.prepare("SELECT id, content FROM texts ORDER BY RANDOM() LIMIT 1").get() as
    | RaceText
    | undefined;
}
