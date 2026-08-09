// Picks a random race text, preferring the given language when texts for it
// exist; falls back to any language otherwise so a room can always start.
export function pickRandomText(db, lang) {
  if (lang) {
    const row = db
      .prepare("SELECT id, content FROM texts WHERE lang = ? ORDER BY RANDOM() LIMIT 1")
      .get(lang);
    if (row) return row;
  }
  return db.prepare("SELECT id, content FROM texts ORDER BY RANDOM() LIMIT 1").get();
}
