import type { Migration } from "../src/db/types.js";

// Existing rows get 'medium' via DEFAULT, same value new inserts fall back to
// when a caller doesn't specify one — keeps old integrations (seed files,
// the external texts API) working unchanged.
const migration: Migration = {
  id: "0002_add_text_difficulty",

  async up(db) {
    if (db.driver === "sqlite") {
      await db.exec(`ALTER TABLE texts ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'medium';`);
      return;
    }
    await db.exec(`ALTER TABLE texts ADD COLUMN difficulty VARCHAR(8) NOT NULL DEFAULT 'medium';`);
  },

  async down(db) {
    await db.exec(`ALTER TABLE texts DROP COLUMN difficulty;`);
  },
};

export default migration;
