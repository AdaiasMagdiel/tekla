import { describe, it, expect } from "vitest";
import { createDb } from "../src/db.js";

describe("createDb", () => {
  it("creates all expected tables", () => {
    const db = createDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toEqual(expect.arrayContaining(["users", "texts", "rooms", "race_results"]));
  });

  it("is idempotent — creating the same db path twice doesn't error", () => {
    expect(() => {
      createDb(":memory:");
      createDb(":memory:");
    }).not.toThrow();
  });
});
