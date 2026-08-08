import { customAlphabet } from "nanoid";
import { pickRandomText } from "./texts.js";

// Avoid ambiguous chars (0/O, 1/I/L) so codes are short and easy to read/type.
const genCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

const CAR_COLORS = [
  "#e63946",
  "#2a9d8f",
  "#f4a261",
  "#457b9d",
  "#e9c46a",
  "#9d4edd",
  "#06d6a0",
  "#ef476f",
];

export class RoomManager {
  constructor(db) {
    this.db = db;
    this.rooms = new Map(); // roomId -> state
    this.codeToId = new Map(); // code -> roomId
  }

  createRoom(hostUser) {
    let code;
    do {
      code = genCode();
    } while (this.codeToId.has(code));

    const id = code; // room id == code for simplicity
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO rooms (id, code, host_user_id, status, created_at) VALUES (?, ?, ?, 'waiting', ?)`
      )
      .run(id, code, hostUser.id, now);

    const state = {
      id,
      code,
      hostUserId: hostUser.id,
      status: "waiting",
      // Picked up front so the (blurred) text can be shown while everyone waits.
      text: pickRandomText(this.db),
      participants: new Map(),
      spectators: new Set(), // read-only "mirror" viewers (big screens)
      createdAt: now,
      startedAt: null,
      countdownTimer: null,
      graceTimer: null,
      tickTimer: null,
    };

    this.rooms.set(id, state);
    this.codeToId.set(code, id);
    this.addParticipant(state, hostUser);
    return state;
  }

  getByCode(code) {
    const id = this.codeToId.get(code.toUpperCase());
    if (!id) return null;
    return this.rooms.get(id);
  }

  addParticipant(room, user) {
    if (room.participants.has(user.id)) return room.participants.get(user.id);
    const colorIndex = room.participants.size % CAR_COLORS.length;
    const p = {
      user,
      ws: null,
      typed: "",
      correctLen: 0,
      keystrokes: 0,
      correctKeystrokes: 0,
      finished: false,
      finishTimeMs: null,
      position: null,
      carColor: CAR_COLORS[colorIndex],
      connected: false,
    };
    room.participants.set(user.id, p);
    return p;
  }

  removeParticipant(room, userId) {
    room.participants.delete(userId);
  }

  addSpectator(room, ws) {
    room.spectators.add(ws);
  }

  removeSpectator(room, ws) {
    room.spectators.delete(ws);
  }

  // Computed fresh on every call so PPM/precisão/tempo keep moving in real
  // time even between keystrokes (elapsed time changes; correctLen doesn't).
  liveStats(room, p) {
    if (!room.text || !room.startedAt) return { wpm: 0, accuracy: 100, elapsedMs: 0 };
    const elapsedMs = p.finished ? p.finishTimeMs : Date.now() - room.startedAt;
    const minutes = elapsedMs / 60000;
    const wpm = minutes > 0 ? Math.round(p.correctLen / 5 / minutes) : 0;
    const accuracy =
      p.keystrokes > 0 ? Math.round((p.correctKeystrokes / p.keystrokes) * 1000) / 10 : 100;
    return { wpm, accuracy, elapsedMs };
  }

  publicState(room) {
    return {
      code: room.code,
      status: room.status,
      hostUserId: room.hostUserId,
      text: room.text ? room.text.content : null,
      participants: [...room.participants.values()].map((p) => {
        const stats = this.liveStats(room, p);
        return {
          userId: p.user.id,
          username: p.user.username,
          displayName: p.user.display_name,
          carColor: p.carColor,
          connected: p.connected,
          progress: room.text ? p.correctLen / room.text.content.length : 0,
          finished: p.finished,
          finishTimeMs: p.finishTimeMs,
          position: p.position,
          wpm: stats.wpm,
          accuracy: stats.accuracy,
          elapsedMs: stats.elapsedMs,
        };
      }),
    };
  }

  startCountdown(room, onTick, onGo) {
    if (room.status !== "waiting") return;
    room.status = "countdown";
    let n = 5;
    onTick(n);
    room.countdownTimer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        onTick(n);
      } else {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
        onTick(0); // final "Vai!" tick so the UI can clear the overlay
        room.status = "racing";
        room.startedAt = Date.now();
        this.db
          .prepare(
            "UPDATE rooms SET status='racing', started_at=?, text_id=? WHERE id=?"
          )
          .run(room.startedAt, room.text.id, room.id);
        onGo(room.text.content);
      }
    }, 1000);
  }

  startRaceTicker(room, onTick) {
    if (room.tickTimer) clearInterval(room.tickTimer);
    room.tickTimer = setInterval(onTick, 500);
  }

  stopRaceTicker(room) {
    if (room.tickTimer) {
      clearInterval(room.tickTimer);
      room.tickTimer = null;
    }
  }

  computeProgress(target, typed) {
    let i = 0;
    const max = Math.min(target.length, typed.length);
    while (i < max && typed[i] === target[i]) i++;
    return i;
  }

  finishRoom(room) {
    if (room.status === "finished") return;
    if (room.graceTimer) {
      clearTimeout(room.graceTimer);
      room.graceTimer = null;
    }
    this.stopRaceTicker(room);
    room.status = "finished";
    this.db
      .prepare("UPDATE rooms SET status='finished', finished_at=? WHERE id=?")
      .run(Date.now(), room.id);
  }

  destroyRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    if (room.graceTimer) clearTimeout(room.graceTimer);
    this.stopRaceTicker(room);
    this.rooms.delete(roomId);
    this.codeToId.delete(room.code);
  }
}
