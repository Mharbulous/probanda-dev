// suggestion-attach-specification: attaches technical-writer's specification and
// its backstop's result to the suggestion they follow (decision 18 of
// docs/Plans/2026-10-25_suggestion-design.md), through
// suggestions.attach_specification (cloud/suggestions/suggestions.sql). Only the
// install key that sent the suggestion may attach one, only once, and not to a
// withdrawn suggestion. The project secret is refused, because it sent no
// suggestion.
//
// Request:  { "suggestion_id": uuid, "specification": text, "backstop_result": object }
// Reply:    { "suggestion_id": uuid, "saved": true }
//
// A refused write is a 409 that says it was not saved and asks about the
// suggestion (COMMANDMENTS.md, Commandment 6). Nothing here logs a request
// body; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { type Json, sql } from "../_shared/db.ts";
import { checkAttachRequest } from "./shape.ts";

const REFUSALS: Record<string, string> = {
  unknown: "Not saved. Is this the id of a suggestion this computer sent and has not withdrawn?",
  attached: "Not saved. This suggestion already has its specification; is another suggestion meant?",
  specification: "Not saved. What does the specification say, in 1 to 100000 characters?",
  backstop: "Not saved. What did the backstop find when it checked this specification, as one JSON object?",
};

serve(async (_key, body, caller) => {
  if (caller.kind !== "install") {
    return reply(403, { error: "Not saved. Is this coming from the computer that sent the suggestion?" });
  }
  const checked = checkAttachRequest(body);
  if ("question" in checked) return reply(400, { error: checked.question });
  const a = checked.ok;
  try {
    const [{ r }] = await sql`select suggestions.attach_specification(${caller.keyHash}, ${a.suggestion_id}::uuid,
      ${a.specification}, ${sql.json(a.backstop_result as Json)}) as r`;
    if (r.saved !== true) return reply(409, { error: REFUSALS[String(r.refusal)] ?? REFUSALS.unknown });
    return reply(200, { suggestion_id: r.suggestion_id, saved: true });
  } catch (err) {
    console.error("suggestion-attach-specification: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the specification was not saved" });
  }
}, { scope: "suggestions:write" });
