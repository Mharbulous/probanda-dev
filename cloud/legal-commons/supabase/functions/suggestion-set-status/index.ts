// suggestion-set-status: records a decision on a suggestion or one of its items
// (cloud/suggestions/suggestions.sql), for the maintainer's triage through
// cloud/suggestions/tools/triage.mjs and for Probanda's automation. Project
// secret only.
//
// Request, one of (shape.ts):
//   { "suggestion_id", "issue_number": integer }
//       Probanda's automation (intake) records the issue the suggestion is filed
//       under; its status does not change
//   { "suggestion_id", "item": n, "status": "approved" | "declined", "reason": text, "category"?: text }
//       the maintainer decides one item; a decline names its category
//   { "suggestion_id", "item": n, "status": "implemented", "implemented_in": "<plugin> <version>" }
//       Probanda's automation marks an approved item shipped
//   { "suggestion_id", "status": "under review", "issue_number"?: integer }
//       Probanda's automation opens the suggestion for review
//   { "suggestion_id", "status": "approved" | "approved in part" | "rejected",
//     "issue_number"?: integer, "reason"?: text, "category"?: text }
//       the old whole-suggestion decision, applied to every item, until the
//       triage skill decides per item (lifecycle plan Phase 7)
// Reply:    { "suggestion_id", "status", "badge", "item"? }
//
// The rules are the SQL functions' (suggestions.record_issue, set_item_status,
// mark_implemented, open_for_review, set_all_items): a decision is never
// overwritten, a reason is required, and a withdrawn suggestion takes no write.
// A refused write is a 409 that says it was not saved and asks about the item
// (COMMANDMENTS.md, Commandment 6). A fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";
import { CATEGORY_QUESTION, checkSetStatus, REASON_QUESTION } from "./shape.ts";

const REFUSALS: Record<string, string> = {
  unknown: "Not saved. Which suggestion is this about: is that id one the Suggestion Box holds?",
  withdrawn: "Not saved. The practitioner withdrew this suggestion; is another suggestion meant?",
  item: "Not saved. Which of this suggestion's items, by its number, is this about?",
  decided: "Not saved. This item already has a decision; is another item, or another suggestion, meant?",
  "not approved": "Not saved. Was this item approved before its fix shipped, and in which release?",
  issue: "Not saved. This suggestion is filed under another issue; which issue is it filed under?",
  release: "Not saved. Which plugin and version, such as lawyer 0.4.2, shipped this item's fix?",
  reason: REASON_QUESTION,
  category: CATEGORY_QUESTION,
  status: "Not saved. Is this item approved or declined?",
};

serve(async (_key, body) => {
  const checked = checkSetStatus(body);
  if ("question" in checked) return reply(400, { error: checked.question });
  const w = checked.ok;
  try {
    let result: Record<string, unknown>;
    if (w.form === "issue") {
      [{ r: result }] = await sql`select suggestions.record_issue(${w.suggestion_id}::uuid, ${w.issue_number}::int) as r`;
    } else if (w.form === "item") {
      [{ r: result }] = await sql`select suggestions.set_item_status(${w.suggestion_id}::uuid, ${w.item}::int,
        ${w.status}, ${w.reason}, ${w.category}) as r`;
    } else if (w.form === "implemented") {
      [{ r: result }] = await sql`select suggestions.mark_implemented(${w.suggestion_id}::uuid, ${w.item}::int,
        ${w.implemented_in}) as r`;
    } else if (w.form === "review") {
      [{ r: result }] = await sql`select suggestions.open_for_review(${w.suggestion_id}::uuid, ${w.issue_number}::int) as r`;
    } else {
      [{ r: result }] = await sql`select suggestions.set_all_items(${w.suggestion_id}::uuid, ${w.status},
        ${w.issue_number}::int, ${w.reason}, ${w.category}) as r`;
    }
    if (result.saved !== true) {
      return reply(409, { error: REFUSALS[String(result.refusal)] ?? "Not saved. Is this the suggestion and item meant?" });
    }
    const { saved: _saved, ...rest } = result;
    return reply(200, rest);
  } catch (err) {
    console.error("suggestion-set-status: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the status was not saved" });
  }
});
