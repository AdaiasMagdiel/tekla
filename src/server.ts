import express, { type Request, type Response } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync } from "fs";
import path from "path";

import { createDb, defaultDbPath } from "./db.js";
import { createUser, getUserByUsername, getUserById, isValidUsername } from "./users.js";
import { RoomManager, type RoomState } from "./rooms.js";
import { collectSeedFiles, parseSeedFile, importSeedRows } from "./seedTexts.js";
import { mountAdmin, createAdminAuthMiddleware } from "./admin.js";

const db = createDb(process.env.DATABASE_PATH || defaultDbPath());

let textCount = (db.prepare("SELECT COUNT(*) as c FROM texts").get() as { c: number }).c;

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
      const result = importSeedRows(db, rows);
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

// ---------- REST API ----------
// Error responses use short codes (not localized strings) — the client maps
// them to the active UI language via public/i18n/<lang>.json.

app.post("/api/users", (req: Request, res: Response) => {
  const { username, displayName } = (req.body || {}) as { username?: unknown; displayName?: unknown };
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "invalid_username" });
  }
  const name = (typeof displayName === "string" ? displayName : "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "missing_display_name" });

  const existing = getUserByUsername(db, username);
  if (existing) {
    return res.json({
      id: existing.id,
      username: existing.username,
      displayName: existing.display_name,
    });
  }
  const user = createUser(db, username, name);
  res.json({ id: user.id, username: user.username, displayName: user.display_name });
});

app.post("/api/rooms", (req: Request, res: Response) => {
  const { userId, lang } = (req.body || {}) as { userId?: string; lang?: string };
  const user = getUserById(db, userId ?? "");
  if (!user) return res.status(401).json({ error: "invalid_user" });
  const room = rooms.createRoom(user, SUPPORTED_LANGS.includes(lang ?? "") ? lang : null);
  res.json({ code: room.code });
});

app.get("/api/rooms/:code", (req: Request, res: Response) => {
  const room = rooms.getByCode(String(req.params.code ?? ""));
  if (!room) return res.status(404).json({ error: "room_not_found" });
  res.json(rooms.publicState(room));
});

app.post("/api/rooms/:code/join", (req: Request, res: Response) => {
  const { userId } = (req.body || {}) as { userId?: string };
  const user = getUserById(db, userId ?? "");
  if (!user) return res.status(401).json({ error: "invalid_user" });
  const room = rooms.getByCode(String(req.params.code ?? ""));
  if (!room) return res.status(404).json({ error: "room_not_found" });
  if (room.status !== "waiting") {
    return res.status(409).json({ error: "race_already_started" });
  }
  rooms.addParticipant(room, user);
  res.json(rooms.publicState(room));
});

app.get("/api/leaderboard", (_req: Request, res: Response) => {
  const rows = db
    .prepare(
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
    )
    .all();
  res.json(rows);
});

app.get("/api/users/:username/stats", (req: Request, res: Response) => {
  const user = getUserByUsername(db, String(req.params.username ?? ""));
  if (!user) return res.status(404).json({ error: "user_not_found" });

  const summary = db
    .prepare(
      `SELECT COUNT(*) as races,
              MAX(wpm) as bestWpm,
              ROUND(AVG(wpm), 1) as avgWpm,
              ROUND(AVG(accuracy), 1) as avgAccuracy,
              SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END) as wins
       FROM race_results WHERE user_id = ?`
    )
    .get(user.id) as {
    races: number;
    bestWpm: number | null;
    avgWpm: number | null;
    avgAccuracy: number | null;
    wins: number;
  };

  const history = db
    .prepare(
      `SELECT r.room_id as roomCode, r.wpm, r.accuracy, r.position, r.time_ms as timeMs, r.finished_at as finishedAt,
              (SELECT COUNT(*) FROM race_results r2 WHERE r2.room_id = r.room_id) as totalRacers
       FROM race_results r
       WHERE r.user_id = ?
       ORDER BY r.finished_at DESC
       LIMIT 25`
    )
    .all(user.id);

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
  | { type: "finish"; room: ReturnType<RoomManager["publicState"]> };

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

function maybeFinishRoom(room: RoomState): void {
  const all = [...room.participants.values()];
  const active = all.filter((p) => p.connected);
  if (active.length > 0 && active.every((p) => p.finished)) {
    rooms.finishRoom(room);
    broadcast(room, { type: "finish", room: rooms.publicState(room) });
  }
}

wss.on("connection", (ws: WebSocket, req) => {
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
    ws.on("close", () => rooms.removeSpectator(room, ws));
    return;
  }

  const userId = url.searchParams.get("userId");
  const user = getUserById(db, userId ?? "");
  if (!user) {
    ws.send(JSON.stringify({ type: "error", error: "invalid_user" } satisfies ServerMessage));
    ws.close();
    return;
  }

  const participant = rooms.addParticipant(room, user);
  participant.ws = ws;
  participant.connected = true;

  sendState(room);

  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "restart") {
      if (user.id !== room.hostUserId) return;
      if (room.status !== "finished") return;
      rooms.resetRoom(room);
      sendState(room);
      return;
    }

    if (msg.type === "start") {
      if (user.id !== room.hostUserId) return;
      if (room.status !== "waiting") return;
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

      if (p.correctLen === target.length && !p.finished) {
        p.finished = true;
        p.finishTimeMs = Date.now() - room.startedAt!;
        const finishedCount = [...room.participants.values()].filter((x) => x.finished).length;
        p.position = finishedCount;

        const { wpm, accuracy } = rooms.liveStats(room, p);

        db.prepare(
          `INSERT INTO race_results (room_id, user_id, wpm, accuracy, position, time_ms, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(room.id, user.id, wpm, accuracy, p.position, p.finishTimeMs, Date.now());

        // Once someone wins, give stragglers a grace period before the race auto-closes.
        if (p.position === 1 && !room.graceTimer) {
          room.graceTimer = setTimeout(() => {
            room.graceTimer = null;
            if (room.status === "racing") {
              rooms.finishRoom(room);
              broadcast(room, { type: "finish", room: rooms.publicState(room) });
            }
          }, 60000);
        }
      }

      broadcast(room, { type: "progress", room: rooms.publicState(room) });
      maybeFinishRoom(room);
      return;
    }
  });

  ws.on("close", () => {
    const p = room.participants.get(user.id);
    if (p) {
      p.connected = false;
      p.ws = null;
    }
    if (room.status === "waiting") {
      rooms.removeParticipant(room, user.id);
    }
    sendState(room);
    if (room.status === "racing") maybeFinishRoom(room);
    if (room.participants.size === 0) rooms.destroyRoom(room.id);
  });
});

// Enabled only if ADMIN_USERNAME/ADMIN_PASSWORD are both set — see admin.ts.
mountAdmin(app, db, rooms, (room) => broadcast(room, { type: "finish", room: rooms.publicState(room) }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tekla rodando em http://localhost:${PORT}`);
});
