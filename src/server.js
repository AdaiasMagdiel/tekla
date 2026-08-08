import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

import { db } from "./db.js";
import { syncSeedTexts } from "./texts.js";
import { createUser, getUserByUsername, getUserById, isValidUsername } from "./users.js";
import { RoomManager } from "./rooms.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
syncSeedTexts(db);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const rooms = new RoomManager(db);

// ---------- REST API ----------

app.post("/api/users", (req, res) => {
  const { username, displayName } = req.body || {};
  if (!isValidUsername(username)) {
    return res.status(400).json({
      error: "Username inválido. Use 3-16 caracteres: letras, números ou _.",
    });
  }
  const name = (displayName || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "Informe seu nome." });

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

app.post("/api/rooms", (req, res) => {
  const { userId } = req.body || {};
  const user = getUserById(db, userId);
  if (!user) return res.status(401).json({ error: "Usuário inválido." });
  const room = rooms.createRoom(user);
  res.json({ code: room.code });
});

app.get("/api/rooms/:code", (req, res) => {
  const room = rooms.getByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "Sala não encontrada." });
  res.json(rooms.publicState(room));
});

app.post("/api/rooms/:code/join", (req, res) => {
  const { userId } = req.body || {};
  const user = getUserById(db, userId);
  if (!user) return res.status(401).json({ error: "Usuário inválido." });
  const room = rooms.getByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "Sala não encontrada." });
  if (room.status !== "waiting") {
    return res.status(409).json({ error: "A corrida já começou." });
  }
  rooms.addParticipant(room, user);
  res.json(rooms.publicState(room));
});

app.get("/api/leaderboard", (req, res) => {
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

app.get("/api/users/:username/stats", (req, res) => {
  const user = getUserByUsername(db, req.params.username);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  const summary = db
    .prepare(
      `SELECT COUNT(*) as races,
              MAX(wpm) as bestWpm,
              ROUND(AVG(wpm), 1) as avgWpm,
              ROUND(AVG(accuracy), 1) as avgAccuracy,
              SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END) as wins
       FROM race_results WHERE user_id = ?`
    )
    .get(user.id);

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

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const p of room.participants.values()) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
  for (const ws of room.spectators) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function sendState(room) {
  broadcast(room, { type: "state", room: rooms.publicState(room) });
}

function maybeFinishRoom(room) {
  const all = [...room.participants.values()];
  const active = all.filter((p) => p.connected);
  if (active.length > 0 && active.every((p) => p.finished)) {
    rooms.finishRoom(room);
    broadcast(room, { type: "finish", room: rooms.publicState(room) });
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const code = (url.searchParams.get("room") || "").toUpperCase();
  const isSpectator = url.searchParams.get("spectator") === "1";

  const room = rooms.getByCode(code);
  if (!room) {
    ws.send(JSON.stringify({ type: "error", message: "Sala não encontrada." }));
    ws.close();
    return;
  }

  // Read-only "mirror" viewers (big screens): no user, no car, just state.
  if (isSpectator) {
    rooms.addSpectator(room, ws);
    ws.send(JSON.stringify({ type: "state", room: rooms.publicState(room) }));
    ws.on("close", () => rooms.removeSpectator(room, ws));
    return;
  }

  const userId = url.searchParams.get("userId");
  const user = getUserById(db, userId);
  if (!user) {
    ws.send(JSON.stringify({ type: "error", message: "Usuário inválido." }));
    ws.close();
    return;
  }

  const participant = rooms.addParticipant(room, user);
  participant.ws = ws;
  participant.connected = true;

  sendState(room);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "start") {
      if (user.id !== room.hostUserId) return;
      if (room.status !== "waiting") return;

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

      const target = room.text.content;
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
        p.finishTimeMs = Date.now() - room.startedAt;
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tekla rodando em http://localhost:${PORT}`);
});
