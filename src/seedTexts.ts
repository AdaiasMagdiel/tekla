import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename, extname, resolve } from "path";
import type { DbAdapter } from "./db.js";

export interface SeedRow {
  content: string;
  lang: string;
}

export interface ImportResult {
  imported: number;
  total: number;
  byLang: Record<string, number>;
}

// Expands a mix of files and directories into a flat list of .json/.txt
// files. Shared by the CLI (`npm run seed`) and the server's optional
// auto-seed-on-empty-database startup step.
export function collectSeedFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    const full = resolve(p);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) {
      console.error(`Skipping "${p}": not found.`);
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(full)) {
        if (entry.endsWith(".json") || entry.endsWith(".txt")) {
          files.push(join(full, entry));
        }
      }
    } else {
      files.push(full);
    }
  }
  return files;
}

function inferLang(filePath: string): string {
  return basename(filePath, extname(filePath)).toLowerCase();
}

export function parseSeedFile(filePath: string, forcedLang: string | null): SeedRow[] {
  const ext = extname(filePath);
  const raw = readFileSync(filePath, "utf-8");
  const fallbackLang = forcedLang || inferLang(filePath);

  if (ext === ".json") {
    const data = JSON.parse(raw) as Array<string | { content: string; lang?: string }>;
    return data.map((item) =>
      typeof item === "string"
        ? { content: item, lang: fallbackLang }
        : { content: item.content, lang: forcedLang || item.lang || fallbackLang }
    );
  }

  if (ext === ".txt") {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((content) => ({ content, lang: fallbackLang }));
  }

  throw new Error(`Unsupported file type: ${filePath}`);
}

// Inserts rows into the `texts` table (optionally clearing it first) and
// returns a summary. Does not pick which files to read — call
// collectSeedFiles/parseSeedFile first, or just build rows directly.
export async function importSeedRows(
  db: DbAdapter,
  rows: SeedRow[],
  opts: { clear?: boolean } = {}
): Promise<ImportResult> {
  if (opts.clear) {
    if (db.driver === "sqlite") {
      await db.exec("PRAGMA foreign_keys = OFF");
      await db.exec("DELETE FROM texts");
      await db.exec("DELETE FROM sqlite_sequence WHERE name = 'texts'");
      await db.exec("PRAGMA foreign_keys = ON");
    } else {
      await db.exec("SET FOREIGN_KEY_CHECKS = 0");
      await db.exec("TRUNCATE TABLE texts"); // also resets AUTO_INCREMENT
      await db.exec("SET FOREIGN_KEY_CHECKS = 1");
    }
  }

  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.run("INSERT INTO texts (content, lang) VALUES (?, ?)", [row.content, row.lang]);
    }
  });

  const byLang = rows.reduce<Record<string, number>>((acc, t) => {
    acc[t.lang] = (acc[t.lang] || 0) + 1;
    return acc;
  }, {});
  const total = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM texts"))!.c;

  return { imported: rows.length, total, byLang };
}
