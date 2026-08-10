# Deploying Tekla

This branch (`prod`) adds the deployment-only files on top of `main` — `Dockerfile`, `.dockerignore`, `docker-compose.yml`, and this doc. `main` stays application code only; merge `main` into `prod` to pick up app changes, don't develop features here.

## Build type: Dockerfile

Pick **Dockerfile**, not Static.

Static only works for a directory of files served as-is via nginx — Tekla needs a long-running Node process for the REST API, the WebSocket connection (live races), and a persistent database (SQLite by default, or MySQL — see "Choosing a database engine" below), none of which a static file server can do. Nixpacks/Railpack/Heroku/Paketo buildpacks would likely also work (they auto-detect Node), but the Dockerfile here handles two things those auto-detectors are more likely to get wrong for this specific app:

- **`better-sqlite3` is a native module.** The build stage includes `python3`/`make`/`g++` so it can compile from source if no prebuilt binary matches your VPS's architecture (e.g. arm64).
- **The app is TypeScript with no build step in development** (`npm start` runs `src/server.ts` straight through `tsx`). Production doesn't run it that way — see below.

## How the image is built

Multi-stage, and it doesn't just run `npm start` in a container — that would ship `tsx`/`typescript`/`vitest` and all of `@types/*` into production for no reason. Instead:

1. `deps` — full `npm ci` (including devDependencies), needed to compile.
2. `build` — `npm run build` (`tsc -p tsconfig.build.json`) compiles `src/`, `scripts/`, and `migrations/` to plain JS in `dist/`.
3. `prod-deps` — `npm prune --omit=dev` on the stage-1 `node_modules`, dropping every devDependency while keeping better-sqlite3's already-compiled native binary (no rebuild).
4. `runtime` — fresh slim image with only the pruned `node_modules`, the compiled `dist/`, and the static assets (`public/`, `seeds/`). No TypeScript, no `tsx`, no build tools. Runs `node dist/src/server.js` — the standard way to run a compiled Node app in production.

## Choosing a database engine

Defaults to SQLite — nothing to configure, same as before. To use MySQL instead, set two environment variables in Dokploy:

