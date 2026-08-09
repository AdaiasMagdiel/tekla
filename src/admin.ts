import { createHash, timingSafeEqual } from "crypto";
import type Database from "better-sqlite3";
import type { Express, RequestHandler } from "express";
import express from "express";
import path from "path";
import type { RoomManager, RoomState } from "./rooms.js";

// ---------- Auth ----------

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

const REALM = 'Basic realm="Tekla Admin"';

// Returns null (admin fully disabled) unless both env vars are set — there's
// no default credential, so a deploy that forgets to configure this simply
// doesn't expose the panel instead of exposing it with a guessable login.
export function createAdminAuthMiddleware(): RequestHandler | null {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) return null;

  return (req, res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const u = decoded.slice(0, sep);
        const p = decoded.slice(sep + 1);
        if (safeEqual(u, user) && safeEqual(p, pass)) return next();
      }
    }
    res.set("WWW-Authenticate", REALM);
    res.status(401).send("Authentication required.");
  };
}

// ---------- Types ----------

export interface AdminStats {
  totalUsers: number;
  totalRoomsEver: number;
  totalRaces: number;
  liveRoomsCount: number;
  liveParticipants: number;
  liveSpectators: number;
  textsByLang: { lang: string; count: number }[];
  racesPerDay: { date: string; count: number }[];
}

export interface AdminUserListRow {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  races: number;
}

export interface AdminUserDetail {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  summary: { races: number; bestWpm: number; avgWpm: number; avgAccuracy: number; wins: number };
  history: {
    roomCode: string;
    wpm: number;
    accuracy: number;
    position: number;
    timeMs: number;
    finishedAt: number;
  }[];
}

export type DeleteUserResult = { ok: true } | { ok: false; reason: "not_found" | "has_history" };

export interface AdminLiveParticipant {
  username: string;
  displayName: string;
  connected: boolean;
  finished: boolean;
  progress: number;
  wpm: number;
  accuracy: number;
}

export interface AdminLiveRoom {
  code: string;
  status: string;
  hostUsername: string;
  participantCount: number;
  spectatorCount: number;
  createdAt: number;
  participants: AdminLiveParticipant[];
}

export interface AdminRoomHistoryRow {
  id: string;
  code: string;
  hostUsername: string;
  status: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  textLang: string | null;
}

export interface AdminRankingRow {
  userId: string;
  username: string;
  displayName: string;
  bestWpm: number;
  avgAccuracy: number;
  races: number;
  wins: number;
}

export interface AdminResultRow {
  id: number;
  roomCode: string;
  username: string;
  wpm: number;
  accuracy: number;
  position: number;
  timeMs: number;
  finishedAt: number;
}

export interface AdminTextRow {
  id: number;
  content: string;
  lang: string;
}

export type DeleteTextResult = { ok: true } | { ok: false; reason: "not_found" | "in_use" };

interface Page {
  page: number;
  pageSize: number;
}

function paginationOf(opts: { page?: number; pageSize?: number } = {}): Page {
  return { page: Math.max(1, opts.page ?? 1), pageSize: Math.min(100, Math.max(1, opts.pageSize ?? 25)) };
}

// ---------- Stats ----------

