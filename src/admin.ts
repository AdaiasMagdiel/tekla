import { createHash, timingSafeEqual } from "crypto";
import type { Express, RequestHandler, ErrorRequestHandler } from "express";
import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { nanoid } from "nanoid";
import type { DbAdapter } from "./db.js";
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

export interface AdminCharacterRow {
  id: number;
  name: string;
  imagePath: string;
  createdAt: number;
  usageCount: number;
}

export type DeleteCharacterResult = { ok: true } | { ok: false; reason: "not_found" };

interface Page {
  page: number;
  pageSize: number;
}

function paginationOf(opts: { page?: number; pageSize?: number } = {}): Page {
  return { page: Math.max(1, opts.page ?? 1), pageSize: Math.min(100, Math.max(1, opts.pageSize ?? 25)) };
}

// ---------- Stats ----------

export async function getStats(db: DbAdapter, roomManager: RoomManager): Promise<AdminStats> {
  const totalUsers = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM users"))!.c;
  const totalRoomsEver = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM rooms"))!.c;
  const totalRaces = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM race_results"))!.c;

  const live = roomManager.listRooms();
  const liveParticipants = live.reduce((sum, r) => sum + r.participants.size, 0);
  const liveSpectators = live.reduce((sum, r) => sum + r.spectators.size, 0);

  const textsByLang = await db.all<{ lang: string; count: number }>(
    "SELECT lang, COUNT(*) as count FROM texts GROUP BY lang ORDER BY lang"
  );

  const dateExpr =
    db.driver === "sqlite"
      ? "strftime('%Y-%m-%d', finished_at / 1000, 'unixepoch')"
      : "FROM_UNIXTIME(finished_at / 1000, '%Y-%m-%d')";
  const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const rows = await db.all<{ date: string; count: number }>(
    `SELECT ${dateExpr} as date, COUNT(*) as count
     FROM race_results
     WHERE finished_at >= ?
     GROUP BY date`,
    [since]
  );

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

export async function listUsers(
  db: DbAdapter,
  opts: { search?: string; page?: number; pageSize?: number } = {}
): Promise<{ rows: AdminUserListRow[]; total: number } & Page> {
  const { page, pageSize } = paginationOf(opts);
  const search = (opts.search ?? "").trim();
  const where = search ? "WHERE u.username LIKE ? OR u.display_name LIKE ?" : "";
  const params = search ? [`%${search}%`, `%${search}%`] : [];

  const total = (await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM users u ${where}`, params))!.c;
  const rows = await db.all<AdminUserListRow>(
    `SELECT u.id, u.username, u.display_name as displayName, u.created_at as createdAt,
            (SELECT COUNT(*) FROM race_results r WHERE r.user_id = u.id) as races
     FROM users u
     ${where}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { rows, total, page, pageSize };
}

export async function getUserDetail(db: DbAdapter, id: string): Promise<AdminUserDetail | null> {
  const user = await db.get<{ id: string; username: string; displayName: string; createdAt: number }>(
    "SELECT id, username, display_name as displayName, created_at as createdAt FROM users WHERE id = ?",
    [id]
  );
  if (!user) return null;

  const summary = (await db.get<{
    races: number;
    bestWpm: number | null;
    avgWpm: number | null;
    avgAccuracy: number | null;
    wins: number;
  }>(
    `SELECT COUNT(*) as races, MAX(wpm) as bestWpm, ROUND(AVG(wpm),1) as avgWpm,
            ROUND(AVG(accuracy),1) as avgAccuracy, SUM(CASE WHEN position=1 THEN 1 ELSE 0 END) as wins
     FROM race_results WHERE user_id = ?`,
    [id]
  ))!;

  const history = await db.all<AdminUserDetail["history"][number]>(
    `SELECT rm.code as roomCode, r.wpm, r.accuracy, r.position, r.time_ms as timeMs, r.finished_at as finishedAt
     FROM race_results r
     JOIN rooms rm ON rm.id = r.room_id
     WHERE r.user_id = ? ORDER BY r.finished_at DESC LIMIT 50`,
    [id]
  );

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

export async function updateUserDisplayName(db: DbAdapter, id: string, displayName: string): Promise<boolean> {
  const result = await db.run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, id]);
  return result.changes > 0;
}

// Only deletes accounts with zero history — cascading a delete across
// race_results/rooms is a bigger, riskier operation than an admin "remove
// this test account" action needs to be.
export async function deleteUser(db: DbAdapter, id: string): Promise<DeleteUserResult> {
  const user = await db.get("SELECT id FROM users WHERE id = ?", [id]);
  if (!user) return { ok: false, reason: "not_found" };

  const raceCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM race_results WHERE user_id = ?", [id]))!
    .c;
  const roomCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM rooms WHERE host_user_id = ?", [id]))!.c;
  if (raceCount > 0 || roomCount > 0) return { ok: false, reason: "has_history" };

  await db.run("DELETE FROM users WHERE id = ?", [id]);
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

export async function listRoomHistory(
  db: DbAdapter,
  opts: { page?: number; pageSize?: number } = {}
): Promise<{ rows: AdminRoomHistoryRow[]; total: number } & Page> {
  const { page, pageSize } = paginationOf(opts);
  const total = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM rooms"))!.c;
  const rows = await db.all<AdminRoomHistoryRow>(
    `SELECT r.id, r.code, u.username as hostUsername, r.status,
            r.created_at as createdAt, r.started_at as startedAt, r.finished_at as finishedAt,
            t.lang as textLang
     FROM rooms r
     JOIN users u ON u.id = r.host_user_id
     LEFT JOIN texts t ON t.id = r.text_id
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize]
  );
  return { rows, total, page, pageSize };
}

// ---------- Rankings / results ----------

export async function listRankings(db: DbAdapter): Promise<AdminRankingRow[]> {
  return db.all<AdminRankingRow>(
    `SELECT u.id as userId, u.username, u.display_name as displayName,
            MAX(r.wpm) as bestWpm, ROUND(AVG(r.accuracy), 1) as avgAccuracy,
            COUNT(*) as races, SUM(CASE WHEN r.position = 1 THEN 1 ELSE 0 END) as wins
     FROM race_results r
     JOIN users u ON u.id = r.user_id
     GROUP BY r.user_id
     ORDER BY bestWpm DESC
     LIMIT 200`
  );
}

export async function listResults(
  db: DbAdapter,
  opts: { page?: number; pageSize?: number } = {}
): Promise<{ rows: AdminResultRow[]; total: number } & Page> {
  const { page, pageSize } = paginationOf(opts);
  const total = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM race_results"))!.c;
  const rows = await db.all<AdminResultRow>(
    `SELECT r.id, rm.code as roomCode, u.username, r.wpm, r.accuracy, r.position,
            r.time_ms as timeMs, r.finished_at as finishedAt
     FROM race_results r
     JOIN users u ON u.id = r.user_id
     JOIN rooms rm ON rm.id = r.room_id
     ORDER BY r.finished_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize]
  );
  return { rows, total, page, pageSize };
}

export async function deleteResult(db: DbAdapter, id: number): Promise<boolean> {
  const result = await db.run("DELETE FROM race_results WHERE id = ?", [id]);
  return result.changes > 0;
}

// ---------- Texts ----------

export async function listTexts(
  db: DbAdapter,
  opts: { lang?: string; page?: number; pageSize?: number } = {}
): Promise<{ rows: AdminTextRow[]; total: number } & Page> {
  const { page, pageSize } = paginationOf(opts);
  const where = opts.lang ? "WHERE lang = ?" : "";
  const params = opts.lang ? [opts.lang] : [];
  const total = (await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM texts ${where}`, params))!.c;
  const rows = await db.all<AdminTextRow>(
    `SELECT id, content, lang FROM texts ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { rows, total, page, pageSize };
}

export async function createText(db: DbAdapter, content: string, lang: string): Promise<AdminTextRow> {
  const info = await db.run("INSERT INTO texts (content, lang) VALUES (?, ?)", [content, lang]);
  return { id: info.lastInsertRowid, content, lang };
}

export async function updateText(
  db: DbAdapter,
  id: number,
  fields: { content?: string; lang?: string }
): Promise<boolean> {
  const existing = await db.get<{ content: string; lang: string }>(
    "SELECT content, lang FROM texts WHERE id = ?",
    [id]
  );
  if (!existing) return false;
  const content = fields.content ?? existing.content;
  const lang = fields.lang ?? existing.lang;
  await db.run("UPDATE texts SET content = ?, lang = ? WHERE id = ?", [content, lang, id]);
  return true;
}

// A text still referenced by a room (rooms.text_id) can't be deleted — the
// FK constraint rejects the delete on both drivers; we just translate that
// failure into a clear reason.
export async function deleteText(db: DbAdapter, id: number): Promise<DeleteTextResult> {
  const existing = await db.get("SELECT id FROM texts WHERE id = ?", [id]);
  if (!existing) return { ok: false, reason: "not_found" };
  try {
    await db.run("DELETE FROM texts WHERE id = ?", [id]);
    return { ok: true };
  } catch {
    return { ok: false, reason: "in_use" };
  }
}

// Deletes one by one (not a single `DELETE ... WHERE id IN (...)`) so a text
// still referenced by a room is skipped instead of failing the whole batch.
export async function deleteTexts(
  db: DbAdapter,
  ids: number[]
): Promise<{ deleted: number[]; skipped: { id: number; reason: "not_found" | "in_use" }[] }> {
  const deleted: number[] = [];
  const skipped: { id: number; reason: "not_found" | "in_use" }[] = [];
  for (const id of ids) {
    const result = await deleteText(db, id);
    if (result.ok) deleted.push(id);
    else skipped.push({ id, reason: result.reason });
  }
  return { deleted, skipped };
}

export async function listTextIds(db: DbAdapter, lang?: string): Promise<number[]> {
  const where = lang ? "WHERE lang = ?" : "";
  const params = lang ? [lang] : [];
  const rows = await db.all<{ id: number }>(`SELECT id FROM texts ${where}`, params);
  return rows.map((r) => r.id);
}

// ---------- Characters ----------

export async function listCharacters(
  db: DbAdapter,
  opts: { page?: number; pageSize?: number } = {}
): Promise<{ rows: AdminCharacterRow[]; total: number } & Page> {
  const { page, pageSize } = paginationOf(opts);
  const total = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM characters"))!.c;
  const rows = await db.all<AdminCharacterRow>(
    `SELECT c.id, c.name, c.image_path as imagePath, c.created_at as createdAt,
            (SELECT COUNT(*) FROM users u WHERE u.character_id = c.id) as usageCount
     FROM characters c
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize]
  );
  return { rows, total, page, pageSize };
}

export async function createCharacter(db: DbAdapter, name: string, imagePath: string): Promise<AdminCharacterRow> {
  const now = Date.now();
  const info = await db.run("INSERT INTO characters (name, image_path, created_at) VALUES (?, ?, ?)", [
    name,
    imagePath,
    now,
  ]);
  return { id: info.lastInsertRowid, name, imagePath, createdAt: now, usageCount: 0 };
}

export async function getCharacter(db: DbAdapter, id: number): Promise<{ imagePath: string } | undefined> {
  return db.get<{ imagePath: string }>("SELECT image_path as imagePath FROM characters WHERE id = ?", [id]);
}

export async function updateCharacter(
  db: DbAdapter,
  id: number,
  fields: { name?: string; imagePath?: string }
): Promise<boolean> {
  const existing = await db.get<{ name: string; imagePath: string }>(
    "SELECT name, image_path as imagePath FROM characters WHERE id = ?",
    [id]
  );
  if (!existing) return false;
  const name = fields.name ?? existing.name;
  const imagePath = fields.imagePath ?? existing.imagePath;
  await db.run("UPDATE characters SET name = ?, image_path = ? WHERE id = ?", [name, imagePath, id]);
  return true;
}

export async function deleteCharacter(db: DbAdapter, id: number): Promise<DeleteCharacterResult> {
  const existing = await db.get("SELECT id FROM characters WHERE id = ?", [id]);
  if (!existing) return { ok: false, reason: "not_found" };
  await db.run("DELETE FROM characters WHERE id = ?", [id]);
  return { ok: true };
}

// ---------- Wiring ----------

export function mountAdmin(
  app: Express,
  db: DbAdapter,
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

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "characters");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${nanoid(16)}${ext}`);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
        cb(new Error("invalid_file_type"));
        return;
      }
      cb(null, true);
    },
  });

  const api = express.Router();

  api.get("/stats", async (_req, res) => res.json(await getStats(db, roomManager)));

  api.get("/users", async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    res.json(await listUsers(db, { page: Number(req.query.page) || 1, search }));
  });
  api.get("/users/:id", async (req, res) => {
    const detail = await getUserDetail(db, req.params.id ?? "");
    if (!detail) return res.status(404).json({ error: "not_found" });
    res.json(detail);
  });
  api.patch("/users/:id", async (req, res) => {
    const { displayName } = (req.body || {}) as { displayName?: unknown };
    if (typeof displayName !== "string" || !displayName.trim()) {
      return res.status(400).json({ error: "invalid_display_name" });
    }
    const ok = await updateUserDisplayName(db, req.params.id ?? "", displayName.trim().slice(0, 40));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  });
  api.delete("/users/:id", async (req, res) => {
    const result = await deleteUser(db, req.params.id ?? "");
    if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 409).json({ error: result.reason });
    res.json({ ok: true });
  });

  api.get("/rooms/live", (_req, res) => res.json(listLiveRooms(roomManager)));
  api.post("/rooms/live/:code/close", async (req, res) => {
    const room = roomManager.getByCode(req.params.code ?? "");
    if (!room) return res.status(404).json({ error: "not_found" });
    await roomManager.finishRoom(room);
    onLiveRoomClosed(room);
    res.json({ ok: true });
  });
  api.get("/rooms/history", async (req, res) => {
    res.json(await listRoomHistory(db, { page: Number(req.query.page) || 1 }));
  });

  api.get("/rankings", async (_req, res) => res.json(await listRankings(db)));
  api.get("/results", async (req, res) => {
    res.json(await listResults(db, { page: Number(req.query.page) || 1 }));
  });
  api.delete("/results/:id", async (req, res) => {
    const ok = await deleteResult(db, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  });

  api.get("/texts", async (req, res) => {
    const lang = typeof req.query.lang === "string" ? req.query.lang : undefined;
    res.json(await listTexts(db, { page: Number(req.query.page) || 1, lang }));
  });
  api.post("/texts", async (req, res) => {
    const { content, lang } = (req.body || {}) as { content?: unknown; lang?: unknown };
    if (typeof content !== "string" || !content.trim() || typeof lang !== "string" || !lang.trim()) {
      return res.status(400).json({ error: "invalid_input" });
    }
    res.json(await createText(db, content.trim(), lang.trim().toLowerCase()));
  });
  api.patch("/texts/:id", async (req, res) => {
    const { content, lang } = (req.body || {}) as { content?: unknown; lang?: unknown };
    const ok = await updateText(db, Number(req.params.id), {
      content: typeof content === "string" ? content.trim() : undefined,
      lang: typeof lang === "string" ? lang.trim().toLowerCase() : undefined,
    });
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  });
  api.delete("/texts/:id", async (req, res) => {
    const result = await deleteText(db, Number(req.params.id));
    if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 409).json({ error: result.reason });
    res.json({ ok: true });
  });
  // Bulk delete: either { ids: number[] } for a specific selection, or
  // { all: true, lang? } to wipe everything (optionally scoped to a
  // language, matching whatever filter is active in the texts.html table).
  // Texts still referenced by a room are skipped, not failed outright.
  api.delete("/texts", async (req, res) => {
    const { ids, all, lang } = (req.body || {}) as { ids?: unknown; all?: unknown; lang?: unknown };
    let targetIds: number[];
    if (all === true) {
      targetIds = await listTextIds(db, typeof lang === "string" && lang.trim() ? lang.trim().toLowerCase() : undefined);
    } else if (Array.isArray(ids) && ids.length > 0 && ids.every((x) => typeof x === "number" && Number.isInteger(x))) {
      targetIds = ids;
    } else {
      return res.status(400).json({ error: "invalid_input" });
    }
    res.json(await deleteTexts(db, targetIds));
  });

  api.get("/characters", async (req, res) => {
    res.json(await listCharacters(db, { page: Number(req.query.page) || 1 }));
  });
  api.post("/characters", upload.single("image"), async (req, res) => {
    const { name } = (req.body || {}) as { name?: unknown };
    if (typeof name !== "string" || !name.trim()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "invalid_input" });
    }
    if (!req.file) return res.status(400).json({ error: "missing_image" });
    const imagePath = `/uploads/characters/${req.file.filename}`;
    res.json(await createCharacter(db, name.trim().slice(0, 40), imagePath));
  });
  api.patch("/characters/:id", upload.single("image"), async (req, res) => {
    const { name } = (req.body || {}) as { name?: unknown };
    const id = Number(req.params.id);
    const imagePath = req.file ? `/uploads/characters/${req.file.filename}` : undefined;
    const previous = req.file ? await getCharacter(db, id) : undefined;
    const ok = await updateCharacter(db, id, {
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : undefined,
      imagePath,
    });
    if (!ok) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "not_found" });
    }
    if (previous) fs.unlink(path.join(process.cwd(), "public", previous.imagePath), () => {});
    res.json({ ok: true });
  });
  api.delete("/characters/:id", async (req, res) => {
    const id = Number(req.params.id);
    const existing = await getCharacter(db, id);
    const result = await deleteCharacter(db, id);
    if (!result.ok) return res.status(404).json({ error: result.reason });
    if (existing) fs.unlink(path.join(process.cwd(), "public", existing.imagePath), () => {});
    res.json({ ok: true });
  });

  const uploadErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "file_too_large" });
    }
    if (err.message === "invalid_file_type") {
      return res.status(400).json({ error: "invalid_file_type" });
    }
    next(err);
  };
  api.use(uploadErrorHandler);

  app.use("/api/admin", auth, api);

  console.log("Admin panel enabled at /admin");
}
