import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { Request, Response, RequestHandler } from "express";
import { nanoid } from "nanoid";
import type { DbAdapter } from "./db.js";
import type { UserRow } from "./types.js";

// ---------- Passwords ----------
// scrypt (Node's built-in) instead of bcrypt/argon2: no native dependency to
// compile on top of the ones the project already has (better-sqlite3), and
// scrypt is memory-hard by design — good enough for a hobby project's login.

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const sep = stored.indexOf(":");
  if (sep === -1) return false;
  const salt = Buffer.from(stored.slice(0, sep), "hex");
  const expected = Buffer.from(stored.slice(sep + 1), "hex");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

export function isValidPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 8 && password.length <= 200;
}

// ---------- Sessions ----------

const SESSION_COOKIE = "tekla_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(db: DbAdapter, userId: string): Promise<string> {
  const token = nanoid(32);
  const now = Date.now();
  await db.run("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", [
    token,
    userId,
    now,
    now + SESSION_TTL_MS,
  ]);
  return token;
}

export async function deleteSession(db: DbAdapter, token: string): Promise<void> {
  await db.run("DELETE FROM sessions WHERE token = ?", [token]);
}

async function getSessionUser(db: DbAdapter, token: string): Promise<UserRow | undefined> {
  const row = await db.get<UserRow & { expires_at: number }>(
    `SELECT u.* , s.expires_at as expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [token]
  );
  if (!row) return undefined;
  if (row.expires_at < Date.now()) {
    await deleteSession(db, token);
    return undefined;
  }
  return row;
}

// No cookie-parser dependency: the app only ever needs to read this one
// cookie, so a tiny hand-rolled parser is simpler than pulling in a package.
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function sessionCookieOptions(): { httpOnly: true; sameSite: "lax"; secure: boolean; maxAge: number; path: string } {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function sessionTokenFromRequest(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

// Same parsing, usable outside Express requests too (the raw ws upgrade
// request only carries headers, not an Express Request).
export function sessionTokenFromCookieHeader(header: string | undefined): string | undefined {
  return parseCookies(header)[SESSION_COOKIE];
}

export async function resolveSessionUser(db: DbAdapter, req: Request): Promise<UserRow | undefined> {
  const token = sessionTokenFromRequest(req);
  if (!token) return undefined;
  return getSessionUser(db, token);
}

export async function resolveSessionUserFromCookieHeader(
  db: DbAdapter,
  header: string | undefined
): Promise<UserRow | undefined> {
  const token = sessionTokenFromCookieHeader(header);
  if (!token) return undefined;
  return getSessionUser(db, token);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

// Attaches req.user when a valid session cookie is present, without
// rejecting the request otherwise — routes that need a logged-in user layer
// requireAuth on top of this.
export function attachSessionUser(db: DbAdapter): RequestHandler {
  return async (req, _res, next) => {
    req.user = await resolveSessionUser(db, req);
    next();
  };
}

export function requireAuth(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "not_authenticated" });
    next();
  };
}

export function publicUser(user: UserRow, characterImagePath: string | null): {
  id: string;
  username: string;
  displayName: string;
  characterId: number | null;
  characterImagePath: string | null;
} {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    characterId: user.character_id,
    characterImagePath,
  };
}
