import type { DbAdapter } from "./db.js";
import type { Difficulty, RaceText } from "./types.js";

// Picks a random race text. Prefers an exact lang+difficulty match, then
// falls back to lang alone, then difficulty alone, then any text — so a
// room can always start even if the two filters together are too narrow.
export async function pickRandomText(
  db: DbAdapter,
  lang?: string | null,
  difficulty?: Difficulty | null
): Promise<RaceText | undefined> {
  const randomFn = db.driver === "sqlite" ? "RANDOM()" : "RAND()";

  if (lang && difficulty) {
    const row = await db.get<RaceText>(
      `SELECT id, content FROM texts WHERE lang = ? AND difficulty = ? ORDER BY ${randomFn} LIMIT 1`,
      [lang, difficulty]
    );
    if (row) return row;
  }
  if (lang) {
    const row = await db.get<RaceText>(
      `SELECT id, content FROM texts WHERE lang = ? ORDER BY ${randomFn} LIMIT 1`,
      [lang]
    );
    if (row) return row;
  }
  if (difficulty) {
    const row = await db.get<RaceText>(
      `SELECT id, content FROM texts WHERE difficulty = ? ORDER BY ${randomFn} LIMIT 1`,
      [difficulty]
    );
    if (row) return row;
  }
  return db.get<RaceText>(`SELECT id, content FROM texts ORDER BY ${randomFn} LIMIT 1`);
}
