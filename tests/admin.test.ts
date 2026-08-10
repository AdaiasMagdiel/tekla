import { describe, it, expect } from "vitest";
import type { DbAdapter } from "../src/db.js";
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
  listCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
} from "../src/admin.js";

function fakeRoomManager(rooms: unknown[] = []) {
  return { listRooms: () => rooms } as any;
}

async function seedRoom(
  db: DbAdapter,
  id: string,
  code: string,
  hostUserId: string,
  textId: number | null = null
): Promise<void> {
  await db.run(
    "INSERT INTO rooms (id, code, host_user_id, text_id, status, created_at) VALUES (?, ?, ?, ?, 'finished', ?)",
    [id, code, hostUserId, textId, Date.now()]
  );
}

async function seedResult(
  db: DbAdapter,
  roomId: string,
  userId: string,
  opts: { wpm?: number; accuracy?: number; position?: number } = {}
): Promise<void> {
  await db.run(
    "INSERT INTO race_results (room_id, user_id, wpm, accuracy, position, time_ms, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [roomId, userId, opts.wpm ?? 60, opts.accuracy ?? 95, opts.position ?? 1, 30000, Date.now()]
  );
}

describe("admin: stats", () => {
  it("aggregates counts and reflects live room manager state", async () => {
    const db = await testDb();
    const user = await testUser(db);
    await seedRoom(db, "r1", "AAAA", user.id);
    await seedResult(db, "r1", user.id);
    await seedText(db, "hello", "en");
    await seedText(db, "oi", "pt");

    const rm = fakeRoomManager([
      { participants: new Map([["a", {}]]), spectators: new Map([["b", {}], ["c", {}]]) },
    ]);
    const stats = await getStats(db, rm);

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
  it("lists users with race counts and supports search", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    await testUser(db, "bob", "Bob");
    await seedRoom(db, "r1", "AAAA", alice.id);
    await seedResult(db, "r1", alice.id);

    const all = await listUsers(db);
    expect(all.total).toBe(2);
    const aliceRow = all.rows.find((r) => r.username === "alice");
    expect(aliceRow?.races).toBe(1);

    const filtered = await listUsers(db, { search: "ali" });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]?.username).toBe("alice");
  });

  it("returns full detail with summary and history, and null for missing user", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    await seedRoom(db, "r1", "AAAA", alice.id);
    await seedResult(db, "r1", alice.id, { wpm: 80, accuracy: 98, position: 1 });

    const detail = await getUserDetail(db, alice.id);
    expect(detail?.summary.races).toBe(1);
    expect(detail?.summary.bestWpm).toBe(80);
    expect(detail?.summary.wins).toBe(1);
    expect(detail?.history).toHaveLength(1);

    expect(await getUserDetail(db, "nonexistent")).toBeNull();
  });

  it("updates display name", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    expect(await updateUserDisplayName(db, alice.id, "Alicia")).toBe(true);
    expect((await getUserDetail(db, alice.id))?.displayName).toBe("Alicia");
    expect(await updateUserDisplayName(db, "nonexistent", "X")).toBe(false);
  });

  it("blocks deleting a user with race history", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    await seedRoom(db, "r1", "AAAA", alice.id);
    await seedResult(db, "r1", alice.id);

    expect(await deleteUser(db, alice.id)).toEqual({ ok: false, reason: "has_history" });
  });

  it("blocks deleting a user who hosted a room even with no results", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    await seedRoom(db, "r1", "AAAA", alice.id);

    expect(await deleteUser(db, alice.id)).toEqual({ ok: false, reason: "has_history" });
  });

  it("deletes a clean user with no history", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    expect(await deleteUser(db, alice.id)).toEqual({ ok: true });
    expect(await getUserDetail(db, alice.id)).toBeNull();
  });

  it("returns not_found for a missing user id", async () => {
    const db = await testDb();
    expect(await deleteUser(db, "nonexistent")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("admin: room history", () => {
  it("paginates and joins host username / text lang", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    const textId = await seedText(db, "hello", "en");
    await seedRoom(db, "r1", "AAAA", alice.id, textId);
    await seedRoom(db, "r2", "BBBB", alice.id);

    const page1 = await listRoomHistory(db, { page: 1, pageSize: 1 });
    expect(page1.total).toBe(2);
    expect(page1.rows).toHaveLength(1);
    expect(page1.rows[0]?.hostUsername).toBe("alice");

    const withLang = (await listRoomHistory(db)).rows.find((r) => r.code === "AAAA");
    expect(withLang?.textLang).toBe("en");
  });
});

describe("admin: rankings and results", () => {
  it("ranks users by best wpm", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    const bob = await testUser(db, "bob", "Bob");
    await seedRoom(db, "r1", "AAAA", alice.id);
    await seedResult(db, "r1", alice.id, { wpm: 90, position: 1 });
    await seedResult(db, "r1", bob.id, { wpm: 70, position: 2 });

    const rankings = await listRankings(db);
    expect(rankings[0]?.username).toBe("alice");
    expect(rankings[0]?.bestWpm).toBe(90);
    expect(rankings[1]?.username).toBe("bob");
  });

  it("lists and deletes raw results", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    await seedRoom(db, "r1", "AAAA", alice.id);
    await seedResult(db, "r1", alice.id);

    const before = await listResults(db);
    expect(before.total).toBe(1);
    const id = before.rows[0]!.id;

    expect(await deleteResult(db, id)).toBe(true);
    expect((await listResults(db)).total).toBe(0);
    expect(await deleteResult(db, id)).toBe(false);
  });
});

