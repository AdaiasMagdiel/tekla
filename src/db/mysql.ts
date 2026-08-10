import mysql from "mysql2/promise";
import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import type { DbAdapter, RunResult } from "./types.js";

// A minimal duck-typed view of what we actually call on a Pool/PoolConnection.
// Calling an overloaded method (like mysql2's .execute()) through a `Pool |
// PoolConnection` union confuses TS's overload resolution (it falls back to
// the last shared overload, which doesn't accept a plain string) — this
// sidesteps that entirely, since both really do implement this at runtime.
interface Executor {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

// Executes queries against either a connection pool or a single dedicated
// connection (used for transactions) — same shape either way, since both
// expose .query() with an identical signature in mysql2.
function buildAdapter(raw: Pool | PoolConnection, onClose: () => Promise<void>): DbAdapter {
  const exec = raw as unknown as Executor;

  // .query() (text protocol, client-escaped values), not .execute()
  // (server-side prepared statements, binary protocol) — every call site
  // here uses .query() for two independent reasons: migrations need
  // multiple `;`-separated statements in one call, which prepared
  // statements don't support (the pool/connection is configured with
  // multipleStatements: true for that); and .execute() with a `LIMIT ?
  // OFFSET ?` parameter reproducibly fails with "Incorrect arguments to
  // mysqld_stmt_execute" against this app's queries — a known mysql2/MySQL
  // prepared-statement quirk with parameterized LIMIT/OFFSET. .query()
  // still parameterizes safely (values are escaped client-side, not string-
  // concatenated), just via the older text protocol instead.
  const adapter: DbAdapter = {
    driver: "mysql",

    async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const [rows] = await exec.query(sql, params);
      return (rows as T[])[0];
    },

    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const [rows] = await exec.query(sql, params);
      return rows as T[];
    },

    async run(sql: string, params: unknown[] = []): Promise<RunResult> {
      const [result] = await exec.query(sql, params);
      const header = result as ResultSetHeader;
      return { lastInsertRowid: header.insertId, changes: header.affectedRows };
    },

    async exec(sql: string): Promise<void> {
      await exec.query(sql);
    },

    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      // A transaction needs its own dedicated connection — running BEGIN on
      // the pool would grab a random connection per query, defeating the
      // point. Only relevant when `raw` here is the pool itself; a nested
      // transaction() call (already on a connection) reuses it as-is.
      if (!("getConnection" in raw)) {
        return fn(adapter);
      }
      const connection = await raw.getConnection();
      try {
        await connection.beginTransaction();
        const tx = buildAdapter(connection, async () => {});
        const result = await fn(tx);
        await connection.commit();
        return result;
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    },

    async close(): Promise<void> {
      await onClose();
    },
  };

  return adapter;
}

export function createMysqlAdapter(url: string): DbAdapter {
  const parsed = new URL(url);
  const pool = mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    multipleStatements: true,
    // Without this, mysql2 returns DECIMAL-typed columns (e.g. SUM(...)) as
    // JS strings instead of numbers, to avoid precision loss on very large
    // values — not a concern for the small integer aggregates this app
    // computes (win counts, etc.), and app code shouldn't have to know or
    // care about that distinction at every call site that sums something.
    decimalNumbers: true,
  });

  return buildAdapter(pool, async () => {
    await pool.end();
  });
}
