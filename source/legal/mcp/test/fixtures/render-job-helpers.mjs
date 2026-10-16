// Shared by render-job.e2e.test.mjs and workboard-file-url.e2e.test.mjs (#589): a matter with many plain
// filings, and a child server process that runs the background render job.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { freshSubmissionDb } = await import("../helpers/template-db.mjs");
const { submissionDataExecute } = await import("../../build/submission/backend.js");

export const CLIENT = { client_name: "Ashgrove Holdings", client_no: "7001", matter_no: "L7001" };

const CHILD = fileURLToPath(new URL("./render-job-child.mjs", import.meta.url));

/** One proceeding and `count` Notice of Application filings, ids 1..count. */
export async function seedFilings(dbPath, count) {
  await freshSubmissionDb(dbPath);
  const rows = Array.from({ length: count }, (_, i) => `(${i + 1}, 1, 'notice_of_application', 'Notice of Application ${i + 1}')`);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum, file_number) VALUES (1, 'L7001 - Ashgrove', 'CAN/BC/BCSC', 'S-770011');
     INSERT INTO filings (id, proceeding_id, kind, title) VALUES ${rows.join(", ")};`
  );
}

/**
 * Starts render-job-child.mjs with no model credential of any kind in its environment (brief D4: the
 * whole bootstrap-through-board flow runs with no API key present). `events` collects its JSON lines;
 * `next(event)` resolves with the first line of that event.
 */
export function startChild(options, extraEnv = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ANTHROPIC|CLAUDE|OPENAI)/i.test(key)));
  const child = spawn(process.execPath, [CHILD, JSON.stringify(options)], { env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  const events = [];
  const waiters = [];
  let buffered = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const line = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      events.push(line);
      for (const waiter of waiters.filter((w) => w.event === line.event)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(line);
      }
    }
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return {
    child,
    events,
    exited,
    stderr: () => stderr,
    next(event) {
      const seen = events.find((line) => line.event === event);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        waiters.push({ event, resolve });
        exited.then(({ code }) => reject(new Error(`child exited (${code}) before "${event}": ${stderr}`)));
      });
    },
  };
}
