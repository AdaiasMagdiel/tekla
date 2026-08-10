export type Driver = "sqlite" | "mysql";

export interface RunResult {
  lastInsertRowid: number;
  changes: number;
}

// A thin, engine-agnostic query surface — just enough for this app's needs
// (positional `?` placeholders work unchanged on both better-sqlite3 and
// mysql2, so most SQL strings in the codebase don't need to change at all).
// Not a query builder or ORM on purpose: the app is small enough that raw
// SQL per call site, with the rare per-engine branch on `.driver`, stays
// more readable than an abstraction layer over the SQL itself.
export interface DbAdapter {
  readonly driver: Driver;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  // fn receives a transaction-scoped adapter — always use it (not the outer
  // `db`) for every read/write that must be part of the transaction.
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface Migration {
  id: string;
  up(db: DbAdapter): Promise<void>;
  down(db: DbAdapter): Promise<void>;
}
