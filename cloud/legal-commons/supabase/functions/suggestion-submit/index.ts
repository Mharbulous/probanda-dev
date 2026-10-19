// suggestion-submit: saves one suggestion about the plugin, for the research
// plugin's suggestion_box__submit tool. It inserts one row into
// suggestions.suggestion (cloud/suggestions/suggestions.sql) over a direct
// connection (db.ts) and never reads a suggestion back, so a caller can add a
// suggestion but never see, change or delete one. suggestion-status reads back
// a suggestion's status alone.
//
// Request:  { "title": text, "body": text, "source": "user" | "llm" | "assisted",
//             "plugin_version": text, "skill"?: text,
//             "items"?: [ { "pain", "where", "done_test", "constraints": [text],
//                           "changes": [ { "change", "origin": "probanda" | "lawyer" } ] } ],
//             "previews"?: [ { "label", "chosen": boolean, "reason"?, "html" } ] }
// Reply:    { "suggestion_id": uuid, "items_saved": boolean, "previews_saved": boolean }
//
// An install key needs the suggestions:write scope. The plugin screens the text
// for personal and matter details before it sends it; this function checks
// only the shape (shape.ts for items and previews). Nothing here logs a request
// body; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { type Json, sql } from "../_shared/db.ts";
import { checkItems, checkPreviews } from "./shape.ts";

const MAX_LENGTH = 2000;
const MAX_TAG = 100;
const SOURCES = new Set(["user", "llm", "assisted"]);

const field = (v: unknown) => (typeof v === "string" ? v.trim() : "");

serve(async (_key, body) => {
  const title = field(body.title);
  const text = field(body.body);
  const source = field(body.source);
  const pluginVersion = field(body.plugin_version);
  const skill = field(body.skill);
  if (!title || !text || title.length > MAX_LENGTH || text.length > MAX_LENGTH) {
    return reply(400, { error: `title and body must each be text of 1 to ${MAX_LENGTH} characters` });
  }
  if (!SOURCES.has(source)) {
    return reply(400, { error: "Whose words are in this suggestion: the person's own (user), drafted by Probanda and confirmed by the person (assisted), or a vetted loose thread (llm)?" });
  }
  if (!pluginVersion || pluginVersion.length > MAX_TAG) {
    return reply(400, { error: `plugin_version must be text of 1 to ${MAX_TAG} characters` });
  }
  if (body.skill !== undefined && (!skill || skill.length > MAX_TAG)) {
    return reply(400, { error: `skill, when given, must be text of 1 to ${MAX_TAG} characters` });
  }
  const items = checkItems(body.items);
  if ("question" in items) return reply(400, { error: items.question });
  const previews = checkPreviews(body.previews);
  if ("question" in previews) return reply(400, { error: previews.question });
  try {
    const [row] = await sql`insert into suggestions.suggestion (title, body, source, plugin_version, skill, items, previews)
      values (${title}, ${text}, ${source}, ${pluginVersion}, ${skill || null},
        ${items.ok ? sql.json(items.ok as Json) : null}, ${previews.ok ? sql.json(previews.ok as Json) : null})
      returning suggestion_id, items is not null as items_saved, previews is not null as previews_saved`;
    return reply(200, { suggestion_id: row.suggestion_id, items_saved: row.items_saved, previews_saved: row.previews_saved });
  } catch (err) {
    console.error("suggestion-submit: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the suggestion was not saved" });
  }
}, { scope: "suggestions:write" });
