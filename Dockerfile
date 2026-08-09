# syntax=docker/dockerfile:1

# --- base: shared setup for the two npm-ci-dependent stages ---------------
FROM node:22-bookworm-slim AS base
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for common platforms, but these
# build tools let it fall back to compiling from source (e.g. on arm64
# hosts without a matching prebuild) instead of failing the build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# --- deps: full install (incl. devDependencies) — needed to run `tsc` ------
FROM base AS deps
RUN npm ci

# --- build: compile TypeScript to plain JS ---------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# --- prod-deps: same install, pruned down to production dependencies only -
# Pruning (not a separate `npm ci --omit=dev`) keeps better-sqlite3's
# already-compiled native binary from the `deps` stage instead of rebuilding
# it a second time.
FROM deps AS prod-deps
RUN npm prune --omit=dev

# --- runtime: slim image, no TypeScript/tsx/build tools/devDependencies ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY --from=build /app/dist ./dist
COPY public ./public
COPY seeds ./seeds

# Not tracked in git (see .gitignore) — created here so SQLite has
# somewhere to put the database file before the volume is mounted over it.
RUN mkdir -p /app/data

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/src/server.js"]
