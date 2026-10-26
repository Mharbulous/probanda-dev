// suggestion-list: the maintainer's read of the Suggestion Box
// (cloud/suggestions/suggestions.sql), for triage through
// cloud/suggestions/tools/triage.mjs and for intake. Project secret only: no
// install key may call it, so no install ever reads a suggestion's content.
//
// Request:  {} or { "status": "submitted" | "under review" | "withdrawn" }
//           ("new" still names 'submitted'; shape.ts)
// Reply:    { "suggestions": [row, ...] }, oldest first. Each row holds the
//           suggestion's columns, its badge, and item_list: its items in order,
//           each { "item", "text", "status", "reason", "category", "implemented_in" }.
//           context_lines are the card's constraint and evidence lines in
//           order; body carries the pain point. items and previews are the
//           earlier structured fields, as sent. The
//           sender's key hash is never returned.
//
// Nothing here logs a row; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";
import { checkListRequest } from "./shape.ts";

serve(async (_key, body) => {
  const checked = checkListRequest(body);
  if ("question" in checked) return reply(400, { error: checked.question });
  try {
    const [row] = await sql`select suggestions.list(${checked.ok}) as suggestions`;
    return reply(200, { suggestions: row.suggestions });
  } catch (err) {
    console.error("suggestion-list: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the suggestions could not be read" });
  }
});
