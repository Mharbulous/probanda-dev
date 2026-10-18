// Recovery of approved /housekeeping rows (spec §B10, §C8).
//
// An interrupted run holds approval.json and some move row with no journal line. For each such
// row this reads the disk -- the SHA-256 of the old and the new path -- and returns the state the
// spec's table names and the action it prescribes. It moves nothing and journals nothing: the
// session acts on the answer. The same call serves the live apply's trash step, whose checks
// (the copy still holds the approved hash, the twin still exists) are the ones recovery runs.

import { createHash } from "node:crypto";
import { createReadStream, lstatSync, realpathSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import type { Proposal, Row } from "./proposal.js";
import { type Resolution, checkRows, needsJournalLine, planRows, sameFile } from "./resolve.js";
import { type Matter, existingRunDir, listRuns, openMatter, readApproval, readJournal, readProposal, requireApproval } from "./run-dir.js";

export type State =
  | "not_moved"
  | "moved"
  | "changed"
  | "missing"
  | "clash"
  | "duplicate_at_destination"
  | "trashed"
  | "unresolvable";

export type Action =
  /** Re-run the §B9.4 checks (see `resolution`), then steps 4-8 for the row's kind. */
  | "apply"
  /** An answered-question or It's-final row not yet moved: call /matter-data ingest-status first. */
  | "needs_ingest_status"
  /** The file is at its new path: steps 5-8 for the row's kind. */
  | "post_move_steps"
  /** Trash it with file_ops__trash: the copy and its twin both check out. */
  | "trash"
  | "journal_done"
  | "journal_failed";

export interface ReconciledRow {
  row_id: string;
  kind: Resolution["kind"];
  state: State;
  action: Action;
  reason?: string;
  old_path: string;
  new_path?: string;
  resolution: Resolution;
}

export interface ReconciledRun {
  run_id: string;
  approved_at: string;
  rows: ReconciledRow[];
}

/**
 * Every interrupted run of the matter, or only `runId` (the live run after a compaction, or the
 * live apply's trash step). A run is open only while some row that gets a journal line (a move
 * row, or an invalid entry) has none: a retry entry never keeps it open, and a row left as is has
 * no entry at all. A run with nothing left to reconcile is left out, and
 * its rows are not re-checked.
 * A corrupt approval.json is an error in either mode, never read as a run without approval.
 */
export async function reconcile(matterRoot: string, runId?: string, env: NodeJS.ProcessEnv = process.env): Promise<{ runs: ReconciledRun[] }> {
  const matter = openMatter(matterRoot);
  const ids = runId === undefined ? listRuns(matter) : [runId];
  const runs: ReconciledRun[] = [];
  for (const id of ids) {
    const dir = existingRunDir(matter, id);
    const { proposal, problem } = readProposal(dir, id, matter.root);
    if (!proposal) {
      if (runId !== undefined) throw new DataServerError(`run ${id} cannot be reconciled: ${problem}`, "invalid_proposal");
      continue;
    }
    const saved = readApproval(dir, id);
    // Closed without Approve: finished, not interrupted.
    if (runId === undefined && !saved.approval && !saved.problem) continue;
    const approval = saved.approval ?? requireApproval(dir, id);
    const journal = readJournal(dir);
    const planned = planRows(matter, proposal, approval, journal, env);
    if (!planned.some(({ res }) => needsJournalLine(res) && !journal.has(res.row_id))) continue;
    const rows: ReconciledRow[] = [];
    const all = checkRows(planned, proposal, env);
    for (const res of all) {
      if (journal.has(res.row_id) || !needsJournalLine(res)) continue;
      if (res.kind === "invalid") {
        rows.push(row(res, "unresolvable", "journal_failed", res.failure));
      } else if (res.kind === "trash") {
        rows.push(await trashRow(matter, proposal, res, all));
      } else {
        rows.push(await moveRow(proposal, res));
      }
    }
    runs.push({ run_id: id, approved_at: approval.approved_at, rows });
  }
  return { runs };
}

async function moveRow(proposal: Proposal, res: Resolution): Promise<ReconciledRow> {
  const approved = rowOf(proposal, res.row_id).hash;
  // Every move row resolves to a new path (resolve.ts planRows).
  const newPath = res.new_path as string;
  const old = await hashAt(res.old_path);
  const dest = await hashAt(newPath);
  if (old.kind !== "absent" && dest.kind !== "absent" && sameFile(res.old_path, newPath)) {
    // A case-only rename in place: one file, found under both spellings.
    const onDisk = pathWin32.basename(realpathSync.native(res.old_path));
    if (!holds(old, approved)) return row(res, "changed", "journal_failed", "changed since approval");
    return onDisk === pathWin32.basename(newPath) ? row(res, "moved", "post_move_steps") : notMoved(res);
  }
  if (old.kind !== "absent" && !holds(old, approved)) return row(res, "changed", "journal_failed", "changed since approval");
  if (old.kind === "absent") {
    return holds(dest, approved) ? row(res, "moved", "post_move_steps") : row(res, "missing", "journal_failed", "approved file not found");
  }
  if (dest.kind === "absent") return notMoved(res);
  if (holds(dest, approved)) return row(res, "duplicate_at_destination", "journal_failed", "duplicate at destination");
  return row(res, "clash", "journal_failed", "a different file is at the destination");
}

function notMoved(res: Resolution): ReconciledRow {
  if (res.kind === "answered_question" || res.kind === "final") return row(res, "not_moved", "needs_ingest_status");
  const pendingSecondPass = res.checks?.name.verdict === "second_pass_required" && res.checks.clash.ok && res.checks.folder.ok;
  if (res.ok || pendingSecondPass) return row(res, "not_moved", "apply");
  return row(res, "not_moved", "journal_failed", res.failure);
}

/** §C8: a trash row is reconciled from its old path alone; the twin must still hold the hash. */
async function trashRow(matter: Matter, proposal: Proposal, res: Resolution, all: Resolution[]): Promise<ReconciledRow> {
  const r = rowOf(proposal, res.row_id);
  const old = await hashAt(res.old_path);
  if (old.kind === "absent") return row(res, "trashed", "journal_done");
  if (!holds(old, r.hash)) return row(res, "changed", "journal_failed", "changed since approval");
  const twin = r.twin as NonNullable<Row["twin"]>;
  const candidates = [pathWin32.join(matter.root, twin.path)];
  const twinRes = twin.row_id === undefined ? undefined : all.find((x) => x.row_id === twin.row_id);
  if (twinRes?.new_path) candidates.push(twinRes.new_path);
  for (const path of candidates) {
    if (holds(await hashAt(path), r.hash)) return row(res, "not_moved", "trash");
  }
  return row(res, "not_moved", "journal_failed", "the other copy was not found with the same contents");
}

function row(res: Resolution, state: State, action: Action, reason?: string): ReconciledRow {
  const out: ReconciledRow = { row_id: res.row_id, kind: res.kind, state, action, old_path: res.old_path, resolution: res };
  if (res.new_path) out.new_path = res.new_path;
  if (reason) out.reason = reason;
  return out;
}

/** The proposal row of a move or trash row. Resolve makes an entry with no row `invalid`, so none should reach here. */
function rowOf(proposal: Proposal, rowId: string): Row {
  const found = proposal.rows.find((r) => r.row_id === rowId);
  if (!found) throw new DataServerError(`row ${rowId} is not in proposal.json`, "unknown_row");
  return found;
}

/** What is at a path: nothing, something that is not a file, or a file with its SHA-256. */
export type AtPath = { kind: "absent" } | { kind: "not_a_file" } | { kind: "file"; sha256: string };

/** The path holds a file with exactly this SHA-256. */
function holds(at: AtPath, sha256: string): boolean {
  return at.kind === "file" && at.sha256 === sha256;
}

/** Streaming SHA-256 of the file at `path`, or why there is none. */
export async function hashAt(path: string): Promise<AtPath> {
  try {
    if (!lstatSync(path).isFile()) return { kind: "not_a_file" };
  } catch {
    return { kind: "absent" };
  }
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return { kind: "file", sha256: hash.digest("hex") };
}
