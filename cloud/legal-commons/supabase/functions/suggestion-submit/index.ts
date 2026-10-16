// suggestion-submit: saves one suggestion about the plugin, for the research
// plugin's suggestion_box__submit tool. It inserts one row into
// suggestions.suggestion (cloud/suggestions/suggestions.sql) over a direct
// connection (db.ts) and never reads a suggestion back, so a caller can add a
// suggestion but never see, change or delete one.
//
// Request:  { "title": text, "body": text, "source": "user" | "llm" }
// Reply:    { "suggestion_id": uuid }
//
// An install key needs the suggestions:write scope. The plugin screens the text
// for personal and matter details before it sends it; this function checks
// only the shape. Nothing here logs a request body; a fault logs its SQLSTATE
// only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";

const MAX_LENGTH = 2000;
const SOURCES = new Set(["user", "llm"]);

const field = (v: unknown) => (typeof v === "string" ? v.trim() : "");

serve(async (_key, body) => {
  const title = field(body.title);
  const text = field(body.body);
  const source = field(body.source);
  if (!title || !text || title.length > MAX_LENGTH || text.length > MAX_LENGTH) {
    return reply(400, { error: `title and body must each be text of 1 to ${MAX_LENGTH} characters` });
  }
  if (!SOURCES.has(source)) return reply(400, { error: "source must be user or llm" });
  try {
    const [row] = await sql`insert into suggestions.suggestion (title, body, source)
      values (${title}, ${text}, ${source}) returning suggestion_id`;
    return reply(200, { suggestion_id: row.suggestion_id });
  } catch (err) {
    console.error("suggestion-submit: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the suggestion was not saved" });
  }
}, { scope: "suggestions:write" });
