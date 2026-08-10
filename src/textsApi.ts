import { createHash, timingSafeEqual } from "crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import type { DbAdapter } from "./db.js";
import { createText, deleteTexts, listTextIds, type AdminTextRow } from "./admin.js";
import { DIFFICULTIES, type Difficulty } from "./types.js";

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

// Returns null (route disabled) unless TEXTS_API_KEY is set — same "no
// default credential" stance as the admin panel: a deploy that forgets to
// configure this just doesn't expose the endpoint instead of exposing it
// with a guessable key.
function createTextsApiAuthMiddleware(): RequestHandler | null {
  const key = process.env.TEXTS_API_KEY;
  if (!key) return null;

  return (req, res, next) => {
    const header = req.headers.authorization;
    const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (provided && safeEqual(provided, key)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}

type TextInput = { content?: unknown; lang?: unknown; difficulty?: unknown };

function parseTextInput(item: TextInput): { content: string; lang: string; difficulty?: Difficulty } | null {
  const content = typeof item.content === "string" ? item.content.trim() : "";
  const lang = typeof item.lang === "string" ? item.lang.trim().toLowerCase() : "";
  if (!content || !lang) return null;
  if (item.difficulty !== undefined && !DIFFICULTIES.includes(item.difficulty as Difficulty)) return null;
  return { content, lang, difficulty: item.difficulty as Difficulty | undefined };
}

// Machine-fed race text ingestion, entirely separate from the human admin
// panel (/api/admin/texts, Basic auth). Meant for an external system (a
// script, a CMS, a scheduled job) to POST new texts with a bearer key. Only
// mounted when TEXTS_API_KEY is configured; otherwise POST /api/texts 404s
// like any other undefined route.
export function mountTextsApi(app: Express, db: DbAdapter): void {
  const auth = createTextsApiAuthMiddleware();
  if (!auth) {
    console.log("Texts API disabled (set TEXTS_API_KEY to enable POST /api/texts).");
    return;
  }

  app.post("/api/texts", auth, async (req: Request, res: Response) => {
    const body = (req.body || {}) as { texts?: TextInput[] } & TextInput;
    const isBulk = Array.isArray(body.texts);
    const items: TextInput[] = isBulk ? body.texts! : [body];

    if (items.length === 0) return res.status(400).json({ error: "invalid_input" });

    const parsed: { content: string; lang: string; difficulty?: Difficulty }[] = [];
    for (const item of items) {
      const row = parseTextInput(item);
      if (!row) return res.status(400).json({ error: "invalid_input" });
      parsed.push(row);
    }

    const rows: AdminTextRow[] = await db.transaction(async (tx) => {
      const inserted: AdminTextRow[] = [];
      for (const { content, lang, difficulty } of parsed) {
        inserted.push(await createText(tx, content, lang, difficulty));
      }
      return inserted;
    });

    if (isBulk) return res.json({ inserted: rows.length, texts: rows });
    res.json(rows[0]);
  });

  // Same shape as the admin panel's DELETE /api/admin/texts, but reachable
  // with just the bearer key — { ids: number[] } for a specific selection,
  // or { all: true, lang? } to wipe everything (optionally scoped to a
  // language). Texts still referenced by a room are skipped, not failed.
  app.delete("/api/texts", auth, async (req: Request, res: Response) => {
    const { ids, all, lang } = (req.body || {}) as { ids?: unknown; all?: unknown; lang?: unknown };
    let targetIds: number[];
    if (all === true) {
      targetIds = await listTextIds(db, typeof lang === "string" && lang.trim() ? lang.trim().toLowerCase() : undefined);
    } else if (Array.isArray(ids) && ids.length > 0 && ids.every((x) => typeof x === "number" && Number.isInteger(x))) {
      targetIds = ids;
    } else {
      return res.status(400).json({ error: "invalid_input" });
    }
    res.json(await deleteTexts(db, targetIds));
  });

  console.log("Texts API enabled at POST/DELETE /api/texts");
}
