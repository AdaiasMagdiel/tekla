# Deploying Tekla

This branch (`prod`) adds the deployment-only files on top of `main` — `Dockerfile`, `.dockerignore`, `docker-compose.yml`, and this doc. `main` stays application code only; merge `main` into `prod` to pick up app changes, don't develop features here.

## Build type: Dockerfile

Pick **Dockerfile**, not Static.

Static only works for a directory of files served as-is via nginx — Tekla needs a long-running Node process for the REST API, the WebSocket connection (live races), and a persistent SQLite database, none of which a static file server can do. Nixpacks/Railpack/Heroku/Paketo buildpacks would likely also work (they auto-detect Node), but the Dockerfile here handles two things those auto-detectors are more likely to get wrong for this specific app:

- **`better-sqlite3` is a native module.** The build stage includes `python3`/`make`/`g++` so it can compile from source if no prebuilt binary matches your VPS's architecture (e.g. arm64).
- **The app is TypeScript with no build step in development** (`npm start` runs `src/server.ts` straight through `tsx`). Production doesn't run it that way — see below.

## How the image is built

Multi-stage, and it doesn't just run `npm start` in a container — that would ship `tsx`/`typescript`/`vitest` and all of `@types/*` into production for no reason. Instead:

1. `deps` — full `npm ci` (including devDependencies), needed to compile.
2. `build` — `npm run build` (`tsc -p tsconfig.build.json`) compiles `src/` and `scripts/` to plain JS in `dist/`.
3. `prod-deps` — `npm prune --omit=dev` on the stage-1 `node_modules`, dropping every devDependency while keeping better-sqlite3's already-compiled native binary (no rebuild).
4. `runtime` — fresh slim image with only the pruned `node_modules`, the compiled `dist/`, and the static assets (`public/`, `seeds/`). No TypeScript, no `tsx`, no build tools. Runs `node dist/src/server.js` — the standard way to run a compiled Node app in production.

## Persistent storage (this is the part that actually matters)

**The Dockerfile alone does not create or run anything.** It's a build recipe — Dokploy is what builds the image and runs the container. That distinction matters here because of one thing: the SQLite database lives at `/app/data/tekla.sqlite` **inside the container's writable layer**. If nothing mounts a persistent volume there, every redeploy (which recreates the container) wipes your users, rooms, results, and seeded texts. The `VOLUME ["/app/data"]` line in the Dockerfile documents that this path holds state — it does **not** by itself guarantee Dokploy reuses the same storage across deploys.

Two ways to fix that in Dokploy, pick one:

**Option A — switch this app to a Dokploy "Compose" service** using the `docker-compose.yml` already in this repo, instead of an "Application" with a Build Type. The volume is then declared in code (`tekla_data:/app/data`), not clicked together in a UI, so there's nothing to misconfigure or forget on the next redeploy. This is the more foolproof option if you're setting this up fresh.

**Option B — keep the "Application" + Dockerfile setup you already have.** In the app's settings in Dokploy, find the volumes/mounts section (under "Advanced" in current versions) and add a mount with **container path `/app/data`**. Dokploy will create and reuse a named volume for it across redeploys. Do this *before* your first real deploy — if you deploy first and add the mount after, you start over with an empty database.

Either way: **the thing to verify is that `/app/data` is backed by a named volume that survives `docker rm`, not just that the container starts.** A quick check after deploying: create a room, redeploy (or restart the container) from Dokploy, and confirm the room/leaderboard data is still there.

## Environment variables

- `PORT` — defaults to `3000`. Only change it if your platform requires a specific port.
- `DATABASE_PATH` — overrides the default `data/tekla.sqlite` location. Not needed unless you have a reason to move it.
- `AUTO_SEED_DIR` — defaults to `seeds` in this image (see below). Unset it in Dokploy's environment variables if you'd rather seed manually instead.

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

Open `http://localhost:3000` — texts should already be loaded (auto-seed), no extra command needed. To confirm persistence, `docker compose restart` and check a previously created room/leaderboard entry is still there.
