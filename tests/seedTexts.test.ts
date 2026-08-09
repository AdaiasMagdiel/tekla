import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { collectSeedFiles, parseSeedFile, importSeedRows } from "../src/seedTexts.js";
import { testDb, seedText } from "./helpers.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tekla-seed-test-"));
}

describe("collectSeedFiles", () => {
  it("expands a directory to its .json/.txt files only", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "pt.json"), "[]");
    writeFileSync(join(dir, "en.txt"), "");
    writeFileSync(join(dir, "notes.md"), "ignored");

    const files = collectSeedFiles([dir]).map((f) => f.split("/").pop());
    expect(files.sort()).toEqual(["en.txt", "pt.json"]);
  });

  it("passes through explicit file paths as-is", () => {
    const dir = tempDir();
    const file = join(dir, "custom.json");
    writeFileSync(file, "[]");

    expect(collectSeedFiles([file])).toEqual([file]);
  });

  it("skips paths that don't exist without throwing", () => {
    expect(collectSeedFiles(["/does/not/exist"])).toEqual([]);
  });
});

describe("parseSeedFile", () => {
  it("parses a JSON array of strings, inferring lang from the filename", () => {
    const dir = tempDir();
    const file = join(dir, "pt.json");
    writeFileSync(file, JSON.stringify(["A.", "B."]));

    expect(parseSeedFile(file, null)).toEqual([
      { content: "A.", lang: "pt" },
      { content: "B.", lang: "pt" },
    ]);
  });

  it("parses a JSON array of objects, letting per-item lang override the filename", () => {
    const dir = tempDir();
    const file = join(dir, "mixed.json");
    writeFileSync(file, JSON.stringify([{ content: "Hola.", lang: "es" }, { content: "No lang." }]));

    expect(parseSeedFile(file, null)).toEqual([
      { content: "Hola.", lang: "es" },
      { content: "No lang.", lang: "mixed" },
    ]);
  });

  it("lets a forced lang win over both the filename and a per-item lang", () => {
    const dir = tempDir();
    const file = join(dir, "es.json");
    writeFileSync(file, JSON.stringify([{ content: "Hola.", lang: "es" }]));

    expect(parseSeedFile(file, "fr")).toEqual([{ content: "Hola.", lang: "fr" }]);
  });

  it("parses .txt as one text per non-empty line", () => {
    const dir = tempDir();
    const file = join(dir, "en.txt");
    writeFileSync(file, "First line.\n\n  Second line.  \n");

    expect(parseSeedFile(file, null)).toEqual([
      { content: "First line.", lang: "en" },
      { content: "Second line.", lang: "en" },
    ]);
  });

  it("throws on an unsupported extension", () => {
    const dir = tempDir();
    const file = join(dir, "notes.md");
    writeFileSync(file, "hi");
    expect(() => parseSeedFile(file, null)).toThrow(/Unsupported file type/);
  });
});

describe("importSeedRows", () => {
  it("inserts rows and reports a per-language summary", () => {
    const db = testDb();
    const result = importSeedRows(db, [
      { content: "A.", lang: "pt" },
      { content: "B.", lang: "en" },
      { content: "C.", lang: "pt" },
    ]);

    expect(result).toEqual({ imported: 3, total: 3, byLang: { pt: 2, en: 1 } });
  });

  it("adds to existing texts by default", () => {
    const db = testDb();
    seedText(db, "Already here.", "pt");

    const result = importSeedRows(db, [{ content: "New.", lang: "en" }]);
    expect(result.total).toBe(2);
  });

  it("wipes existing texts first when clear is set", () => {
    const db = testDb();
    seedText(db, "Old.", "pt");

    const result = importSeedRows(db, [{ content: "New.", lang: "en" }], { clear: true });
    expect(result.total).toBe(1);
    expect(result.byLang).toEqual({ en: 1 });
  });
});
