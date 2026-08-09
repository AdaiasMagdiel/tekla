#!/usr/bin/env node
// Populates the `texts` table used to pick race paragraphs.
//
// Usage:
//   npm run seed -- <path...> [options]
//   tsx scripts/seed-texts.ts <path...> [options]
//
// Each <path> can be a .json file, a .txt file, or a directory containing
// either. Run with --help for the full format/options reference.

import { createDb, defaultDbPath } from "../src/db.js";
import { collectSeedFiles, parseSeedFile, importSeedRows, type SeedRow } from "../src/seedTexts.js";

const HELP = `
Seed race texts into the database.

Usage:
  npm run seed -- <path...> [options]

Arguments:
  <path>          One or more .json/.txt files, or directories containing them.

Options:
  --lang <code>   Force this language code for every text imported in this run
                  (otherwise inferred from each file's name, e.g. "pt.json" -> "pt").
  --clear         Delete all existing texts before importing the new ones.
  --dry-run       Show what would be imported without touching the database.
  -h, --help      Show this help.

File formats:
  .json   An array of strings, e.g. ["Text one.", "Text two."]
          or an array of objects, e.g. [{ "content": "Text one.", "lang": "en" }]
  .txt    One race text per line. Blank lines are ignored.

Examples:
  npm run seed -- seeds/                 # import every file in seeds/
  npm run seed -- seeds/pt.json --clear  # wipe existing texts, load PT only
  npm run seed -- my-texts.txt --lang es # force language "es"
`;

interface ParsedOptions {
  paths: string[];
  lang: string | null;
  clear: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedOptions {
  const opts: ParsedOptions = { paths: [], lang: null, clear: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--clear") opts.clear = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--lang") opts.lang = argv[++i] ?? null;
    else if (arg !== undefined) opts.paths.push(arg);
  }
  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || opts.paths.length === 0) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const files = collectSeedFiles(opts.paths);
  if (files.length === 0) {
    console.error("No .json or .txt files found at the given path(s).");
    process.exit(1);
  }

  const texts: SeedRow[] = [];
  for (const file of files) {
    try {
      const parsed = parseSeedFile(file, opts.lang).filter((t) => t.content && t.content.trim());
      texts.push(...parsed);
      console.log(`Read ${parsed.length} text(s) from ${file}`);
    } catch (err) {
      console.error(`Failed to parse ${file}: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const byLang = texts.reduce<Record<string, number>>((acc, t) => {
    acc[t.lang] = (acc[t.lang] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byLang)
    .map(([lang, n]) => `${lang}: ${n}`)
    .join(", ");

  if (opts.dryRun) {
    console.log(`\n[dry run] Would import ${texts.length} text(s) (${summary}).`);
    if (opts.clear) console.log("[dry run] Would also delete all existing texts first.");
    return;
  }

  const db = createDb(process.env.DATABASE_PATH || defaultDbPath());
  const result = importSeedRows(db, texts, { clear: opts.clear });
  if (opts.clear) console.log("Cleared existing texts.");
  console.log(`\nImported ${result.imported} text(s) (${summary}). Total texts in database: ${result.total}.`);
}

main();
