import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  isValidPassword,
  createSession,
  deleteSession,
  resolveSessionUserFromCookieHeader,
} from "../src/auth.js";
import { testDb, testUser } from "./helpers.js";

describe("password hashing", () => {
  it("verifies a matching password and rejects a wrong one", () => {
    const stored = hashPassword("correct-horse");
    expect(verifyPassword("correct-horse", stored)).toBe(true);
    expect(verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("salts each hash differently even for the same password", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });
});

describe("isValidPassword", () => {
  it("requires at least 8 characters", () => {
    expect(isValidPassword("short")).toBe(false);
    expect(isValidPassword("longenough")).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(isValidPassword(undefined)).toBe(false);
    expect(isValidPassword(12345678)).toBe(false);
  });
});

describe("sessions", () => {
  it("resolves the owning user from a session cookie", async () => {
    const db = await testDb();
    const user = await testUser(db, "sessuser", "Sess User");
    const token = await createSession(db, user.id);

    const resolved = await resolveSessionUserFromCookieHeader(db, `tekla_session=${token}`);
    expect(resolved?.id).toBe(user.id);
  });

  it("resolves nothing for a missing or deleted session", async () => {
    const db = await testDb();
    const user = await testUser(db, "sessuser2", "Sess User 2");
    const token = await createSession(db, user.id);

    expect(await resolveSessionUserFromCookieHeader(db, undefined)).toBeUndefined();

    await deleteSession(db, token);
    expect(await resolveSessionUserFromCookieHeader(db, `tekla_session=${token}`)).toBeUndefined();
  });
});
