import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { RoomManager } from "../src/rooms.js";
import { testDb, testUser, seedText } from "./helpers.js";

describe("RoomManager.computeProgress", () => {
  const rooms = new RoomManager(testDb());

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
  let db: Database.Database;
  let rooms: RoomManager;

  beforeEach(() => {
    db = testDb();
    seedText(db, "Race text for the room.", "pt");
    rooms = new RoomManager(db);
  });

  it("creates a room with a short, uppercase code and the host as a participant", () => {
    const host = testUser(db, "host1", "Host");
    const room = rooms.createRoom(host, "pt");

    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(room.status).toBe("waiting");
    expect(room.hostUserId).toBe(host.id);
    expect(room.participants.size).toBe(1);
    expect(room.text?.content).toBe("Race text for the room.");
  });

  it("looks a room up by code case-insensitively", () => {
    const host = testUser(db, "host2", "Host");
    const room = rooms.createRoom(host);

    expect(rooms.getByCode(room.code.toLowerCase())).toBe(room);
    expect(rooms.getByCode("NOPE00")).toBeNull();
  });

  it("does not duplicate a participant who joins twice", () => {
    const host = testUser(db, "host3", "Host");
    const room = rooms.createRoom(host);

    const first = rooms.addParticipant(room, host);
    const second = rooms.addParticipant(room, host);

    expect(room.participants.size).toBe(1);
    expect(first).toBe(second);
  });

  it("removes participants", () => {
    const host = testUser(db, "host4", "Host");
    const room = rooms.createRoom(host);
    rooms.removeParticipant(room, host.id);
    expect(room.participants.size).toBe(0);
  });

  it("publicState never leaks the websocket handle and starts everyone at 0 progress", () => {
    const host = testUser(db, "host5", "Host");
    const room = rooms.createRoom(host, "pt");
    const state = rooms.publicState(room);

    expect(state.text).toBe("Race text for the room.");
    expect(state.participants).toHaveLength(1);
    expect((state.participants[0] as unknown as Record<string, unknown>).ws).toBeUndefined();
    expect(state.participants[0]?.progress).toBe(0);
  });
});

describe("RoomManager.liveStats", () => {
  it("returns zeros before the race has started", () => {
    const db = testDb();
    const rooms = new RoomManager(db);
    const host = testUser(db, "host6", "Host");
    const room = rooms.createRoom(host); // no texts seeded -> room.text is undefined
    const p = rooms.addParticipant(room, host);

    expect(rooms.liveStats(room, p)).toEqual({ wpm: 0, accuracy: 100, elapsedMs: 0 });
  });

  it("computes WPM from correct characters typed over elapsed time", () => {
    vi.useFakeTimers();
    try {
      const db = testDb();
      seedText(db, "abcdefghij", "pt"); // 10 chars = 2 "words" at 5 chars/word
      const rooms = new RoomManager(db);
      const host = testUser(db, "host7", "Host");

      const start = Date.now();
      const room = rooms.createRoom(host, "pt");
      const p = rooms.addParticipant(room, host);
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

  it("uses the frozen finish time instead of elapsed wall-clock time once finished", () => {
    const db = testDb();
    seedText(db, "abcde", "pt");
    const rooms = new RoomManager(db);
    const host = testUser(db, "host8", "Host");
    const room = rooms.createRoom(host, "pt");
    const p = rooms.addParticipant(room, host);

    room.startedAt = Date.now() - 10_000;
    p.finished = true;
    p.finishTimeMs = 30_000;
    p.correctLen = 5;
    p.keystrokes = 5;
    p.correctKeystrokes = 5;

    expect(rooms.liveStats(room, p).elapsedMs).toBe(30_000);
  });
});
