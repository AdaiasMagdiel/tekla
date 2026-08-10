# Contributing to Tekla

Thanks for looking at this. Tekla started as a weekend project for a typing competition, so it's intentionally small — that also makes it a pretty approachable codebase to poke around in. This doc covers the parts that aren't obvious from the code alone: how to translate the app, how the pieces fit together, and how to send a change back.

## Getting set up

```bash
git clone git@github.com:AdaiasMagdiel/tekla.git
cd tekla
npm install
npm run seed -- seeds/   # loads the example PT/EN race texts
npm run dev               # auto-restarts on file changes
```

Open `http://localhost:3000`. That's it — no build step, no Docker, no external services. SQLite lives at `data/tekla.sqlite` and is created automatically (gitignored, so it's yours to delete and recreate whenever), with the schema applied via the migration system — see [Choosing a database engine](#choosing-a-database-engine) below.

Before opening a PR:

```bash
npm run typecheck
npm test
```

Both also run in CI on every PR (`.github/workflows/ci.yml`), twice — once against SQLite, once against MySQL.

## Translating Tekla

The UI language is auto-detected from the browser (`navigator.language`) and can be forced via a `/pt` or `/en` URL prefix — see the [Language section in the README](README.md#language) for how that resolution works from a user's point of view. This section is about *adding* a language.

There are two independent things to translate, and you can do either without the other:

### 1. UI strings

Every visible string in the app (buttons, labels, error messages, page titles) lives in `public/i18n/<lang>.json`. To add a language, say Spanish:

1. Copy `public/i18n/en.json` to `public/i18n/es.json`.
2. Translate every value. Keep the keys exactly as they are — the app looks strings up by key (e.g. `t("room.startButton")`), so a missing or renamed key just falls back to showing the raw key on screen instead of erroring.
3. Some strings have `{placeholders}`, e.g. `"finishSummary": "{time}s · {wpm} WPM · {accuracy}% accuracy"`. Keep the `{name}` tokens; you can reorder or restructure the surrounding text around them freely.
4. Add `"es"` to `SUPPORTED_LANGS` in **both** `src/server.ts` (so `/es` and `/es/room.html` etc. resolve) and `public/js/i18n.js` (so the browser will actually pick it, whether by detection or by the `/es` prefix).

At this point `/es` works and shows a fully translated UI — the race text itself will still come from whatever language is available (see below and the fallback behavior described in the README).

If you're adding a string to the *app itself* (a new feature, a new error case), add the key to **both** `pt.json` and `en.json` in the same PR — a string only translated in one language will silently fall back to its key in the other, which is easy to miss in review.

### 2. Race texts

Race texts are seeded separately from the UI strings — see [Adding race texts](#adding-race-texts) below. In short: `seeds/es.json` + `npm run seed -- seeds/es.json`.

### Trying it out

```bash
npm run seed -- seeds/es.json
npm run dev
```

Then visit `http://localhost:3000/es`. If your terminal/browser supports it, you can also just set your browser's language to Spanish and visit `/` — no prefix needed, that's the whole point of the auto-detection.

## Adding race texts

`npm run seed -- <path...> [options]` loads texts into the `texts` table. Full reference (formats, `--lang`, `--clear`, `--dry-run`) is in the [README](README.md#seeding-race-texts) — this section is about *what makes a good race text*, since that's harder to write a `--help` for:

- Aim for 100–200 characters. Much shorter and the race is over before anyone's WPM stabilizes; much longer and one dropped connection ruins a room's night.
- Use plain, unambiguous punctuation. Avoid em dashes, curly quotes, or symbols that are awkward to type on a standard keyboard layout — the whole point is testing typing speed, not keyboard trivia.
- Prefer full, grammatical sentences over word lists — it's a more realistic (and more fun) typing test.
- Don't reuse the same few nouns/openings across all texts in a set (`seeds/pt.json` and `seeds/en.json` are a reasonable reference for variety and tone).

## Choosing a database engine

Tekla talks to the database through a small adapter (`src/db/types.ts`'s `DbAdapter`) instead of directly through a specific driver, so the engine is a runtime choice, not a code fork. Two engines are supported today:

- **SQLite** (default, nothing to configure) — good for local dev and small deployments.
- **MySQL** — set `DB_DRIVER=mysql` and `DATABASE_URL=mysql://user:pass@host:port/database`.

```bash
# SQLite (default) — same as before, nothing to set
npm run dev

# MySQL — point at a local instance (e.g. `docker run -e MYSQL_ROOT_PASSWORD=root
# -e MYSQL_DATABASE=tekla -p 3306:3306 mysql:8`, or a native install)
DB_DRIVER=mysql DATABASE_URL=mysql://root:root@127.0.0.1:3306/tekla npm run dev
```

Whichever engine you pick, `createDb()` (used by `npm run dev`/`npm start`/the test suite) applies any pending migrations automatically on connect — there's no separate "run migrations" step for normal use.

### Migrations

Schema changes live in `migrations/*.ts`, each exporting an `up(db)`/`down(db)` pair (branching on `db.driver` wherever the two engines' SQL differs — see `migrations/0001_init.ts` for the pattern). No external migration library; `src/db/migrator.ts` + `scripts/migrate.ts` are the whole thing:

```bash
npm run migrate -- create add_something   # scaffold migrations/000N_add_something.ts
npm run migrate -- up                      # apply all pending migrations
npm run migrate -- down                    # revert the last applied migration (--steps N for more)
npm run migrate -- drop-all --yes          # revert everything, reset the tracking table
```

After `create`, add the new file to `migrations/index.ts` (registration is manual, on purpose — no directory-scanning magic to reason about).

Since migrations are the only thing that changes the schema, any query anywhere in `src/` can assume the schema described in `migrations/` is what's live — there's no separate "current schema" doc to keep in sync.

### Testing against both engines

`npm test` runs against SQLite by default (`:memory:`, fresh per test, no setup needed). To also run it against MySQL locally, start a MySQL instance and set the same env vars as above before running the tests — `tests/helpers.ts`'s `testDb()` detects `DB_DRIVER=mysql` and truncates all tables before each test instead of reconnecting. CI (`.github/workflows/ci.yml`) runs the full suite against both engines on every PR (`test-sqlite` and `test-mysql` jobs, the latter with a `mysql:8` service container) — so a MySQL-specific regression won't silently ship even if you only tested locally against SQLite.

### Adding a new engine

1. Implement `DbAdapter` (`src/db/types.ts`) in a new `src/db/<engine>.ts`, following `src/db/sqlite.ts` or `src/db/mysql.ts` as a template — `get`/`all`/`run`/`exec`/`transaction`/`close`.
2. Wire it into `connectDb()` in `src/db.ts` behind a new `DB_DRIVER` value.
3. Add a branch to `migrations/0001_init.ts`'s `up()`/`down()` (and any migration added since) for the new engine's DDL dialect.
4. Check the handful of call sites that already branch on `db.driver` for the same reason — `src/texts.ts` (`RANDOM()` vs `RAND()`), `src/admin.ts`'s `getStats` (`strftime` vs `FROM_UNIXTIME`), `src/seedTexts.ts`'s `--clear` handling (SQLite's `sqlite_sequence` reset vs MySQL's `TRUNCATE`) — and add the equivalent for the new engine. These are the only places any SQL isn't portable as-is (both current drivers use plain `?` positional placeholders, so most queries need zero changes).
5. Add a CI job mirroring `test-mysql` in `.github/workflows/ci.yml`, if the engine has a docker service image available.

**A non-relational engine (e.g. MongoDB) does not fit this shape.** `DbAdapter` is fundamentally "run this SQL string with these params" — Mongo doesn't speak SQL, so there's no `db.driver === "mongo"` branch that makes sense here. Supporting it would mean replacing the SQL-string abstraction with a repository-style one instead — one function per domain operation (`insertUser`, `getUserById`, `listCharacters`, …), implemented natively per engine (SQL for the relational ones, native Mongo driver calls for Mongo), rather than every call site sharing a SQL string. That's a real refactor of every file under `src/` that touches the database, not a new adapter file — worth doing if there's real demand for it, but out of scope here; flagging the direction rather than half-building it.

## Architecture, briefly

- **`src/server.ts`** is both the REST API and the WebSocket server, sharing one Express `http.Server`. REST handles one-shot things (create user, create room, leaderboard, profile stats). The WebSocket handles everything that happens *during* a room's lifetime (join, start, typing progress, finish) — see the `ws.on("message", ...)` switch in `server.ts` for the full message protocol.
- **Every database call is `async`, all the way through.** `DbAdapter` (`src/db/types.ts`) is the only thing app code talks to — never a driver directly — because SQLite's driver here (`better-sqlite3`) is synchronous but MySQL's isn't; a uniform async interface is the only way to support both without forking the codebase. WebSocket message/connection handlers are `async` listeners with an internal `try/catch` (nothing awaits their return value, so an uncaught rejection there would otherwise be silent or crash the process) — see [Choosing a database engine](#choosing-a-database-engine) for the rest.
- **`src/rooms.ts`** (`RoomManager`) owns all in-memory room state — there's deliberately no "rooms" table beyond a thin audit trail in SQLite (`rooms`/`race_results`). A server restart drops all active rooms; that's an accepted trade-off for a weekend project, not an oversight.
- **Progress is prefix-based, not length-based.** `RoomManager.computeProgress(target, typed)` returns the length of the *longest correct prefix* — a typo freezes progress until it's corrected, even if the player keeps typing past it. This is the one piece of game logic most likely to look "wrong" at a glance if you haven't read the code, so it has direct test coverage in `tests/rooms.test.ts`.
- **The frontend never trusts itself.** Race progress, WPM, and accuracy are recomputed server-side from the raw keystroke stream (`typing` WS messages); the client-side numbers you see while racing are a live preview, not the source of truth. Keep it that way if you touch the typing flow — a client-authoritative score is trivial to cheat.
- **Errors are codes, not sentences.** REST and WebSocket errors are short codes like `"room_not_found"` (see `public/i18n/*.json` under `errors.*`). If you add a new failure case, add a matching key in both language files rather than sending a hardcoded string — that string would never get translated.

## Tests

`npm test` runs [Vitest](https://vitest.dev) once; `npm run test:watch` re-runs on change. Tests live in `tests/*.test.ts` and exercise `src/` directly (no HTTP, no browser) against a fresh, isolated database per test (`testDb()` in `tests/helpers.ts`) — SQLite `:memory:` by default, or MySQL if `DB_DRIVER=mysql` is set (see [Testing against both engines](#testing-against-both-engines)).

A couple of things that aren't obvious:

- **Importing `src/db.ts` never touches disk on its own.** `connectDb()`/`createDb()` and `defaultDbPath()` are all pure at import time — nothing opens a database until you call one of them explicitly. If a test (or a refactor) makes `data/tekla.sqlite` appear just from running `npm test`, something reintroduced a module-level side effect; that's a bug, not a quirk.
- Every test function is `async` and awaits its DB calls — a test that doesn't `await` a `DbAdapter` call isn't testing anything (it's asserting on a `Promise` object, which Vitest's matchers will just fail on, loudly — not a silent false-pass).
- `npm run test:e2e` runs a small [Playwright](https://playwright.dev) suite (`e2e/*.spec.ts`) through a real browser against a running server — the one thing the Vitest suite can't cover, since it never starts an HTTP/WebSocket server or touches file upload. Not part of CI (a real browser on every PR is more than this project needs); run it manually before a change to the WebSocket protocol, the room lifecycle, or the database layer.

## Code style

Nothing enforced by a linter today — just match what's there:

- No comments that restate what the code already says. A comment earns its place by explaining a *non-obvious* constraint or trade-off (see the "progress is prefix-based" note above for the kind of thing worth a comment).
- Small, dependency-injected functions over classes where reasonable (`texts.ts`, `users.ts` take `db` as a parameter rather than importing a singleton) — it's what makes the in-memory test database possible without mocking.
- Prefer editing an existing file's structure over introducing a new abstraction for a one-off need.
- Frontend stays framework-free. If a page's script is getting unwieldy, that's a signal to simplify it, not to reach for a framework.

## Sending a change

1. Fork, branch, make your change.
2. `npm run typecheck && npm test` before pushing.
3. Open a PR with a short description of the *why*, not just the *what* — the diff already shows what changed.
4. Keep PRs focused. A translation addition, a bug fix, and a new feature are three PRs, not one.

This project is licensed [AGPL-3.0](LICENSE) — by contributing, you agree your changes are licensed under the same terms.
