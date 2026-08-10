import { describe, it, expect } from "vitest";
import { createUser, getUserById, getUserByUsername, isValidUsername } from "../src/users.js";
import { testDb } from "./helpers.js";

describe("isValidUsername", () => {
  it("accepts letters, numbers, underscore and dot, 3-16 chars", () => {
    expect(isValidUsername("abc")).toBe(true);
    expect(isValidUsername("adaias_m")).toBe(true);
    expect(isValidUsername("beremiz.samir")).toBe(true);
    expect(isValidUsername("A1_2345678901234")).toBe(true); // 16 chars
  });

  it("rejects too short or too long usernames", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("a".repeat(17))).toBe(false);
  });

  it("rejects special characters and spaces", () => {
    expect(isValidUsername("bad name")).toBe(false);
    expect(isValidUsername("bad-name")).toBe(false);
    expect(isValidUsername("café")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidUsername(undefined)).toBe(false);
    expect(isValidUsername(null)).toBe(false);
    expect(isValidUsername(123)).toBe(false);
  });
});

describe("user persistence", () => {
  it("creates a user and reads it back by id and by username", async () => {
    const db = await testDb();
    const created = await createUser(db, "adaias_m", "Adaías");

    expect(created.username).toBe("adaias_m");
    expect(created.display_name).toBe("Adaías");
    expect(created.id).toBeTruthy();

    expect(await getUserById(db, created.id)).toEqual(created);
    expect(await getUserByUsername(db, "adaias_m")).toEqual(created);
  });

  it("returns undefined for unknown users", async () => {
    const db = await testDb();
    expect(await getUserById(db, "does-not-exist")).toBeUndefined();
    expect(await getUserByUsername(db, "does-not-exist")).toBeUndefined();
  });

  it("enforces unique usernames at the database level", async () => {
    const db = await testDb();
    await createUser(db, "duplicate", "First");
    await expect(createUser(db, "duplicate", "Second")).rejects.toThrow();
  });
});
