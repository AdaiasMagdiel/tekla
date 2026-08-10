import { customAlphabet } from "nanoid";
import type { WebSocket } from "ws";
import type { DbAdapter } from "./db.js";
import { pickRandomText } from "./texts.js";
import type { RaceText, UserRow } from "./types.js";

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

export type RoomStatus = "waiting" | "countdown" | "racing" | "finished";

export interface Participant {
  user: UserRow;
  ws: WebSocket | null;
  typed: string;
  correctLen: number;
  keystrokes: number;
  correctKeystrokes: number;
  finished: boolean;
  finishTimeMs: number | null;
  position: number | null;
  carColor: string;
  characterImagePath: string | null;
  connected: boolean;
}

export interface RoomState {
  id: string;
  code: string;
  hostUserId: string;
  status: RoomStatus;
  text: RaceText | undefined;
  lang: string | null;
  participants: Map<string, Participant>;
  spectators: Set<WebSocket>;
  createdAt: number;
  startedAt: number | null;
  countdownTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
  tickTimer: NodeJS.Timeout | null;
}

export interface LiveStats {
  wpm: number;
  accuracy: number;
  elapsedMs: number;
}

export interface PublicParticipant {
  userId: string;
  username: string;
  displayName: string;
  carColor: string;
  characterImagePath: string | null;
  connected: boolean;
  progress: number;
  finished: boolean;
  finishTimeMs: number | null;
  position: number | null;
  wpm: number;
  accuracy: number;
  elapsedMs: number;
}

export interface PublicRoomState {
  code: string;
  status: RoomStatus;
  hostUserId: string;
  text: string | null;
  participants: PublicParticipant[];
}

export class RoomManager {
  private db: DbAdapter;
  private rooms = new Map<string, RoomState>();
  private codeToId = new Map<string, string>();

  constructor(db: DbAdapter) {
    this.db = db;
  }

