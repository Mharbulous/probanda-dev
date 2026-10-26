// suggestion-withdraw: the practitioner withdraws a suggestion they sent
// (decision 16 of docs/Plans/2026-10-25_suggestion-design.md), through
// suggestions.withdraw (cloud/suggestions/suggestions.sql). Only the install key
// that sent it may withdraw it; the project secret is refused, because it sent
// no suggestion. Before triage, meaning no issue number is recorded, the
// suggestion and its items are deleted. Once an issue number is recorded they
// are deleted too, and a tombstone holding only the id, the issue number and
// 'withdrawn' stays, so that intake closes the issue.
//
// Request:  { "suggestion_id": uuid }
// Reply:    { "suggestion_id": uuid, "withdrawn": true }
//
// A refused withdrawal is a 409 that says nothing was withdrawn and asks about
// the suggestion (COMMANDMENTS.md, Commandment 6). Nothing here logs a request
// body; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";
import { checkWithdrawRequest } from "./shape.ts";

serve(async (_key, body, caller) => {
  if (caller.kind !== "install") {
    return reply(403, { error: "Not withdrawn. Is this coming from the computer that sent the suggestion?" });
  }
  const checked = checkWithdrawRequest(body);
  if ("question" in checked) return reply(400, { error: checked.question });
  try {
    const [{ r }] = await sql`select suggestions.withdraw(${caller.keyHash}, ${checked.ok}::uuid) as r`;
    if (r.saved !== true) {
      return reply(409, { error: "Not withdrawn. Is this the id of a suggestion this computer sent and has not already withdrawn?" });
    }
    return reply(200, { suggestion_id: r.suggestion_id, withdrawn: true });
  } catch (err) {
    console.error("suggestion-withdraw: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the suggestion was not withdrawn" });
  }
}, { scope: "suggestions:write" });
