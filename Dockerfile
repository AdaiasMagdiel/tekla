# syntax=docker/dockerfile:1

# --- deps: installs node_modules, including devDependencies ---------------
# tsx/typescript are devDependencies but are required at runtime (the app
# has no compile step — src/server.ts is run directly via `npm start`), so
# this image intentionally does NOT use `npm ci --omit=dev`.
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for common platforms, but these
# build tools let it fall back to compiling from source (e.g. on arm64
# hosts without a matching prebuild) instead of failing the build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# --- runtime: slim image, no build tools -----------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY seeds ./seeds

# Not tracked in git (see .gitignore) — created here so SQLite has
# somewhere to put the database file before the volume is mounted over it.
RUN mkdir -p /app/data

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