  async createRoom(hostUser: UserRow, lang?: string | null): Promise<RoomState> {
    let code: string;
    do {
      code = genCode();
    } while (this.codeToId.has(code));

    const id = code; // room id == code for simplicity
    const now = Date.now();

    await this.db.run(
      `INSERT INTO rooms (id, code, host_user_id, status, created_at) VALUES (?, ?, ?, 'waiting', ?)`,
      [id, code, hostUser.id, now]
    );

    const state: RoomState = {
      id,
      code,
      hostUserId: hostUser.id,
      status: "waiting",
      // Picked up front so the (blurred) text can be shown while everyone waits.
      text: await pickRandomText(this.db, lang),
      lang: lang ?? null,
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
    await this.addParticipant(state, hostUser);
    return state;
  }

  getByCode(code: string): RoomState | null {
    const id = this.codeToId.get(code.toUpperCase());
    if (!id) return null;
    return this.rooms.get(id) ?? null;
  }

  // Snapshot of every room currently live in memory — used by the admin
  // dashboard, which has no other way to see in-flight rooms (they only get
  // a row in the `rooms` table, without participant/spectator detail, once
  // finishRoom() persists their final status).
  listRooms(): RoomState[] {
    return [...this.rooms.values()];
  }

  async addParticipant(room: RoomState, user: UserRow): Promise<Participant> {
    const existing = room.participants.get(user.id);
    if (existing) return existing;

    const colorIndex = room.participants.size % CAR_COLORS.length;
    const characterImagePath = user.character_id
      ? ((await this.db.get<{ image_path: string }>("SELECT image_path FROM characters WHERE id = ?", [
          user.character_id,
        ]))?.image_path ?? null)
      : null;
    const p: Participant = {
      user,
      ws: null,
      typed: "",
      correctLen: 0,
      keystrokes: 0,
      correctKeystrokes: 0,
      finished: false,
      finishTimeMs: null,
      position: null,
      carColor: CAR_COLORS[colorIndex]!,
      characterImagePath,
      connected: false,
    };
    room.participants.set(user.id, p);
    return p;
  }

  removeParticipant(room: RoomState, userId: string): void {
    room.participants.delete(userId);
  }

  // If the host is gone (left the "waiting" room entirely) or just
  // disconnected (mid-race/finished, where they're kept around in case they
  // reconnect), hand the title to whoever else has been in the room the
  // longest — Map iteration order tracks arrival order, and a fresh entrant
  // (rejoin after removal) is appended at the end, so the earliest surviving
  // arrival is always first. Without this, everyone else is stuck staring at
  // "waiting for host" with no way to start a new race.
  async maybeTransferHost(room: RoomState): Promise<void> {
    const currentHost = room.participants.get(room.hostUserId);
    if (currentHost?.connected) return;

    const next = [...room.participants.values()].find(
      (p) => p.user.id !== room.hostUserId && p.connected
    );
    if (!next) return;

    room.hostUserId = next.user.id;
    await this.db.run("UPDATE rooms SET host_user_id=? WHERE id=?", [next.user.id, room.id]);
  }

  addSpectator(room: RoomState, ws: WebSocket): void {
    room.spectators.add(ws);
  }

  removeSpectator(room: RoomState, ws: WebSocket): void {
    room.spectators.delete(ws);
  }

  // Computed fresh on every call so PPM/precisão/tempo keep moving in real
  // time even between keystrokes (elapsed time changes; correctLen doesn't).
  liveStats(room: RoomState, p: Participant): LiveStats {
    if (!room.text || !room.startedAt) return { wpm: 0, accuracy: 100, elapsedMs: 0 };
    const elapsedMs = p.finished ? p.finishTimeMs! : Date.now() - room.startedAt;
    const minutes = elapsedMs / 60000;
    const wpm = minutes > 0 ? Math.round(p.correctLen / 5 / minutes) : 0;
    const accuracy =
      p.keystrokes > 0 ? Math.round((p.correctKeystrokes / p.keystrokes) * 1000) / 10 : 100;
    return { wpm, accuracy, elapsedMs };
  }

  publicState(room: RoomState): PublicRoomState {
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
          characterImagePath: p.characterImagePath,
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

  startCountdown(room: RoomState, onTick: (n: number) => void, onGo: (text: string) => void): void {
    if (room.status !== "waiting") return;
    room.status = "countdown";
    let n = 5;
    onTick(n);
    room.countdownTimer = setInterval(async () => {
      try {
        n -= 1;
        if (n > 0) {
          onTick(n);
        } else {
          clearInterval(room.countdownTimer!);
          room.countdownTimer = null;
          onTick(0); // final "Vai!" tick so the UI can clear the overlay
          room.status = "racing";
          room.startedAt = Date.now();
          await this.db.run("UPDATE rooms SET status='racing', started_at=?, text_id=? WHERE id=?", [
            room.startedAt,
            room.text!.id,
            room.id,
          ]);
          onGo(room.text!.content);
        }
      } catch (err) {
        console.error("countdown tick failed:", err);
      }
    }, 1000);
  }

  startRaceTicker(room: RoomState, onTick: () => void): void {
    if (room.tickTimer) clearInterval(room.tickTimer);
    room.tickTimer = setInterval(onTick, 500);
  }

  stopRaceTicker(room: RoomState): void {
    if (room.tickTimer) {
      clearInterval(room.tickTimer);
      room.tickTimer = null;
    }
  }

  // Progress only advances through the longest CORRECT prefix typed so far —
  // racing ahead of an uncorrected typo doesn't move the car.
  computeProgress(target: string, typed: string): number {
    let i = 0;
    const max = Math.min(target.length, typed.length);
    while (i < max && typed[i] === target[i]) i++;
    return i;
  }

  async finishRoom(room: RoomState): Promise<void> {
    if (room.status === "finished") return;
    if (room.graceTimer) {
      clearTimeout(room.graceTimer);
      room.graceTimer = null;
    }
    this.stopRaceTicker(room);
    room.status = "finished";
    await this.db.run("UPDATE rooms SET status='finished', finished_at=? WHERE id=?", [
      Date.now(),
      room.id,
    ]);
  }

  // Brings a finished room back to the lobby with a fresh text, so the host
  // can start another race in the same room instead of everyone re-joining
  // with a new code. Past results already live in race_results, untouched.
  async resetRoom(room: RoomState): Promise<void> {
    if (room.status !== "finished") return;
    if (room.countdownTimer) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
    }
    if (room.graceTimer) {
      clearTimeout(room.graceTimer);
      room.graceTimer = null;
    }
    this.stopRaceTicker(room);

    room.status = "waiting";
    room.startedAt = null;
    room.text = await pickRandomText(this.db, room.lang);

    for (const p of room.participants.values()) {
      p.typed = "";
      p.correctLen = 0;
      p.keystrokes = 0;
      p.correctKeystrokes = 0;
      p.finished = false;
      p.finishTimeMs = null;
      p.position = null;
    }

    await this.db.run(
      "UPDATE rooms SET status='waiting', text_id=NULL, started_at=NULL, finished_at=NULL WHERE id=?",
      [room.id]
    );
  }

  destroyRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    if (room.graceTimer) clearTimeout(room.graceTimer);
    this.stopRaceTicker(room);
    this.rooms.delete(roomId);
    this.codeToId.delete(room.code);
  }
}
