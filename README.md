# Tekla 🏁

A real-time multiplayer typing race game. Create a room, share a short join code, and race your friends by typing a shared paragraph as fast — and as accurately — as possible.

Built over a weekend for a typing competition we're organizing.

## How it works

- Pick a username and a display name (no password, no accounts to manage).
- Create a room or join one with a short, readable code (e.g. `AB3D9K`).
- Everyone sees a blurred preview of the text before the race starts, so nobody can read ahead.
- The room host starts a 5-second countdown (red → yellow → green); the text unblurs and the input unlocks for everyone at once.
- Cars race across the track based on typing progress — but progress only advances through the **longest correct prefix** you've typed. Type a wrong word and race ahead without fixing it, and your car barely moves; you have to backspace and correct it to keep going.
- Live WPM and accuracy update in real time for every racer, even during pauses.
- A **mirror mode** (`/mirror.html?code=...`) gives you a read-only, big-screen-friendly view of the whole race — ideal for projecting on a TV during a live event.
- Results and a global leaderboard (best WPM, accuracy, wins) are saved per user, with a per-user profile page showing race history.

## Stack

- **Backend:** Node.js, Express, `ws` (WebSocket), SQLite (`better-sqlite3`)
- **Frontend:** vanilla HTML/CSS/JS, no build step
- **Icons:** [Lucide](https://lucide.dev) via CDN

## Running locally

```bash
npm install
npm start
```

The app runs on `http://localhost:3000` by default (override with the `PORT` env var). A SQLite database is created automatically at `data/tekla.sqlite` on first run.

## Project structure

```
src/
  server.js   REST API + WebSocket server
  rooms.js    In-memory room state, race progress, live stats
  db.js       SQLite schema
  texts.js    Seed texts used for races
  users.js    User lookup/creation helpers
public/
  index.html      Landing page (create/join room)
  room.html       Waiting room + race UI
  mirror.html     Read-only "mirror" view for big screens
  ranking.html    Global leaderboard
  profile.html    Per-user stats and race history
```

## License

[AGPL-3.0](LICENSE) — if you run a modified version of this project as a network service, you must make the source of your modified version available to its users.
