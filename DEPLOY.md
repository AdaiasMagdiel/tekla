# Deploying Tekla

This branch (`prod`) adds the deployment-only files on top of `main` — `Dockerfile`, `.dockerignore`, `docker-compose.yml`, and this doc. `main` stays application code only; merge/rebase `main` into `prod` to pick up app changes, don't develop features here.

## Build type: Dockerfile

Pick **Dockerfile** as the build type, not Static.

Static only works for a directory of files served as-is via nginx — Tekla needs a long-running Node process for the REST API, the WebSocket connection (live races), and a persistent SQLite database, none of which a static file server can do. Nixpacks/Railpack/Heroku/Paketo buildpacks would likely also work (they auto-detect Node), but the Dockerfile here handles two things those auto-detectors are more likely to get wrong for this specific app:

- **`better-sqlite3` is a native module.** The build stage includes `python3`/`make`/`g++` so it can compile from source if no prebuilt binary matches your VPS's architecture (e.g. arm64).
- **The app is TypeScript with no build step in development** (`npm start` runs `src/server.ts` straight through `tsx`). Production doesn't run it that way — see below.

## How the image is built

Multi-stage, and deliberately not just `npm start` in a container:

1. `deps` — full `npm ci` (including devDependencies: `typescript`, `tsx`, `vitest`, `@types/*`), needed to compile.
2. `build` — `npm run build` (`tsc -p tsconfig.build.json`) compiles `src/` and `scripts/` to plain JS in `dist/`.
3. `prod-deps` — `npm prune --omit=dev` on the stage-1 `node_modules`, dropping every devDependency while keeping better-sqlite3's already-compiled native binary (no rebuild).
4. `runtime` — fresh slim image with only the pruned `node_modules`, the compiled `dist/`, and the static assets (`public/`, `seeds/`). No TypeScript, no `tsx`, no build tools. Runs `node dist/src/server.js`.

Net effect: the image that actually runs in production has zero of the ~40MB+ of TypeScript/testing tooling sitting in it, doesn't transpile anything at boot, and only needs the four real production dependencies (`express`, `ws`, `better-sqlite3`, `nanoid`) to be present.

## Persistent storage

The SQLite database lives at `/app/data/tekla.sqlite` inside the container. **Mount a volume at `/app/data`** or every deploy wipes your users, rooms, results, and seeded race texts. The Dockerfile declares `VOLUME ["/app/data"]`; on Coolify (or similar), add a persistent storage mount for that exact path. `docker-compose.yml` in this repo does this with a named volume, for local testing.

## Environment variables

- `PORT` — defaults to `3000`. Only change it if your platform requires a specific port.
- `DATABASE_PATH` — overrides the default `data/tekla.sqlite` location. Not needed unless you have a reason to move it.

## Seeding race texts

The database starts empty on first boot (see the main README's [Seeding race texts](README.md#seeding-race-texts) section for why) — nothing seeds automatically. After the first deploy:

```bash
docker exec -it <container_name> node dist/scripts/seed-texts.js seeds/
```

(Not `npm run seed` — that script runs through `tsx`, which isn't in the production image on purpose; see above.)

Or copy in your own text files first and seed from those instead of the bundled examples.

## Local test before pushing to the VPS

```bash
docker compose up --build
docker compose exec tekla node dist/scripts/seed-texts.js seeds/
```

Then open `http://localhost:3000`.
