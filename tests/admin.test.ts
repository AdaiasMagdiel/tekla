import { describe, it, expect } from "vitest";
import type Database from "better-sqlite3";
import { testDb, seedText, testUser } from "./helpers.js";
import {
  getStats,
  listUsers,
  getUserDetail,
  updateUserDisplayName,
  deleteUser,
  listRoomHistory,
  listRankings,
  listResults,
  deleteResult,
  listTexts,
  createText,
  updateText,
  deleteText,
} from "../src/admin.js";

function fakeRoomManager(rooms: unknown[] = []) {
  return { listRooms: () => rooms } as any;
}

function seedRoom(
  db: Database.Database,
  id: string,
  code: string,
  hostUserId: string,
  textId: number | null = null
) {
  db.prepare(
    "INSERT INTO rooms (id, code, host_user_id, text_id, status, created_at) VALUES (?, ?, ?, ?, 'finished', ?)"
  ).run(id, code, hostUserId, textId, Date.now());
}

function seedResult(
  db: Database.Database,
  roomId: string,
  userId: string,
  opts: { wpm?: number; accuracy?: number; position?: number } = {}
) {
  db.prepare(
    "INSERT INTO race_results (room_id, user_id, wpm, accuracy, position, time_ms, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(roomId, userId, opts.wpm ?? 60, opts.accuracy ?? 95, opts.position ?? 1, 30000, Date.now());
}

describe("admin: stats", () => {
  it("aggregates counts and reflects live room manager state", () => {
    const db = testDb();
    const user = testUser(db);
    seedRoom(db, "r1", "AAAA", user.id);
    seedResult(db, "r1", user.id);
    seedText(db, "hello", "en");
    seedText(db, "oi", "pt");

    const rm = fakeRoomManager([
      { participants: new Map([["a", {}]]), spectators: new Map([["b", {}], ["c", {}]]) },
    ]);
    const stats = getStats(db, rm);

    expect(stats.totalUsers).toBe(1);
    expect(stats.totalRoomsEver).toBe(1);
    expect(stats.totalRaces).toBe(1);
    expect(stats.liveRoomsCount).toBe(1);
    expect(stats.liveParticipants).toBe(1);
    expect(stats.liveSpectators).toBe(2);
    expect(stats.textsByLang).toEqual(
      expect.arrayContaining([{ lang: "en", count: 1 }, { lang: "pt", count: 1 }])
    );
    expect(stats.racesPerDay).toHaveLength(14);
    expect(stats.racesPerDay[13]?.count).toBe(1);
  });
});

describe("admin: users", () => {
  it("lists users with race counts and supports search", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    testUser(db, "bob", "Bob");
    seedRoom(db, "r1", "AAAA", alice.id);
    seedResult(db, "r1", alice.id);

    const all = listUsers(db);
    expect(all.total).toBe(2);
    const aliceRow = all.rows.find((r) => r.username === "alice");
    expect(aliceRow?.races).toBe(1);

    const filtered = listUsers(db, { search: "ali" });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]?.username).toBe("alice");
  });

  it("returns full detail with summary and history, and null for missing user", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    seedRoom(db, "r1", "AAAA", alice.id);
    seedResult(db, "r1", alice.id, { wpm: 80, accuracy: 98, position: 1 });

    const detail = getUserDetail(db, alice.id);
    expect(detail?.summary.races).toBe(1);
    expect(detail?.summary.bestWpm).toBe(80);
    expect(detail?.summary.wins).toBe(1);
    expect(detail?.history).toHaveLength(1);

    expect(getUserDetail(db, "nonexistent")).toBeNull();
  });

  it("updates display name", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    expect(updateUserDisplayName(db, alice.id, "Alicia")).toBe(true);
    expect(getUserDetail(db, alice.id)?.displayName).toBe("Alicia");
    expect(updateUserDisplayName(db, "nonexistent", "X")).toBe(false);
  });

  it("blocks deleting a user with race history", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    seedRoom(db, "r1", "AAAA", alice.id);
    seedResult(db, "r1", alice.id);

    expect(deleteUser(db, alice.id)).toEqual({ ok: false, reason: "has_history" });
  });

  it("blocks deleting a user who hosted a room even with no results", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    seedRoom(db, "r1", "AAAA", alice.id);

    expect(deleteUser(db, alice.id)).toEqual({ ok: false, reason: "has_history" });
  });

  it("deletes a clean user with no history", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    expect(deleteUser(db, alice.id)).toEqual({ ok: true });
    expect(getUserDetail(db, alice.id)).toBeNull();
  });

  it("returns not_found for a missing user id", () => {
    const db = testDb();
    expect(deleteUser(db, "nonexistent")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("admin: room history", () => {
  it("paginates and joins host username / text lang", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    const textId = seedText(db, "hello", "en");
    seedRoom(db, "r1", "AAAA", alice.id, textId);
    seedRoom(db, "r2", "BBBB", alice.id);

    const page1 = listRoomHistory(db, { page: 1, pageSize: 1 });
    expect(page1.total).toBe(2);
    expect(page1.rows).toHaveLength(1);
    expect(page1.rows[0]?.hostUsername).toBe("alice");

    const withLang = listRoomHistory(db).rows.find((r) => r.code === "AAAA");
    expect(withLang?.textLang).toBe("en");
  });
});

describe("admin: rankings and results", () => {
  it("ranks users by best wpm", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    const bob = testUser(db, "bob", "Bob");
    seedRoom(db, "r1", "AAAA", alice.id);
    seedResult(db, "r1", alice.id, { wpm: 90, position: 1 });
    seedResult(db, "r1", bob.id, { wpm: 70, position: 2 });

    const rankings = listRankings(db);
    expect(rankings[0]?.username).toBe("alice");
    expect(rankings[0]?.bestWpm).toBe(90);
    expect(rankings[1]?.username).toBe("bob");
  });

  it("lists and deletes raw results", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    seedRoom(db, "r1", "AAAA", alice.id);
    seedResult(db, "r1", alice.id);

    const before = listResults(db);
    expect(before.total).toBe(1);
    const id = before.rows[0]!.id;

    expect(deleteResult(db, id)).toBe(true);
    expect(listResults(db).total).toBe(0);
    expect(deleteResult(db, id)).toBe(false);
  });
});

describe("admin: texts CRUD", () => {
  it("creates, filters by lang, updates and deletes a text", () => {
    const db = testDb();
    const created = createText(db, "Hello world", "en");
    expect(created.id).toBeGreaterThan(0);

    seedText(db, "oi mundo", "pt");

    expect(listTexts(db, { lang: "en" }).rows).toHaveLength(1);
    expect(listTexts(db).total).toBe(2);

    expect(updateText(db, created.id, { content: "Hello there" })).toBe(true);
    expect(listTexts(db, { lang: "en" }).rows[0]?.content).toBe("Hello there");
    expect(updateText(db, 99999, { content: "x" })).toBe(false);

    expect(deleteText(db, created.id)).toEqual({ ok: true });
    expect(deleteText(db, created.id)).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses to delete a text still referenced by a room", () => {
    const db = testDb();
    const alice = testUser(db, "alice", "Alice");
    const textId = seedText(db, "hello", "en");
    seedRoom(db, "r1", "AAAA", alice.id, textId);

    expect(deleteText(db, textId)).toEqual({ ok: false, reason: "in_use" });
  });
});
