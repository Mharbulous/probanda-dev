// A second server process for the background render job's tests (#589). It bootstraps one matter
// through the tool dispatch, exactly as the MCP server would, prints the response's background_job,
// then waits for its job. The parent test kills it, lets it exit mid-job, or races two of them.
//
// Argument: JSON {db_path, client_name, client_no, matter_no, draft_dir?, go_file?, exit_after?}
// - go_file: wait until this file exists before bootstrapping, so two children start together.
// - exit_after: exit gracefully once the job has finished this many filings.
// Prints one JSON line per event: bootstrapped, then settled (or exiting).

import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const { callTool } = await import("../../build/dispatch.js");
const { awaitBackgroundJobs, backgroundJobStatus } = await import("../../build/submission/render-job.js");

const { go_file, exit_after, ...args } = JSON.parse(process.argv[2]);
const say = (event, body = {}) => process.stdout.write(JSON.stringify({ event, ...body }) + "\n");

if (go_file) while (!existsSync(go_file)) await sleep(2);

const result = await callTool({}, "drafting_forms__bootstrap", args);
say("bootstrapped", { background_job: result.background_job });

if (exit_after !== undefined) {
  setInterval(() => {
    if ((backgroundJobStatus(args.db_path).done ?? []).length >= exit_after) {
      say("exiting");
      process.exit(0);
    }
  }, 2);
} else {
  say("settled", { summaries: await awaitBackgroundJobs() });
}