export function getStats(db: Database.Database, roomManager: RoomManager): AdminStats {
  const totalUsers = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  const totalRoomsEver = (db.prepare("SELECT COUNT(*) as c FROM rooms").get() as { c: number }).c;
  const totalRaces = (db.prepare("SELECT COUNT(*) as c FROM race_results").get() as { c: number }).c;

  const live = roomManager.listRooms();
  const liveParticipants = live.reduce((sum, r) => sum + r.participants.size, 0);
  const liveSpectators = live.reduce((sum, r) => sum + r.spectators.size, 0);

  const textsByLang = db
    .prepare("SELECT lang, COUNT(*) as count FROM texts GROUP BY lang ORDER BY lang")
    .all() as { lang: string; count: number }[];

  const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', finished_at / 1000, 'unixepoch') as date, COUNT(*) as count
       FROM race_results
       WHERE finished_at >= ?
       GROUP BY date`
    )
    .all(since) as { date: string; count: number }[];

  const byDate = new Map(rows.map((r) => [r.date, r.count]));
  const racesPerDay: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const key = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    racesPerDay.push({ date: key, count: byDate.get(key) || 0 });
  }

  return {
    totalUsers,
    totalRoomsEver,
    totalRaces,
    liveRoomsCount: live.length,
    liveParticipants,
    liveSpectators,
    textsByLang,
    racesPerDay,
  };
}

// ---------- Users ----------

export function listUsers(
  db: Database.Database,
  opts: { search?: string; page?: number; pageSize?: number } = {}
): { rows: AdminUserListRow[]; total: number } & Page {
  const { page, pageSize } = paginationOf(opts);
  const search = (opts.search ?? "").trim();
  const where = search ? "WHERE u.username LIKE ? OR u.display_name LIKE ?" : "";
  const params = search ? [`%${search}%`, `%${search}%`] : [];

  const total = (db.prepare(`SELECT COUNT(*) as c FROM users u ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name as displayName, u.created_at as createdAt,
              (SELECT COUNT(*) FROM race_results r WHERE r.user_id = u.id) as races
       FROM users u
       ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as AdminUserListRow[];

  return { rows, total, page, pageSize };
}

export function getUserDetail(db: Database.Database, id: string): AdminUserDetail | null {
  const user = db
    .prepare("SELECT id, username, display_name as displayName, created_at as createdAt FROM users WHERE id = ?")
    .get(id) as { id: string; username: string; displayName: string; createdAt: number } | undefined;
  if (!user) return null;

  const summary = db
    .prepare(
      `SELECT COUNT(*) as races, MAX(wpm) as bestWpm, ROUND(AVG(wpm),1) as avgWpm,
              ROUND(AVG(accuracy),1) as avgAccuracy, SUM(CASE WHEN position=1 THEN 1 ELSE 0 END) as wins
       FROM race_results WHERE user_id = ?`
    )
    .get(id) as { races: number; bestWpm: number | null; avgWpm: number | null; avgAccuracy: number | null; wins: number };

  const history = db
    .prepare(
      `SELECT rm.code as roomCode, r.wpm, r.accuracy, r.position, r.time_ms as timeMs, r.finished_at as finishedAt
       FROM race_results r
       JOIN rooms rm ON rm.id = r.room_id
       WHERE r.user_id = ? ORDER BY r.finished_at DESC LIMIT 50`
    )
    .all(id) as AdminUserDetail["history"];

  return {
    ...user,
    summary: {
      races: summary.races || 0,
      bestWpm: summary.bestWpm || 0,
      avgWpm: summary.avgWpm || 0,
      avgAccuracy: summary.avgAccuracy || 0,
      wins: summary.wins || 0,
    },
    history,
  };
}

export function updateUserDisplayName(db: Database.Database, id: string, displayName: string): boolean {
  return db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, id).changes > 0;
}

// Only deletes accounts with zero history — cascading a delete across
// race_results/rooms is a bigger, riskier operation than an admin "remove
// this test account" action needs to be.
export function deleteUser(db: Database.Database, id: string): DeleteUserResult {
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return { ok: false, reason: "not_found" };

  const raceCount = (db.prepare("SELECT COUNT(*) as c FROM race_results WHERE user_id = ?").get(id) as { c: number }).c;
  const roomCount = (db.prepare("SELECT COUNT(*) as c FROM rooms WHERE host_user_id = ?").get(id) as { c: number }).c;
  if (raceCount > 0 || roomCount > 0) return { ok: false, reason: "has_history" };

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return { ok: true };
}

// ---------- Rooms ----------

export function listLiveRooms(roomManager: RoomManager): AdminLiveRoom[] {
  return roomManager.listRooms().map((room: RoomState) => {
    const publicState = roomManager.publicState(room);
    const host = room.participants.get(room.hostUserId);
    return {
      code: room.code,
      status: room.status,
      hostUsername: host?.user.username ?? "?",
      participantCount: room.participants.size,
      spectatorCount: room.spectators.size,
      createdAt: room.createdAt,
      participants: publicState.participants.map((p) => ({
        username: p.username,
        displayName: p.displayName,
        connected: p.connected,
        finished: p.finished,
        progress: p.progress,
        wpm: p.wpm,
        accuracy: p.accuracy,
      })),
    };
  });
}

