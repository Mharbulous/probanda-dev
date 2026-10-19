// suggestion-list: the maintainer's read of the Suggestion Box
// (cloud/suggestions/suggestions.sql), for /adversarial-triage through
// cloud/suggestions/tools/triage.mjs. Project secret only: no install key may
// call it, so no install ever reads a suggestion.
//
// Request:  {} or { "status": "new" | "approved" | "approved in part" | "rejected" }
// Reply:    { "suggestions": [row, ...] }, oldest first
//
// Nothing here logs a row; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";

const STATUSES = new Set(["new", "approved", "approved in part", "rejected"]);

serve(async (_key, body) => {
  const status = body.status;
  if (status !== undefined && (typeof status !== "string" || !STATUSES.has(status))) {
    return reply(400, { error: "status, when given, must be new, approved, approved in part or rejected" });
  }
  try {
    const rows = await sql`select suggestion_id, title, body, source, plugin_version, skill, status,
        issue_number, created_at, triaged_at
      from suggestions.suggestion
      where ${status === undefined} or status = ${status ?? ""}
      order by created_at, suggestion_id`;
    return reply(200, { suggestions: rows });
  } catch (err) {
    console.error("suggestion-list: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the suggestions could not be read" });
  }
});
