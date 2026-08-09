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
npm run seed -- seeds/   # load the example PT/EN race texts
npm start
```

The app runs on `http://localhost:3000` by default (override with the `PORT` env var). A SQLite database is created automatically at `data/tekla.sqlite` on first run — but it starts with **no race texts**, so a room can't start a race until you seed some.

## Seeding race texts

The repo doesn't ship any text baked into the code — you feed your own database with the `seed` script, in whatever language(s) you want.

```bash
node scripts/seed-texts.mjs <path...> [options]
# or: npm run seed -- <path...> [options]
```

`<path>` can be a `.json` file, a `.txt` file, or a directory containing either — pass as many as you like. Options:

- `--lang <code>` — force a language code for everything imported in this run (otherwise it's inferred from each file's name, e.g. `pt.json` → `pt`)
- `--clear` — wipe all existing texts before importing
- `--dry-run` — preview what would be imported without touching the database

File formats:

- **`.json`** — an array of strings (`["Text one.", "Text two."]`) or an array of objects (`[{ "content": "Text one.", "lang": "en" }]`)
- **`.txt`** — one race text per line, blank lines ignored

Examples:

```bash
npm run seed -- seeds/                 # import every file in seeds/
npm run seed -- seeds/pt.json --clear  # wipe existing texts, load PT only
npm run seed -- my-texts.txt --lang es # force language "es"
```

`seeds/` ships two example sets (`pt.json`, `en.json`, 12 texts each) as a starting point — edit them, replace them, or add more files for other languages.

Race selection currently picks a random text across all languages in the database; per-language/per-room selection is a natural next step if you want to run multilingual events.

## Project structure

```
src/
  server.js   REST API + WebSocket server
  rooms.js    In-memory room state, race progress, live stats
  db.js       SQLite schema
  texts.js    Random text picker used when a race starts
  users.js    User lookup/creation helpers
scripts/
  seed-texts.mjs  CLI to load race texts into the database
seeds/
  pt.json, en.json   Example race text sets
public/
  index.html      Landing page (create/join room)
  room.html       Waiting room + race UI
  mirror.html     Read-only "mirror" view for big screens
  ranking.html    Global leaderboard
  profile.html    Per-user stats and race history
```

## License

[AGPL-3.0](LICENSE) — if you run a modified version of this project as a network service, you must make the source of your modified version available to its users.
