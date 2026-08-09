import { describe, it, expect } from "vitest";
import { pickRandomText } from "../src/texts.js";
import { testDb, seedText } from "./helpers.js";

describe("pickRandomText", () => {
  it("returns undefined when the table is empty", () => {
    const db = testDb();
    expect(pickRandomText(db)).toBeUndefined();
    expect(pickRandomText(db, "pt")).toBeUndefined();
  });

  it("picks a text from the requested language when available", () => {
    const db = testDb();
    seedText(db, "Texto em português.", "pt");
    seedText(db, "English text.", "en");

    for (let i = 0; i < 10; i++) {
      const row = pickRandomText(db, "en");
      expect(row?.content).toBe("English text.");
    }
  });

  it("falls back to any language when the requested one has no texts", () => {
    const db = testDb();
    seedText(db, "Texto em português.", "pt");

    const row = pickRandomText(db, "es");
    expect(row?.content).toBe("Texto em português.");
  });

  it("picks any text when no language is given", () => {
    const db = testDb();
    seedText(db, "Only text.", "pt");

    const row = pickRandomText(db);
    expect(row?.content).toBe("Only text.");
  });
});
