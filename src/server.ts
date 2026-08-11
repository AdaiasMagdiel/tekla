import express, { type Request, type Response } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync } from "fs";
import path from "path";

import { createDb } from "./db.js";
import { createUser, getUserByUsername, isValidUsername } from "./users.js";
import {
  attachSessionUser,
  requireAuth,
  hashPassword,
  verifyPassword,
  isValidPassword,
  createSession,
  deleteSession,
  setSessionCookie,
  clearSessionCookie,
  sessionTokenFromRequest,
  resolveSessionUserFromCookieHeader,
  publicUser,
} from "./auth.js";
import { RoomManager, type RoomState, type ChatMessage } from "./rooms.js";
import { DIFFICULTIES, type Difficulty } from "./types.js";
import { collectSeedFiles, parseSeedFile, importSeedRows } from "./seedTexts.js";
import { mountAdmin, createAdminAuthMiddleware } from "./admin.js";
import { mountTextsApi } from "./textsApi.js";

const db = await createDb();

let textCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM texts"))!.c;

// Opt-in only (unset by default, so local `npm start` behaves exactly as
// before): if AUTO_SEED_DIR is set and the database is empty, load whatever
// .json/.txt files are in that directory before serving traffic. Meant for
// container deployments that want a working app on first boot without a
// separate manual step — the CLI (`npm run seed`) still works the same way
// afterwards to load different texts or add more.
if (textCount === 0 && process.env.AUTO_SEED_DIR) {
  try {
    const files = collectSeedFiles([process.env.AUTO_SEED_DIR]);
    const rows = files.flatMap((file) =>
      parseSeedFile(file, null).filter((t) => t.content && t.content.trim())
    );
    if (rows.length > 0) {
      const result = await importSeedRows(db, rows);
      console.log(
        `Auto-seeded ${result.imported} race text(s) from ${process.env.AUTO_SEED_DIR} (database was empty).`
      );
      textCount = result.total;
    }
  } catch (err) {
    console.error(`Auto-seed from ${process.env.AUTO_SEED_DIR} failed:`, (err as Error).message);
  }
}

if (textCount === 0) {
  console.warn(
    "No race texts in the database yet. Run `npm run seed -- seeds/` to load the example PT/EN sets, or point it at your own file."
  );
}

const SUPPORTED_LANGS = ["pt", "en"];
// process.cwd(), not __dirname: the app always runs from the project root
// (npm scripts, Docker's WORKDIR), and compiled output under dist/ sits one
// level deeper than src/ did, which would otherwise throw this off.
const publicDir = path.join(process.cwd(), "public");

const app = express();
app.use(express.json());
app.use(attachSessionUser(db));

