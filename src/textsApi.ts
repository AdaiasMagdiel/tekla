import { createHash, timingSafeEqual } from "crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import type { DbAdapter } from "./db.js";
import { createText, type AdminTextRow } from "./admin.js";

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

type TextInput = { content?: unknown; lang?: unknown };

function parseTextInput(item: TextInput): { content: string; lang: string } | null {
  const content = typeof item.content === "string" ? item.content.trim() : "";
  const lang = typeof item.lang === "string" ? item.lang.trim().toLowerCase() : "";
  if (!content || !lang) return null;
  return { content, lang };
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

    const parsed: { content: string; lang: string }[] = [];
    for (const item of items) {
      const row = parseTextInput(item);
      if (!row) return res.status(400).json({ error: "invalid_input" });
      parsed.push(row);
    }

    const rows: AdminTextRow[] = await db.transaction(async (tx) => {
      const inserted: AdminTextRow[] = [];
      for (const { content, lang } of parsed) {
        inserted.push(await createText(tx, content, lang));
      }
      return inserted;
    });

    if (isBulk) return res.json({ inserted: rows.length, texts: rows });
    res.json(rows[0]);
  });

  console.log("Texts API enabled at POST /api/texts");
}
