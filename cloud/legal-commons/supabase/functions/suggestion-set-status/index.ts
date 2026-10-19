// suggestion-set-status: records the outcome of triaging one suggestion
// (cloud/suggestions/suggestions.sql), for /adversarial-triage through
// cloud/suggestions/tools/triage.mjs. Project secret only.
//
// Request:  { "suggestion_id": uuid, "status": "approved" | "approved in part" | "rejected",
//             "issue_number"?: integer }
// Reply:    { "suggestion_id": uuid, "status": text }
//
// Only a row still 'new' moves, and only once: a second call on the same row
// is refused, so an outcome is never overwritten. It sets triaged_at to now.
// A fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";

const OUTCOMES = new Set(["approved", "approved in part", "rejected"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (_key, body) => {
  const { suggestion_id: id, status, issue_number: issue } = body;
  if (typeof id !== "string" || !UUID.test(id)) return reply(400, { error: "suggestion_id must be a uuid" });
  if (typeof status !== "string" || !OUTCOMES.has(status)) {
    return reply(400, { error: "status must be approved, approved in part or rejected" });
  }
  if (issue !== undefined && !(Number.isInteger(issue) && (issue as number) > 0)) {
    return reply(400, { error: "issue_number, when given, must be a positive integer" });
  }
  try {
    const [row] = await sql`update suggestions.suggestion
      set status = ${status}, issue_number = ${(issue as number | undefined) ?? null}, triaged_at = now()
      where suggestion_id = ${id} and status = 'new'
      returning suggestion_id, status`;
    if (!row) return reply(409, { error: "no suggestion with that id is still new" });
    return reply(200, { suggestion_id: row.suggestion_id, status: row.status });
  } catch (err) {
    console.error("suggestion-set-status: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the status was not saved" });
  }
});
