import type { DbAdapter } from "./db.js";
import type { RaceText } from "./types.js";

// Picks a random race text, preferring the given language when texts for it
// exist; falls back to any language otherwise so a room can always start.
export async function pickRandomText(db: DbAdapter, lang?: string | null): Promise<RaceText | undefined> {
  const randomFn = db.driver === "sqlite" ? "RANDOM()" : "RAND()";

  if (lang) {
    const row = await db.get<RaceText>(
      `SELECT id, content FROM texts WHERE lang = ? ORDER BY ${randomFn} LIMIT 1`,
      [lang]
    );
    if (row) return row;
  }
  return db.get<RaceText>(`SELECT id, content FROM texts ORDER BY ${randomFn} LIMIT 1`);
}
