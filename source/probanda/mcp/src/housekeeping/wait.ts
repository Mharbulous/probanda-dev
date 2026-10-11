// The session's wait for Approve (spec §B8.3): a tool call that returns as soon as approval.json
// exists, or `pending` when its budget runs out, below the host's tool-call limit. The session
// re-issues it until approval arrives. The poll is async, never a blocking sleep: the page server
// listening on this same event loop must keep answering while a wait is in flight.

import { win32 as pathWin32 } from "node:path";

import { pythonTimeoutMs } from "../python-timeout.js";
import { APPROVAL, existingRunDir, newerRun, openMatter, readApproval } from "./run-dir.js";

export const WAIT_TIMEOUT_MS = 45_000;
const POLL_MS = 300;

export type WaitResult =
  | { status: "approved"; run_id: string; approved_at: string; rows: number }
  | { status: "pending"; run_id: string; waited_ms: number }
  | { status: "invalidated"; run_id: string; newer_run: string }
  /** approval.json is there but unreadable: nothing may be applied from it. */
  | { status: "corrupt"; run_id: string; file: string; problem: string };

export async function waitApproval(matterRoot: string, runId: string, env: NodeJS.ProcessEnv = process.env): Promise<WaitResult> {
  const budget = pythonTimeoutMs(env, WAIT_TIMEOUT_MS, "COCLERK_HOUSEKEEPING_WAIT_MS");
  const matter = openMatter(matterRoot);
  const dir = existingRunDir(matter, runId);
  const started = Date.now();
  for (;;) {
    const { approval, problem } = readApproval(dir, runId);
    if (approval) return { status: "approved", run_id: runId, approved_at: approval.approved_at, rows: approval.rows.length };
    if (problem) return { status: "corrupt", run_id: runId, file: pathWin32.join(dir, APPROVAL), problem };
    // Any newer run directory, proposal or not, invalidates this page (spec A4).
    const newer = newerRun(matter, runId);
    if (newer !== null) return { status: "invalidated", run_id: runId, newer_run: newer };
    const waited = Date.now() - started;
    if (waited >= budget) return { status: "pending", run_id: runId, waited_ms: waited };
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, budget - waited)));
  }
}
