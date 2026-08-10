import { defineConfig } from "vitest/config";

const usingMysql = process.env.DB_DRIVER === "mysql";

export default defineConfig({
  test: {
    // e2e/*.spec.ts are Playwright specs (npm run test:e2e), not Vitest's —
    // without this, Vitest's default *.spec.ts glob picks them up too and
    // tries to run Playwright's test() through Vitest's runner.
    exclude: ["node_modules/**", "e2e/**"],
    // SQLite test files are isolated by nature (each gets its own
    // ":memory:" db, so running the 6 files in parallel is safe and fast).
    // MySQL test files all share one real database (see tests/helpers.ts),
    // so running them in parallel races each file's own migration bootstrap
    // against the others' ("Table already exists") — serialize only in that
    // mode instead of paying that cost for SQLite too.
    fileParallelism: !usingMysql,
    // Also only for MySQL: keep the same module registry across files so
    // tests/helpers.ts's cached pool (mysqlDb) is actually shared instead of
    // reconnecting per file. A fresh TCP+auth handshake to a real MySQL
    // server can take several seconds (e.g. reverse-DNS lookups on the
    // server side) — paying that once for the whole run instead of once per
    // file is the difference between a slow run and a run that trips every
    // test's default timeout.
    isolate: !usingMysql,
    // Real network round-trips (however occasional) don't fit SQLite's
    // in-memory-fast default timeouts (5s test / 10s hook).
    testTimeout: usingMysql ? 30000 : 5000,
    hookTimeout: usingMysql ? 30000 : 10000,
  },
});
