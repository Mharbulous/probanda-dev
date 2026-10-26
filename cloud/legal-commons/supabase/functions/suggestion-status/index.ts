// suggestion-status: what became of suggestions, for the lawyer plugin's
// suggestion_box__status tool (cloud/suggestions/suggestions.sql). It returns a
// suggestion only to the install key that sent it: an ID another key sent is
// omitted, as an unknown ID is. A suggestion saved before senders were recorded
// is returned to any key holding its ID, as before. The project secret may read
// any. It accepts the same keys suggestion-submit accepts, with no scope of its
// own.
//
// Request:  { "suggestion_ids": [uuid] }   (1 to 50; shape.ts)
// Reply:    { "statuses": [ { "suggestion_id", "status", "triaged_at", "badge",
//                             "items": [ { "item", "status", "reason", "category",
//                                          "implemented_in" } ] } ] }
//
// status is 'submitted', 'under review' or 'withdrawn'; badge is what the
// practitioner sees (decision 17, suggestions.badge); the items carry no text,
// because the practitioner's computer keeps its own copy. Nothing here logs a
// request body; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";
import { checkStatusRequest } from "./shape.ts";

serve(async (_key, body, caller) => {
  const checked = checkStatusRequest(body);
  if ("question" in checked) return reply(400, { error: checked.question });
  const keyHash = caller.kind === "install" ? caller.keyHash : null;
  const everyone = caller.kind === "project";
  try {
    const [row] = await sql`select suggestions.status_for_key(${keyHash}, ${checked.ok}::uuid[], ${everyone}) as statuses`;
    return reply(200, { statuses: row.statuses });
  } catch (err) {
    console.error("suggestion-status: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the statuses could not be read" });
  }
}, { scope: "suggestions:write" });
