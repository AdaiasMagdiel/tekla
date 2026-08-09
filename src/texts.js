export function pickRandomText(db) {
  return db.prepare("SELECT id, content FROM texts ORDER BY RANDOM() LIMIT 1").get();
}