// Cache busting: every local /css, /js and /img reference inside each HTML
// page gets a `?v=<boot time>` query string appended, and those asset
// responses are served with a long, immutable Cache-Control below. The HTML
// itself is served with Cache-Control: no-cache (always revalidated), so a
// deploy (new process boot -> new ASSET_VERSION -> new query strings baked
// into the HTML) reaches every visitor on their next request without them
// needing to hard-refresh. External URLs (CDN fonts/icons) are untouched.
const ASSET_VERSION = String(Date.now());
const ASSET_URL_RE = /((?:src|href)=")(\/(?:css|js|img)\/[^"]+)(")/g;

function renderPage(file: string): string {
  const html = readFileSync(path.join(publicDir, file), "utf-8");
  return html.replace(ASSET_URL_RE, (_match, open, url, close) => `${open}${url}?v=${ASSET_VERSION}${close}`);
}

const pageCache = new Map<string, string>();
function sendPage(res: Response, file: string): void {
  let html = pageCache.get(file);
  if (!html) {
    html = renderPage(file);
    pageCache.set(file, html);
  }
  res.set("Cache-Control", "no-cache").type("html").send(html);
}

// No .html in any URL the app generates, at the root or under /pt / /en.
// /room, /mirror, and /profile also get a dynamic :code/:username segment
// for pretty room/mirror/profile links.
const PAGES: Record<string, string> = {
  "": "index.html",
  ranking: "ranking.html",
  profile: "profile.html",
  mirror: "mirror.html",
};

for (const prefix of ["", ...SUPPORTED_LANGS.map((l) => `/${l}`)]) {
  for (const [clean, file] of Object.entries(PAGES)) {
    app.get(clean ? `${prefix}/${clean}` : prefix || "/", (_req, res) => sendPage(res, file));
    app.get(`${prefix}/${file}`, (_req, res) => sendPage(res, file));
  }
  app.get(`${prefix}/room/:code`, (_req, res) => sendPage(res, "room.html"));
  app.get(`${prefix}/mirror/:code`, (_req, res) => sendPage(res, "mirror.html"));
  app.get(`${prefix}/profile/:username`, (_req, res) => sendPage(res, "profile.html"));
}

// Must run before the general static mount below: public/admin/ lives inside
// publicDir, so without this gate the static middleware would serve those
// HTML/JS/CSS files to anyone before mountAdmin()'s own auth-gated /admin
// mount (registered later, once RoomManager exists) ever gets a chance to.
// When ADMIN_USERNAME/PASSWORD aren't set, block /admin outright (404) rather
// than falling through to the static middleware unauthenticated.
const adminAuth = createAdminAuthMiddleware();
app.use("/admin", adminAuth ?? ((_req, res) => res.status(404).end()));

app.use(
  express.static(publicDir, {
    index: false, // "/" is handled above, not by static's default index file
    setHeaders: (res, filePath) => {
      // Safe to cache forever: the URL only stays the same while the
      // content does, since the query string changes on every deploy.
      if (/\.(css|js)$/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);

const rooms = new RoomManager(db);

async function getCharacterImagePath(characterId: number): Promise<string | null> {
  const row = await db.get<{ imagePath: string }>("SELECT image_path as imagePath FROM characters WHERE id = ?", [
    characterId,
  ]);
  return row?.imagePath ?? null;
}

// ---------- REST API ----------
// Error responses use short codes (not localized strings) — the client maps
// them to the active UI language via public/i18n/<lang>.json.

app.post("/api/auth/register", async (req: Request, res: Response) => {
  const { username, displayName, password } = (req.body || {}) as {
    username?: unknown;
    displayName?: unknown;
    password?: unknown;
  };
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "invalid_username" });
  }
  const name = (typeof displayName === "string" ? displayName : "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "missing_display_name" });
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "invalid_password" });
  }

  const existing = await getUserByUsername(db, username);
  if (existing) return res.status(409).json({ error: "username_taken" });

  const user = await createUser(db, username, name, hashPassword(password));
  const token = await createSession(db, user.id);
  setSessionCookie(res, token);
  res.status(201).json(publicUser(user, null));
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { username, password } = (req.body || {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "invalid_credentials" });
  }

  const user = await getUserByUsername(db, username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const token = await createSession(db, user.id);
  setSessionCookie(res, token);
  res.json(publicUser(user, user.character_id ? await getCharacterImagePath(user.character_id) : null));
});

app.post("/api/auth/logout", async (req: Request, res: Response) => {
  const token = sessionTokenFromRequest(req);
  if (token) await deleteSession(db, token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "not_authenticated" });
  const characterImagePath = req.user.character_id ? await getCharacterImagePath(req.user.character_id) : null;
  res.json(publicUser(req.user, characterImagePath));
});

app.get("/api/characters", async (_req: Request, res: Response) => {
  const rows = await db.all("SELECT id, name, image_path as imagePath FROM characters ORDER BY name");
  res.json(rows);
});

app.post("/api/me/character", requireAuth(), async (req: Request, res: Response) => {
  const { characterId } = (req.body || {}) as { characterId?: unknown };
  const user = req.user!;

  if (characterId === null) {
    await db.run("UPDATE users SET character_id = NULL WHERE id = ?", [user.id]);
    return res.json({ characterId: null });
  }
  if (typeof characterId !== "number" || !Number.isInteger(characterId)) {
    return res.status(400).json({ error: "invalid_character" });
  }
  const imagePath = await getCharacterImagePath(characterId);
  if (imagePath === null) return res.status(400).json({ error: "invalid_character" });

  await db.run("UPDATE users SET character_id = ? WHERE id = ?", [characterId, user.id]);
  res.json({ characterId, characterImagePath: imagePath });
});

app.post("/api/rooms", requireAuth(), async (req: Request, res: Response) => {
  const { lang } = (req.body || {}) as { lang?: string };
  const room = await rooms.createRoom(req.user!, SUPPORTED_LANGS.includes(lang ?? "") ? lang : null);
  res.json({ code: room.code });
});

app.get("/api/rooms/:code", (req: Request, res: Response) => {
  const room = rooms.getByCode(String(req.params.code ?? ""));
  if (!room) return res.status(404).json({ error: "room_not_found" });
  res.json(rooms.publicState(room));
});

app.post("/api/rooms/:code/join", requireAuth(), async (req: Request, res: Response) => {
  const room = rooms.getByCode(String(req.params.code ?? ""));
  if (!room) return res.status(404).json({ error: "room_not_found" });
  if (room.status !== "waiting") {
    return res.status(409).json({ error: "race_already_started" });
  }
  await rooms.addParticipant(room, req.user!);
  res.json(rooms.publicState(room));
});

