# Deploying Tekla

This branch (`prod`) adds the deployment-only files on top of `main` — `Dockerfile`, `.dockerignore`, `docker-compose.yml`, and this doc. `main` stays application code only; merge/rebase `main` into `prod` to pick up app changes, don't develop features here.

## Build type: Dockerfile

Pick **Dockerfile** as the build type, not Static.

Static only works for a directory of files served as-is via nginx — Tekla needs a long-running Node process for the REST API, the WebSocket connection (live races), and a persistent SQLite database, none of which a static file server can do. Nixpacks/Railpack/Heroku/Paketo buildpacks would likely also work (they auto-detect Node), but the Dockerfile here is deliberately built to handle two things those auto-detectors are more likely to get wrong for this specific app:

- **`tsx`/`typescript` are devDependencies, not dependencies** — there's no compile step, `npm start` runs `src/server.ts` directly through `tsx`. A buildpack that runs `npm ci --omit=dev` (common in "production mode" detection) would delete `tsx` and the app wouldn't start. The Dockerfile explicitly installs devDependencies too.
- **`better-sqlite3` is a native module.** The image includes `python3`/`make`/`g++` in the build stage so it can compile from source if no prebuilt binary matches your VPS's architecture (e.g. arm64), then drops those build tools from the final runtime image.

## Persistent storage

The SQLite database lives at `/app/data/tekla.sqlite` inside the container. **Mount a volume at `/app/data`** or every deploy wipes your users, rooms, results, and seeded race texts. The Dockerfile declares `VOLUME ["/app/data"]`; on Coolify (or similar), add a persistent storage mount for that exact path. `docker-compose.yml` in this repo does this with a named volume, for local testing.

## Environment variables

- `PORT` — defaults to `3000`. Only change it if your platform requires a specific port.
- `DATABASE_PATH` — overrides the default `data/tekla.sqlite` location. Not needed unless you have a reason to move it.

## Seeding race texts

The database starts empty on first boot (see the main README's [Seeding race texts](README.md#seeding-race-texts) section for why) — nothing seeds automatically. After the first deploy:

```bash
docker exec -it <container_name> npm run seed -- seeds/
```

Or copy in your own text files first and seed from those instead of the bundled examples.

## Local test before pushing to the VPS

```bash
docker compose up --build
docker compose exec tekla npm run seed -- seeds/
```

Then open `http://localhost:3000`.
