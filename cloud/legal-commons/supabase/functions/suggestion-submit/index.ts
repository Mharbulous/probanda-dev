// suggestion-submit: saves one suggestion about the plugin, for the research
// plugin's suggestion_box__submit tool. It saves the suggestion and its items
// through suggestions.submit (cloud/suggestions/suggestions.sql) over a direct
// connection (db.ts) and never reads a suggestion back, so a caller can add a
// suggestion but never see, change or delete one here. suggestion-status reads
// back a suggestion's status, badge and item decisions, for the key that sent it.
//
// Request:  { "title": text, "body" | "pain_point": text, "source": "user" | "llm" | "assisted",
//             "plugin_version": text, "skill"?: text,
//             "items"?: [text, ...]                       the card's items, in order
//                     | [ { "pain", "where", "done_test", "constraints": [text],
//                           "changes": [ { "change", "origin": "probanda" | "lawyer" } ] } ],
//             "previews"?: [ { "label", "chosen": boolean, "reason"?, "html" } ],
//             "origin"?: "practitioner" | "probanda",
//             "fingerprint"?: { "plugin", "version", "skill"?, "kind" },
//             "raw_observation"?: text, "environment_facts"?: object,
//             "comment"?: text,
//             "context_lines"?: [ { "kind": "constraint" | "evidence", "text" } ],
//             "mockup"?: html }
// Reply:    { "suggestion_id": uuid, "items_saved": boolean, "previews_saved": boolean,
//             "mockup_saved": boolean }
//
// An install key needs the suggestions:write scope, and the suggestion records
// that key's SHA-256 as the account that sent it (Account Information,
// COMMANDMENTS.md, Commandment 2). The plugin screens the text for personal and
// matter details before it sends it; this function checks only the shape
// (shape.ts). The pain point is saved in body, which still carries it, whether
// it came as pain_point or body. A suggestion with no item texts gets one item
// holding its body.
// Nothing here logs a request body; a fault logs its SQLSTATE only.
//
// Once a row is saved, it starts the maintainer's "Suggestion Box intake" cloud
// task through that task's API trigger (INTAKE_FIRE_URL and INTAKE_FIRE_TOKEN,
// function secrets), sending no suggestion text: the task reads new rows itself.
// A failed start is logged and does not fail the save, because the task's daily
// schedule picks the row up.

import { reply, serve } from "../_shared/caller.ts";
import { type Json, sql } from "../_shared/db.ts";
import { checkSubmit } from "./shape.ts";

async function startIntake() {
  const url = Deno.env.get("INTAKE_FIRE_URL");
  const token = Deno.env.get("INTAKE_FIRE_TOKEN");
  if (!url || !token) {
    console.error("suggestion-submit: intake trigger not configured");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error("suggestion-submit: intake trigger refused", res.status);
  } catch (err) {
    console.error("suggestion-submit: intake trigger failed", (err as Error).name);
  }
}

serve(async (_key, body, caller) => {
  const checked = checkSubmit(body);
  if ("question" in checked) return reply(400, { error: checked.question });
  const submission = checked.ok;
  const keyHash = caller.kind === "install" ? caller.keyHash : null;
  try {
    const [row] = await sql`select suggestions.submit(${keyHash}, ${sql.json(submission as unknown as Json)}) as id`;
    await startIntake();
    return reply(200, {
      suggestion_id: row.id,
      items_saved: submission.items !== undefined || submission.item_texts !== undefined,
      previews_saved: submission.previews !== undefined,
      mockup_saved: submission.mockup_html !== undefined,
    });
  } catch (err) {
    console.error("suggestion-submit: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the suggestion was not saved" });
  }
}, { scope: "suggestions:write" });