app.get("/api/leaderboard", async (_req: Request, res: Response) => {
  const rows = await db.all(
    `SELECT u.username, u.display_name as displayName,
            MAX(r.wpm) as bestWpm,
            ROUND(AVG(r.accuracy), 1) as avgAccuracy,
            COUNT(*) as races,
            SUM(CASE WHEN r.position = 1 THEN 1 ELSE 0 END) as wins
     FROM race_results r
     JOIN users u ON u.id = r.user_id
     GROUP BY r.user_id
     ORDER BY bestWpm DESC
     LIMIT 50`
  );
  res.json(rows);
});

app.get("/api/users/:username/stats", async (req: Request, res: Response) => {
  const user = await getUserByUsername(db, String(req.params.username ?? ""));
  if (!user) return res.status(404).json({ error: "user_not_found" });

  const summary = (await db.get<{
    races: number;
    bestWpm: number | null;
    avgWpm: number | null;
    avgAccuracy: number | null;
    wins: number;
  }>(
    `SELECT COUNT(*) as races,
            MAX(wpm) as bestWpm,
            ROUND(AVG(wpm), 1) as avgWpm,
            ROUND(AVG(accuracy), 1) as avgAccuracy,
            SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END) as wins
     FROM race_results WHERE user_id = ?`,
    [user.id]
  ))!;

  const history = await db.all(
    `SELECT r.room_id as roomCode, r.wpm, r.accuracy, r.position, r.time_ms as timeMs, r.finished_at as finishedAt,
            (SELECT COUNT(*) FROM race_results r2 WHERE r2.room_id = r.room_id) as totalRacers
     FROM race_results r
     WHERE r.user_id = ?
     ORDER BY r.finished_at DESC
     LIMIT 25`,
    [user.id]
  );

  res.json({
    username: user.username,
    displayName: user.display_name,
    summary: {
      races: summary.races || 0,
      bestWpm: summary.bestWpm || 0,
      avgWpm: summary.avgWpm || 0,
      avgAccuracy: summary.avgAccuracy || 0,
      wins: summary.wins || 0,
      winRate: summary.races ? Math.round((summary.wins / summary.races) * 100) : 0,
    },
    history,
  });
});

// ---------- WebSocket ----------

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

type ServerMessage =
  | { type: "error"; error: string }
  | { type: "state"; room: ReturnType<RoomManager["publicState"]> }
  | { type: "countdown"; n: number }
  | { type: "go"; text: string }
  | { type: "progress"; room: ReturnType<RoomManager["publicState"]> }
  | { type: "finish"; room: ReturnType<RoomManager["publicState"]> }
  | { type: "chat_history"; messages: ChatMessage[] }
  | { type: "chat"; message: ChatMessage };

function broadcast(room: RoomState, msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const p of room.participants.values()) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
  for (const ws of room.spectators) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function sendState(room: RoomState): void {
  broadcast(room, { type: "state", room: rooms.publicState(room) });
}

async function maybeFinishRoom(room: RoomState): Promise<void> {
  const all = [...room.participants.values()];
  const active = all.filter((p) => p.connected);
  if (active.length > 0 && active.every((p) => p.finished)) {
    await rooms.finishRoom(room);
    broadcast(room, { type: "finish", room: rooms.publicState(room) });
  }
}