describe("admin: texts CRUD", () => {
  it("creates, filters by lang, updates and deletes a text", async () => {
    const db = await testDb();
    const created = await createText(db, "Hello world", "en");
    expect(created.id).toBeGreaterThan(0);

    await seedText(db, "oi mundo", "pt");

    expect((await listTexts(db, { lang: "en" })).rows).toHaveLength(1);
    expect((await listTexts(db)).total).toBe(2);

    expect(await updateText(db, created.id, { content: "Hello there" })).toBe(true);
    expect((await listTexts(db, { lang: "en" })).rows[0]?.content).toBe("Hello there");
    expect(await updateText(db, 99999, { content: "x" })).toBe(false);

    expect(await deleteText(db, created.id)).toEqual({ ok: true });
    expect(await deleteText(db, created.id)).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses to delete a text still referenced by a room", async () => {
    const db = await testDb();
    const alice = await testUser(db, "alice", "Alice");
    const textId = await seedText(db, "hello", "en");
    await seedRoom(db, "r1", "AAAA", alice.id, textId);

    expect(await deleteText(db, textId)).toEqual({ ok: false, reason: "in_use" });
  });
});

describe("admin: characters CRUD", () => {
  it("creates, updates and deletes a character", async () => {
    const db = await testDb();
    const created = await createCharacter(db, "Foguete", "/uploads/characters/foguete.png");
    expect(created.id).toBeGreaterThan(0);
    expect(created.usageCount).toBe(0);

    expect((await listCharacters(db)).total).toBe(1);
    expect((await listCharacters(db)).rows[0]?.name).toBe("Foguete");

    expect(await updateCharacter(db, created.id, { name: "Foguete Turbo" })).toBe(true);
    expect((await listCharacters(db)).rows[0]?.name).toBe("Foguete Turbo");
    expect(await updateCharacter(db, 99999, { name: "x" })).toBe(false);

    expect(await deleteCharacter(db, created.id)).toEqual({ ok: true });
    expect(await deleteCharacter(db, created.id)).toEqual({ ok: false, reason: "not_found" });
  });

  it("counts how many users have picked a character, and clears the pick on delete", async () => {
    const db = await testDb();
    const character = await createCharacter(db, "Raio", "/uploads/characters/raio.png");
    const user = await testUser(db, "bob", "Bob");
    await db.run("UPDATE users SET character_id = ? WHERE id = ?", [character.id, user.id]);

    expect((await listCharacters(db)).rows[0]?.usageCount).toBe(1);

    expect(await deleteCharacter(db, character.id)).toEqual({ ok: true });

    const updatedUser = await db.get<{ character_id: number | null }>(
      "SELECT character_id FROM users WHERE id = ?",
      [user.id]
    );
    expect(updatedUser?.character_id).toBeNull();
  });
});
