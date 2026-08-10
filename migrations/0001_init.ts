import type { Migration } from "../src/db/types.js";

// Consolidates the whole schema as it stood right before migrations
// existed (including `users.character_id`, previously bolted on via an
// ad-hoc ALTER TABLE in db.ts) into a single migration. No real users yet,
// so there's no value in replaying that history step by step — this is
// simply "the schema", not "the first of many incremental changes".
const migration: Migration = {
  id: "0001_init",

  async up(db) {
    if (db.driver === "sqlite") {
      await db.exec(`
        CREATE TABLE characters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          image_path TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE texts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          lang TEXT NOT NULL DEFAULT 'pt'
        );

        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL
        );

        CREATE TABLE rooms (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          host_user_id TEXT NOT NULL REFERENCES users(id),
          text_id INTEGER REFERENCES texts(id),
          status TEXT NOT NULL DEFAULT 'waiting',
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER
        );

        CREATE TABLE race_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL REFERENCES rooms(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          wpm REAL NOT NULL,
          accuracy REAL NOT NULL,
          position INTEGER NOT NULL,
          time_ms INTEGER NOT NULL,
          finished_at INTEGER NOT NULL
        );

        CREATE INDEX idx_results_user ON race_results(user_id);
        CREATE INDEX idx_rooms_code ON rooms(code);
      `);
      return;
    }

    // MySQL: TEXT/id columns used in a PK, UNIQUE, or FK need a bounded
    // VARCHAR (MySQL can't index unbounded TEXT the way SQLite can);
    // AUTOINCREMENT -> AUTO_INCREMENT; INTEGER timestamps -> BIGINT.
    await db.exec(`
      CREATE TABLE characters (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        image_path VARCHAR(255) NOT NULL,
        created_at BIGINT NOT NULL
      ) ENGINE=InnoDB;

      CREATE TABLE texts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        content TEXT NOT NULL,
        lang VARCHAR(8) NOT NULL DEFAULT 'pt'
      ) ENGINE=InnoDB;

      CREATE TABLE users (
        id VARCHAR(32) PRIMARY KEY,
        username VARCHAR(16) NOT NULL UNIQUE,
        display_name VARCHAR(40) NOT NULL,
        created_at BIGINT NOT NULL,
        character_id INT NULL,
        FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
      ) ENGINE=InnoDB;

      CREATE TABLE rooms (
        id VARCHAR(8) PRIMARY KEY,
        code VARCHAR(8) NOT NULL UNIQUE,
        host_user_id VARCHAR(32) NOT NULL,
        text_id INT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'waiting',
        created_at BIGINT NOT NULL,
        started_at BIGINT NULL,
        finished_at BIGINT NULL,
        FOREIGN KEY (host_user_id) REFERENCES users(id),
        FOREIGN KEY (text_id) REFERENCES texts(id)
      ) ENGINE=InnoDB;

      CREATE TABLE race_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(8) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        wpm DOUBLE NOT NULL,
        accuracy DOUBLE NOT NULL,
        position INT NOT NULL,
        time_ms INT NOT NULL,
        finished_at BIGINT NOT NULL,
        FOREIGN KEY (room_id) REFERENCES rooms(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB;

      CREATE INDEX idx_results_user ON race_results(user_id);
      CREATE INDEX idx_rooms_code ON rooms(code);
    `);
  },

  async down(db) {
    // Reverse dependency order regardless of engine.
    await db.exec(`
      DROP TABLE IF EXISTS race_results;
      DROP TABLE IF EXISTS rooms;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS texts;
      DROP TABLE IF EXISTS characters;
    `);
  },
};

export default migration;