wss.on("connection", async (ws: WebSocket, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const code = (url.searchParams.get("room") || "").toUpperCase();
  const isSpectator = url.searchParams.get("spectator") === "1";

  const room = rooms.getByCode(code);
  if (!room) {
    ws.send(JSON.stringify({ type: "error", error: "room_not_found" } satisfies ServerMessage));
    ws.close();
    return;
  }

  // Read-only "mirror" viewers (big screens): no user, no car, just state.
  if (isSpectator) {
    rooms.addSpectator(room, ws);
    ws.send(JSON.stringify({ type: "state", room: rooms.publicState(room) } satisfies ServerMessage));
    ws.send(JSON.stringify({ type: "chat_history", messages: room.chat } satisfies ServerMessage));
    ws.on("close", () => rooms.removeSpectator(room, ws));
    return;
  }

  // Identity comes from the session cookie sent on the WS handshake, not a
  // client-supplied userId — otherwise anyone could join/type as anyone.
  const user = await resolveSessionUserFromCookieHeader(db, req.headers.cookie);
  if (!user) {
    ws.send(JSON.stringify({ type: "error", error: "invalid_user" } satisfies ServerMessage));
    ws.close();
    return;
  }

  const participant = await rooms.addParticipant(room, user);
  participant.ws = ws;
  participant.connected = true;

  sendState(room);
  ws.send(JSON.stringify({ type: "chat_history", messages: room.chat } satisfies ServerMessage));

  ws.on("message", async (raw) => {
    try {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "chat") {
        const message = rooms.postChatMessage(room, user, String(msg.text ?? ""));
        if (message) broadcast(room, { type: "chat", message });
        return;
      }

      if (msg.type === "restart") {
        if (user.id !== room.hostUserId) return;
        if (room.status !== "finished") return;
        await rooms.resetRoom(room);
        sendState(room);
        return;
      }

      if (msg.type === "start") {
        if (user.id !== room.hostUserId) return;
        if (room.status !== "waiting") return;

        const { difficulty } = (msg || {}) as { difficulty?: unknown };
        const chosenDifficulty: Difficulty | null =
          typeof difficulty === "string" && (DIFFICULTIES as string[]).includes(difficulty)
            ? (difficulty as Difficulty)
            : null;
        await rooms.pickTextForStart(room, chosenDifficulty);
        if (!room.text) {
          ws.send(JSON.stringify({ type: "error", error: "no_race_texts" } satisfies ServerMessage));
          return;
        }

        rooms.startCountdown(
          room,
          (n) => broadcast(room, { type: "countdown", n }),
          (text) => {
            broadcast(room, { type: "go", text });
            // Keeps PPM/precisão/tempo ticking for everyone (racers + mirror
            // spectators) even during pauses when nobody is actively typing.
            rooms.startRaceTicker(room, () => {
              broadcast(room, { type: "progress", room: rooms.publicState(room) });
            });
          }
        );
        sendState(room);
        return;
      }

      if (msg.type === "typing") {
        if (room.status !== "racing") return;
        const p = room.participants.get(user.id);
        if (!p || p.finished) return;

        const target = room.text!.content;
        const value = String(msg.value ?? "").slice(0, target.length + 20);
        const prevLen = p.typed.length;

        if (value.length > prevLen) {
          for (let i = prevLen; i < value.length; i++) {
            p.keystrokes++;
            if (target[i] === value[i]) p.correctKeystrokes++;
          }
        }
        p.typed = value;
        p.correctLen = rooms.computeProgress(target, value);

        // Every in-memory guard below (`p.finished`, `p.position`,
        // `p.finishTimeMs`) is set synchronously, before the only `await` in
        // this branch — so a second "typing" message for the same
        // connection arriving while the INSERT is still in flight (real
        // network latency under MySQL) hits the `if (!p || p.finished)
        // return;` guard above and is dropped, instead of double-processing
        // the finish.
        if (p.correctLen === target.length && !p.finished) {
          p.finished = true;
          p.finishTimeMs = Date.now() - room.startedAt!;
          const finishedCount = [...room.participants.values()].filter((x) => x.finished).length;
          p.position = finishedCount;

          const { wpm, accuracy } = rooms.liveStats(room, p);

          await db.run(
            `INSERT INTO race_results (room_id, user_id, wpm, accuracy, position, time_ms, finished_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [room.id, user.id, wpm, accuracy, p.position, p.finishTimeMs, Date.now()]
          );

          // Once someone wins, give stragglers a grace period before the race auto-closes.
          if (p.position === 1 && !room.graceTimer) {
            room.graceTimer = setTimeout(async () => {
              try {
                room.graceTimer = null;
                if (room.status === "racing") {
                  await rooms.finishRoom(room);
                  broadcast(room, { type: "finish", room: rooms.publicState(room) });
                }
              } catch (err) {
                console.error("grace-period finish failed:", err);
              }
            }, 60000);
          }
        }

        broadcast(room, { type: "progress", room: rooms.publicState(room) });
        await maybeFinishRoom(room);
        return;
      }
    } catch (err) {
      console.error("ws message handling failed:", err);
    }
  });

  ws.on("close", async () => {
    try {
      const p = room.participants.get(user.id);
      if (p) {
        p.connected = false;
        p.ws = null;
      }
      if (room.status === "waiting") {
        rooms.removeParticipant(room, user.id);
      }
      await rooms.maybeTransferHost(room);
      sendState(room);
      if (room.status === "racing") await maybeFinishRoom(room);
      if (room.participants.size === 0) rooms.destroyRoom(room.id);
    } catch (err) {
      console.error("ws close handling failed:", err);
    }
  });
});

// Enabled only if ADMIN_USERNAME/ADMIN_PASSWORD are both set — see admin.ts.
mountAdmin(
  app,
  db,
  rooms,
  (room) => broadcast(room, { type: "finish", room: rooms.publicState(room) }),
  (room) => sendState(room)
);

// Enabled only if TEXTS_API_KEY is set — see textsApi.ts.
mountTextsApi(app, db);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tekla rodando em http://localhost:${PORT}`);
});
