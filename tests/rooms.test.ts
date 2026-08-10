import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { DbAdapter } from "../src/db.js";
import { RoomManager } from "../src/rooms.js";
import { testDb, testUser, seedText } from "./helpers.js";

describe("RoomManager.computeProgress", () => {
  let rooms: RoomManager;

  beforeAll(async () => {
    rooms = new RoomManager(await testDb());
  });

  it("returns the length of the longest correct prefix", () => {
    expect(rooms.computeProgress("hello world", "hello")).toBe(5);
    expect(rooms.computeProgress("hello world", "hello world")).toBe(11);
  });

  it("stops at the first mismatch, ignoring anything typed after it", () => {
    // Typo at index 3 ("l" -> "L"), then perfectly correct characters after —
    // none of those should count, matching the "fix it or barely move" design.
    expect(rooms.computeProgress("hello world", "helLo world")).toBe(3);
  });

  it("returns 0 for empty input or an immediate mismatch", () => {
    expect(rooms.computeProgress("hello", "")).toBe(0);
    expect(rooms.computeProgress("hello", "xhello")).toBe(0);
  });

  it("never exceeds the target length even if typed is longer", () => {
    expect(rooms.computeProgress("hi", "hi there")).toBe(2);
  });
});

describe("RoomManager room lifecycle", () => {
  let db: DbAdapter;
  let rooms: RoomManager;

  beforeEach(async () => {
    db = await testDb();
    await seedText(db, "Race text for the room.", "pt");
    rooms = new RoomManager(db);
  });

  it("creates a room with a short, uppercase code and the host as a participant", async () => {
    const host = await testUser(db, "host1", "Host");
    const room = await rooms.createRoom(host, "pt");

    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(room.status).toBe("waiting");
    expect(room.hostUserId).toBe(host.id);
    expect(room.participants.size).toBe(1);
    expect(room.text?.content).toBe("Race text for the room.");
  });

  it("looks a room up by code case-insensitively", async () => {
    const host = await testUser(db, "host2", "Host");
    const room = await rooms.createRoom(host);

    expect(rooms.getByCode(room.code.toLowerCase())).toBe(room);
    expect(rooms.getByCode("NOPE00")).toBeNull();
  });

  it("does not duplicate a participant who joins twice", async () => {
    const host = await testUser(db, "host3", "Host");
    const room = await rooms.createRoom(host);

    const first = await rooms.addParticipant(room, host);
    const second = await rooms.addParticipant(room, host);

    expect(room.participants.size).toBe(1);
    expect(first).toBe(second);
  });

  it("removes participants", async () => {
    const host = await testUser(db, "host4", "Host");
    const room = await rooms.createRoom(host);
    rooms.removeParticipant(room, host.id);
    expect(room.participants.size).toBe(0);
  });

  it("publicState never leaks the websocket handle and starts everyone at 0 progress", async () => {
    const host = await testUser(db, "host5", "Host");
    const room = await rooms.createRoom(host, "pt");
    const state = rooms.publicState(room);

    expect(state.text).toBe("Race text for the room.");
    expect(state.participants).toHaveLength(1);
    expect((state.participants[0] as unknown as Record<string, unknown>).ws).toBeUndefined();
    expect(state.participants[0]?.progress).toBe(0);
  });

  it("attaches characterImagePath: null when the user has no character chosen", async () => {
    const host = await testUser(db, "host9", "Host");
    const room = await rooms.createRoom(host);
    const p = await rooms.addParticipant(room, host);

    expect(p.characterImagePath).toBeNull();
    expect(rooms.publicState(room).participants[0]?.characterImagePath).toBeNull();
  });

  it("pickTextForStart sets room.difficulty and picks a text matching it", async () => {
    const host = await testUser(db, "host11", "Host");
    const room = await rooms.createRoom(host, "pt");
    expect(room.difficulty).toBeNull();

    await seedText(db, "Easy PT.", "pt", "easy");
    const text = await rooms.pickTextForStart(room, "easy");

    expect(room.difficulty).toBe("easy");
    expect(text?.content).toBe("Easy PT.");
    expect(room.text?.content).toBe("Easy PT.");
    expect(rooms.publicState(room).difficulty).toBe("easy");
  });

  it("propagates the chosen character's image path into the participant and publicState", async () => {
    const info = await db.run("INSERT INTO characters (name, image_path, created_at) VALUES (?, ?, ?)", [
      "Raio",
      "/uploads/characters/raio.png",
      Date.now(),
    ]);
    const characterId = info.lastInsertRowid;

    const host = await testUser(db, "host10", "Host");
    await db.run("UPDATE users SET character_id = ? WHERE id = ?", [characterId, host.id]);
    const updatedHost = { ...host, character_id: characterId };

    const room = await rooms.createRoom(updatedHost);
    const p = await rooms.addParticipant(room, updatedHost);

    expect(p.characterImagePath).toBe("/uploads/characters/raio.png");
    expect(rooms.publicState(room).participants[0]?.characterImagePath).toBe("/uploads/characters/raio.png");
  });
});

describe("RoomManager.liveStats", () => {
  it("returns zeros before the race has started", async () => {
    const db = await testDb();
    const rooms = new RoomManager(db);
    const host = await testUser(db, "host6", "Host");
    const room = await rooms.createRoom(host); // no texts seeded -> room.text is undefined
    const p = await rooms.addParticipant(room, host);

    expect(rooms.liveStats(room, p)).toEqual({ wpm: 0, accuracy: 100, elapsedMs: 0 });
  });

  it("computes WPM from correct characters typed over elapsed time", async () => {
    vi.useFakeTimers();
    try {
      const db = await testDb();
      await seedText(db, "abcdefghij", "pt"); // 10 chars = 2 "words" at 5 chars/word
      const rooms = new RoomManager(db);
      const host = await testUser(db, "host7", "Host");

      const start = Date.now();
      const room = await rooms.createRoom(host, "pt");
      const p = await rooms.addParticipant(room, host);
      room.startedAt = start;
      p.correctLen = 10;
      p.keystrokes = 10;
      p.correctKeystrokes = 9;

      vi.setSystemTime(start + 60_000); // exactly 1 minute later

      const stats = rooms.liveStats(room, p);
      expect(stats.wpm).toBe(2);
      expect(stats.accuracy).toBe(90);
      expect(stats.elapsedMs).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the frozen finish time instead of elapsed wall-clock time once finished", async () => {
    const db = await testDb();
    await seedText(db, "abcde", "pt");
    const rooms = new RoomManager(db);
    const host = await testUser(db, "host8", "Host");
    const room = await rooms.createRoom(host, "pt");
    const p = await rooms.addParticipant(room, host);

    room.startedAt = Date.now() - 10_000;
    p.finished = true;
    p.finishTimeMs = 30_000;
    p.correctLen = 5;
    p.keystrokes = 5;
    p.correctKeystrokes = 5;

    expect(rooms.liveStats(room, p).elapsedMs).toBe(30_000);
  });
});
