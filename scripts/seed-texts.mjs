#!/usr/bin/env node
// Populates the `texts` table used to pick race paragraphs.
//
// Usage:
//   node scripts/seed-texts.mjs <path...> [options]
//
// Each <path> can be a .json file, a .txt file, or a directory containing
// either. Run with --help for the full format/options reference.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename, extname, resolve } from "path";
import { db } from "../src/db.js";

const HELP = `
Seed race texts into the database.

Usage:
  node scripts/seed-texts.mjs <path...> [options]
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
  node scripts/seed-texts.mjs seeds/                 # import every file in seeds/
  node scripts/seed-texts.mjs seeds/pt.json --clear  # wipe existing texts, load PT only
  node scripts/seed-texts.mjs my-texts.txt --lang es # force language "es"
`;

function parseArgs(argv) {
  const opts = { paths: [], lang: null, clear: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--clear") opts.clear = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--lang") opts.lang = argv[++i];
    else opts.paths.push(arg);
  }
  return opts;
}

function collectFiles(paths) {
  const files = [];
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

function inferLang(filePath) {
  return basename(filePath, extname(filePath)).toLowerCase();
}

function parseFile(filePath, forcedLang) {
  const ext = extname(filePath);
  const raw = readFileSync(filePath, "utf-8");
  const fallbackLang = forcedLang || inferLang(filePath);

  if (ext === ".json") {
    const data = JSON.parse(raw);
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

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || opts.paths.length === 0) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const files = collectFiles(opts.paths);
  if (files.length === 0) {
    console.error("No .json or .txt files found at the given path(s).");
    process.exit(1);
  }

  const texts = [];
  for (const file of files) {
    try {
      const parsed = parseFile(file, opts.lang).filter((t) => t.content && t.content.trim());
      texts.push(...parsed);
      console.log(`Read ${parsed.length} text(s) from ${file}`);
    } catch (err) {
      console.error(`Failed to parse ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  const byLang = texts.reduce((acc, t) => {
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

  if (opts.clear) {
    db.pragma("foreign_keys = OFF");
    db.exec("DELETE FROM texts");
    db.exec("DELETE FROM sqlite_sequence WHERE name = 'texts'");
    db.pragma("foreign_keys = ON");
    console.log("Cleared existing texts.");
  }

  const insert = db.prepare("INSERT INTO texts (content, lang) VALUES (?, ?)");
  const insertAll = db.transaction((rows) => {
    for (const row of rows) insert.run(row.content, row.lang);
  });
  insertAll(texts);

  const total = db.prepare("SELECT COUNT(*) as c FROM texts").get().c;
  console.log(`\nImported ${texts.length} text(s) (${summary}). Total texts in database: ${total}.`);
}

main();