- `DB_DRIVER=mysql`
- `DATABASE_URL=mysql://user:password@host:3306/database` — a managed MySQL instance (Dokploy's own "Database" service, RDS, PlanetScale, etc.) or one you run yourself. Not a service this Dockerfile provides — bring your own.

The choice only changes where data lives, nothing else about how the app runs: `Persistent storage` below still applies for `/app/public/uploads` (character images always live on the container's disk, regardless of engine), it just no longer applies to `/app/data` — that path, and its volume, are SQLite-only. If you're on MySQL, you can skip mounting `/app/data` entirely (there's nothing there to persist), but leaving the mount in place is harmless too.

**Schema migrations run automatically on every boot**, for either engine — the server calls the same "apply pending migrations" step `createDb()` always runs before it starts listening, so there's no separate deploy step for schema changes. If you ever need to run one manually (checking what's applied, or reverting):

```bash
docker exec -it <container_name> node dist/scripts/migrate.js up
docker exec -it <container_name> node dist/scripts/migrate.js down
```

(Same `docker exec` pattern as manual seeding below — not `npm run migrate`, since `tsx` isn't in the production image; see "How the image is built".)

## Persistent storage (this is the part that actually matters)

**The Dockerfile alone does not create or run anything.** It's a build recipe — Dokploy is what builds the image and runs the container. That distinction matters here because of **up to two** separate paths that hold state inside the container's writable layer — if nothing mounts a persistent volume over them, every redeploy (which recreates the container) wipes that data:

| Path | What lives there | Volume line in Dockerfile | Needed with... |
| --- | --- | --- | --- |
| `/app/data` | The SQLite database (`tekla.sqlite`) — users, rooms, results, seeded texts, and the `characters` table rows | `VOLUME ["/app/data", ...]` | SQLite only (default) — irrelevant if `DB_DRIVER=mysql`, since that data lives in your external MySQL instance instead |
| `/app/public/uploads` | Admin-uploaded images (currently just character portraits, under `uploads/characters/`) | `VOLUME [..., "/app/public/uploads"]` | Always, regardless of database engine |

These are two *independent* volumes, not one — a character's DB row (wherever the DB lives) stores an `image_path` like `/uploads/characters/xyz.png` that points at a file physically living under `/app/public/uploads` on *this* container. If you only mount that one, on SQLite you'd also need `/app/data`, or you end up with either orphaned image files with no DB row pointing at them, or DB rows whose `image_path` 404s because the file was wiped on redeploy. Both need to survive a redeploy for the character system to keep working correctly.

The `VOLUME [...]` line in the Dockerfile documents that these paths hold state — it does **not** by itself guarantee Dokploy reuses the same storage across deploys.

Two ways to fix that in Dokploy, pick one:

**Option A — switch this app to a Dokploy "Compose" service** using the `docker-compose.yml` already in this repo, instead of an "Application" with a Build Type. Both volumes are then declared in code (`tekla_data:/app/data` and `tekla_uploads:/app/public/uploads`), not clicked together in a UI, so there's nothing to misconfigure or forget on the next redeploy. This is the more foolproof option if you're setting this up fresh.

**Option B — keep the "Application" + Dockerfile setup you already have.** In the app's settings in Dokploy, find the volumes/mounts section (under "Advanced" in current versions) and add **two** mounts: one with container path `/app/data`, another with container path `/app/public/uploads`. Dokploy will create and reuse a named volume for each across redeploys. Do this *before* your first real deploy — if you deploy first and add the mounts after, you start over with an empty database and no uploaded images.

Either way: **the thing to verify is that both `/app/data` and `/app/public/uploads` are backed by named volumes that survive `docker rm`, not just that the container starts.** A quick check after deploying: create a room and, via `/admin/characters.html`, upload a character image; redeploy (or restart the container) from Dokploy; confirm the room/leaderboard data *and* the character's image (not a broken image icon) are still there.

## Environment variables

- `PORT` — defaults to `3000`. Only change it if your platform requires a specific port.
- `DB_DRIVER` — `sqlite` (default) or `mysql`. See "Choosing a database engine" above.
- `DATABASE_URL` — required when `DB_DRIVER=mysql`, ignored otherwise. `mysql://user:password@host:3306/database`.
- `DATABASE_PATH` — SQLite only. Overrides the default `data/tekla.sqlite` location. Not needed unless you have a reason to move it.
- `AUTO_SEED_DIR` — defaults to `seeds` in this image (see below). Unset it in Dokploy's environment variables if you'd rather seed manually instead.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — both unset by default, which keeps `/admin` fully disabled (404, not just unauthenticated). Set both in Dokploy's environment variables to enable the admin panel at `https://<your-domain>/admin` (HTTP Basic Auth — the browser prompts for the credentials). Pick a strong password; there's no rate limiting on login attempts.

## Seeding race texts

**You don't have to run anything manually for this to work out of the box.** The Dockerfile sets `AUTO_SEED_DIR=seeds`; on boot, if the database has zero texts, the server loads the bundled `seeds/pt.json` and `seeds/en.json` itself and logs how many it imported. This only fires when the database is empty — once it has *any* texts, boot leaves it alone, so it won't fight you if you later load your own set.

If you want different texts than the bundled examples:

- **Replace `seeds/` in the repo before deploying** (on `prod`) — the auto-seed on first boot will load whatever's there instead.
- **Or seed manually after the fact**, which also works for adding to or replacing an already-seeded database:

  ```bash
  docker exec -it <container_name> node dist/scripts/seed-texts.js seeds/ --clear
  ```

  (Not `npm run seed` — that script runs through `tsx`, which isn't in the production image on purpose; see above.)

## Local test before pushing to the VPS

```bash
docker compose up --build
```

Open `http://localhost:3000` — texts should already be loaded (auto-seed), no extra command needed. To confirm persistence, `docker compose restart` and check a previously created room/leaderboard entry **and** a previously uploaded character image are still there.
