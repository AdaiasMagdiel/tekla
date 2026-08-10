import type { Migration } from "../src/db/types.js";
import init from "./0001_init.js";
import addTextDifficulty from "./0002_add_text_difficulty.js";

// Ordered, explicit registry — no directory scanning magic. Append new
// migrations here in the order they should run (scripts/migrate.ts create
// reminds you to do this).
export const migrations: Migration[] = [init, addTextDifficulty];
