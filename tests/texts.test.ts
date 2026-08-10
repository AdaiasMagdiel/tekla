import { describe, it, expect } from "vitest";
import { pickRandomText } from "../src/texts.js";
import { testDb, seedText } from "./helpers.js";

describe("pickRandomText", () => {
  it("returns undefined when the table is empty", async () => {
    const db = await testDb();
    expect(await pickRandomText(db)).toBeUndefined();
    expect(await pickRandomText(db, "pt")).toBeUndefined();
  });

  it("picks a text from the requested language when available", async () => {
    const db = await testDb();
    await seedText(db, "Texto em português.", "pt");
    await seedText(db, "English text.", "en");

    for (let i = 0; i < 10; i++) {
      const row = await pickRandomText(db, "en");
      expect(row?.content).toBe("English text.");
    }
  });

  it("falls back to any language when the requested one has no texts", async () => {
    const db = await testDb();
    await seedText(db, "Texto em português.", "pt");

    const row = await pickRandomText(db, "es");
    expect(row?.content).toBe("Texto em português.");
  });

  it("picks any text when no language is given", async () => {
    const db = await testDb();
    await seedText(db, "Only text.", "pt");

    const row = await pickRandomText(db);
    expect(row?.content).toBe("Only text.");
  });
});
