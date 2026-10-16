// A second server process for the matter pages' concurrency test (#1365 A2). Once go_file exists it
// renders one filing with draft_dir `times` times, as the MCP server would, so two of these released
// together race each other's page writes.
//
// Argument: JSON {db_path, filing_id, client, draft_dir, go_file, times}
// Prints one JSON line per event: ready, then rendered once per render, then done -- or failed.

import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const { submissionFormsRender } = await import("../../build/submission/forms.js");

const { db_path, filing_id, client, draft_dir, go_file, times } = JSON.parse(process.argv[2]);
const say = (event, body = {}) => process.stdout.write(JSON.stringify({ event, ...body }) + "\n");

say("ready");
while (!existsSync(go_file)) await sleep(2);
try {
  for (let i = 0; i < times; i++) {
    submissionFormsRender(db_path, filing_id, client, "mockup", undefined, undefined, undefined, undefined, "tok", draft_dir);
    say("rendered", { i });
  }
  say("done");
} catch (err) {
  say("failed", { error: String(err?.stack ?? err) });
  process.exitCode = 1;
}
