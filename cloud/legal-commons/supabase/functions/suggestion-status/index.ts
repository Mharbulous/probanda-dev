// suggestion-status: the status of suggestions whose IDs the caller holds, for
// the research plugin's suggestion_box__status tool (cloud/suggestions/suggestions.sql).
// Keyed by ID only: it returns status and triaged_at and nothing else of a
// suggestion, and an ID it does not hold is simply omitted. It accepts the
// same keys suggestion-submit accepts, with no scope of its own.
//
// Request:  { "suggestion_ids": [uuid] }   (1 to 50)
// Reply:    { "statuses": [ { "suggestion_id", "status", "triaged_at" } ] }
//
// Nothing here logs a request body; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";

const MAX_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (_key, body) => {
  const ids = body.suggestion_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return reply(400, { error: `Which suggestions, by the 1 to ${MAX_IDS} suggestion IDs submit returned, should be looked up?` });
  }
  try {
    const rows = await sql`select suggestion_id, status, triaged_at from suggestions.suggestion
      where suggestion_id = any(${ids}::uuid[])`;
    return reply(200, {
      statuses: rows.map((row) => ({ suggestion_id: row.suggestion_id, status: row.status, triaged_at: row.triaged_at })),
    });
  } catch (err) {
    console.error("suggestion-status: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the statuses could not be read" });
  }
}, { scope: "suggestions:write" });
