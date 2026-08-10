import type { Migration } from "../src/db/types.js";

// Adds password-based login. Empty-string default lets the ALTER run
// without a backfill value (the app has no real users yet — see the note on
// 0001_init); every account created after this migration always gets a real
// hash via users.ts, so an empty hash can never actually verify a login.
const migration: Migration = {
  id: "0003_add_auth",

  async up(db) {
    if (db.driver === "sqlite") {
      await db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';`);
      await db.exec(`
        CREATE TABLE sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE INDEX idx_sessions_user ON sessions(user_id);
      `);
      return;
    }

    await db.exec(`ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NOT NULL DEFAULT '';`);
    await db.exec(`
      CREATE TABLE sessions (
        token VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;

      CREATE INDEX idx_sessions_user ON sessions(user_id);
    `);
  },

  async down(db) {
    await db.exec(`DROP TABLE IF EXISTS sessions;`);
    await db.exec(`ALTER TABLE users DROP COLUMN password_hash;`);
  },
};

export default migration;