export function listRoomHistory(
  db: Database.Database,
  opts: { page?: number; pageSize?: number } = {}
): { rows: AdminRoomHistoryRow[]; total: number } & Page {
  const { page, pageSize } = paginationOf(opts);
  const total = (db.prepare("SELECT COUNT(*) as c FROM rooms").get() as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT r.id, r.code, u.username as hostUsername, r.status,
              r.created_at as createdAt, r.started_at as startedAt, r.finished_at as finishedAt,
              t.lang as textLang
       FROM rooms r
       JOIN users u ON u.id = r.host_user_id
       LEFT JOIN texts t ON t.id = r.text_id
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(pageSize, (page - 1) * pageSize) as AdminRoomHistoryRow[];
  return { rows, total, page, pageSize };
}

// ---------- Rankings / results ----------

export function listRankings(db: Database.Database): AdminRankingRow[] {
  return db
    .prepare(
      `SELECT u.id as userId, u.username, u.display_name as displayName,
              MAX(r.wpm) as bestWpm, ROUND(AVG(r.accuracy), 1) as avgAccuracy,
              COUNT(*) as races, SUM(CASE WHEN r.position = 1 THEN 1 ELSE 0 END) as wins
       FROM race_results r
       JOIN users u ON u.id = r.user_id
       GROUP BY r.user_id
       ORDER BY bestWpm DESC
       LIMIT 200`
    )
    .all() as AdminRankingRow[];
}

export function listResults(
  db: Database.Database,
  opts: { page?: number; pageSize?: number } = {}
): { rows: AdminResultRow[]; total: number } & Page {
  const { page, pageSize } = paginationOf(opts);
  const total = (db.prepare("SELECT COUNT(*) as c FROM race_results").get() as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT r.id, rm.code as roomCode, u.username, r.wpm, r.accuracy, r.position,
              r.time_ms as timeMs, r.finished_at as finishedAt
       FROM race_results r
       JOIN users u ON u.id = r.user_id
       JOIN rooms rm ON rm.id = r.room_id
       ORDER BY r.finished_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(pageSize, (page - 1) * pageSize) as AdminResultRow[];
  return { rows, total, page, pageSize };
}

export function deleteResult(db: Database.Database, id: number): boolean {
  return db.prepare("DELETE FROM race_results WHERE id = ?").run(id).changes > 0;
}

// ---------- Texts ----------

export function listTexts(
  db: Database.Database,
  opts: { lang?: string; page?: number; pageSize?: number } = {}
): { rows: AdminTextRow[]; total: number } & Page {
  const { page, pageSize } = paginationOf(opts);
  const where = opts.lang ? "WHERE lang = ?" : "";
  const params = opts.lang ? [opts.lang] : [];
  const total = (db.prepare(`SELECT COUNT(*) as c FROM texts ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT id, content, lang FROM texts ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as AdminTextRow[];
  return { rows, total, page, pageSize };
}

export function createText(db: Database.Database, content: string, lang: string): AdminTextRow {
  const info = db.prepare("INSERT INTO texts (content, lang) VALUES (?, ?)").run(content, lang);
  return { id: Number(info.lastInsertRowid), content, lang };
}

export function updateText(
  db: Database.Database,
  id: number,
  fields: { content?: string; lang?: string }
): boolean {
  const existing = db.prepare("SELECT content, lang FROM texts WHERE id = ?").get(id) as
    | { content: string; lang: string }
    | undefined;
  if (!existing) return false;
  const content = fields.content ?? existing.content;
  const lang = fields.lang ?? existing.lang;
  db.prepare("UPDATE texts SET content = ?, lang = ? WHERE id = ?").run(content, lang, id);
  return true;
}

// A text still referenced by a room (rooms.text_id) can't be deleted — SQLite
// enforces that FK for us; we just translate the failure into a clear reason.
export function deleteText(db: Database.Database, id: number): DeleteTextResult {
  const existing = db.prepare("SELECT id FROM texts WHERE id = ?").get(id);
  if (!existing) return { ok: false, reason: "not_found" };
  try {
    db.prepare("DELETE FROM texts WHERE id = ?").run(id);
    return { ok: true };
  } catch {
    return { ok: false, reason: "in_use" };
  }
}

// ---------- Wiring ----------

export function mountAdmin(
  app: Express,
  db: Database.Database,
  roomManager: RoomManager,
  onLiveRoomClosed: (room: RoomState) => void
): void {
  const auth = createAdminAuthMiddleware();
  if (!auth) {
    console.log("Admin panel disabled (set ADMIN_USERNAME and ADMIN_PASSWORD to enable it).");
    return;
  }

  const adminPublicDir = path.join(process.cwd(), "public", "admin");
  app.use("/admin", auth, express.static(adminPublicDir));

  const api = express.Router();

  api.get("/stats", (_req, res) => res.json(getStats(db, roomManager)));

  api.get("/users", (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    res.json(listUsers(db, { page: Number(req.query.page) || 1, search }));
  });
  api.get("/users/:id", (req, res) => {
    const detail = getUserDetail(db, req.params.id ?? "");
    if (!detail) return res.status(404).json({ error: "not_found" });
    res.json(detail);
  });
  api.patch("/users/:id", (req, res) => {
    const { displayName } = (req.body || {}) as { displayName?: unknown };
    if (typeof displayName !== "string" || !displayName.trim()) {
      return res.status(400).json({ error: "invalid_display_name" });
    }
    const ok = updateUserDisplayName(db, req.params.id ?? "", displayName.trim().slice(0, 40));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  });
  api.delete("/users/:id", (req, res) => {
    const result = deleteUser(db, req.params.id ?? "");
    if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 409).json({ error: result.reason });
    res.json({ ok: true });
  });

  api.get("/rooms/live", (_req, res) => res.json(listLiveRooms(roomManager)));
  api.post("/rooms/live/:code/close", (req, res) => {
    const room = roomManager.getByCode(req.params.code ?? "");
    if (!room) return res.status(404).json({ error: "not_found" });
    roomManager.finishRoom(room);
    onLiveRoomClosed(room);
    res.json({ ok: true });
  });
  api.get("/rooms/history", (req, res) => {
    res.json(listRoomHistory(db, { page: Number(req.query.page) || 1 }));
  });

  api.get("/rankings", (_req, res) => res.json(listRankings(db)));
  api.get("/results", (req, res) => {
    res.json(listResults(db, { page: Number(req.query.page) || 1 }));
  });
  api.delete("/results/:id", (req, res) => {
    const ok = deleteResult(db, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  });

  api.get("/texts", (req, res) => {
    const lang = typeof req.query.lang === "string" ? req.query.lang : undefined;
    res.json(listTexts(db, { page: Number(req.query.page) || 1, lang }));
  });
  api.post("/texts", (req, res) => {
    const { content, lang } = (req.body || {}) as { content?: unknown; lang?: unknown };
    if (typeof content !== "string" || !content.trim() || typeof lang !== "string" || !lang.trim()) {
      return res.status(400).json({ error: "invalid_input" });
    }
    res.json(createText(db, content.trim(), lang.trim().toLowerCase()));
  });
  api.patch("/texts/:id", (req, res) => {
    const { content, lang } = (req.body || {}) as { content?: unknown; lang?: unknown };
    const ok = updateText(db, Number(req.params.id), {
      content: typeof content === "string" ? content.trim() : undefined,
      lang: typeof lang === "string" ? lang.trim().toLowerCase() : undefined,
    });
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  });
  api.delete("/texts/:id", (req, res) => {
    const result = deleteText(db, Number(req.params.id));
    if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 409).json({ error: result.reason });
    res.json({ ok: true });
  });

  app.use("/api/admin", auth, api);

  console.log("Admin panel enabled at /admin");
}
