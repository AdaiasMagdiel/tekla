#!/usr/bin/env node
// Small migration CLI — no external migration library, just enough to keep
// schema changes organized: create a migration file, apply pending ones,
// revert the last one, or reset everything.
//
// Usage:
//   npm run migrate -- create <name>
//   npm run migrate -- up
//   npm run migrate -- down [--steps N]
//   npm run migrate -- drop-all [--yes]

import { readdirSync, writeFileSync } from "fs";
import path from "path";
import { connectDb, migrations } from "../src/db.js";
import { runMigrationsUp, runMigrationsDown, dropAll } from "../src/db/migrator.js";

const HELP = `
Manage database migrations.

Usage:
  npm run migrate -- create <name>   Scaffold a new migration file
  npm run migrate -- up               Apply all pending migrations
  npm run migrate -- down [--steps N] Revert the last N applied migrations (default 1)
  npm run migrate -- drop-all [--yes] Revert every applied migration and reset tracking

Connects using the same env vars as the app: DB_DRIVER (sqlite|mysql),
DATABASE_URL (mysql), DATABASE_PATH (sqlite).

'drop-all' is destructive and requires --yes outside of NODE_ENV=test.
`;

const migrationsDir = path.join(process.cwd(), "migrations");

function nextId(name: string): string {
  const existing = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.ts$/.test(f));
  const nextNum = existing.length + 1;
  const num = String(nextNum).padStart(4, "0");
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${num}_${slug}`;
}

function scaffold(id: string): string {
  return `import type { Migration } from "../src/db/types.js";

const migration: Migration = {
  id: "${id}",

  async up(db) {
    if (db.driver === "sqlite") {
      await db.exec(\`
        -- SQLite DDL here
      \`);
      return;
    }
    await db.exec(\`
      -- MySQL DDL here
    \`);
  },

  async down(db) {
    await db.exec(\`
      -- Undo the up() above (works the same on both engines here, or branch
      -- on db.driver same as up() if it needs to differ)
    \`);
  },
};

export default migration;
`;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "-h" || command === "--help") {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  if (command === "create") {
    const name = rest.find((a) => !a.startsWith("--"));
    if (!name) {
      console.error("Usage: npm run migrate -- create <name>");
      process.exit(1);
    }
    const id = nextId(name);
    const file = path.join(migrationsDir, `${id}.ts`);
    writeFileSync(file, scaffold(id));
    console.log(`Created migrations/${id}.ts`);
    console.log(`Don't forget to register it in migrations/index.ts.`);
    return;
  }

  const db = connectDb();
  try {
    if (command === "up") {
      const ran = await runMigrationsUp(db, migrations);
      console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Already up to date.");
      return;
    }

    if (command === "down") {
      const stepsFlagIndex = rest.indexOf("--steps");
      const steps = stepsFlagIndex !== -1 ? Number(rest[stepsFlagIndex + 1]) || 1 : 1;
      const reverted = await runMigrationsDown(db, migrations, steps);
      console.log(reverted.length ? `Reverted: ${reverted.join(", ")}` : "Nothing to revert.");
      return;
    }

    if (command === "drop-all") {
      if (process.env.NODE_ENV !== "test" && !rest.includes("--yes")) {
        console.error("This drops every table. Re-run with --yes to confirm.");
        process.exit(1);
      }
      const reverted = await dropAll(db, migrations);
      console.log(reverted.length ? `Dropped: ${reverted.join(", ")}` : "Nothing to drop.");
      return;
    }

    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
