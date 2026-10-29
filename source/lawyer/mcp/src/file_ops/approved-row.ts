// The /housekeeping approval binds that run's file moves (plan 2026-10-28 §2d). A file_ops call
// that names a run and a row acts only when the run's approval.json approves the row and the file
// it would move still holds the hash the row's proposal.json recorded. A call naming neither
// carries on as before: safe-file-deletion, supersede-draft and the other callers have no run.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { DataServerError } from "../errors.js";
import { existingRunDir, openMatter, requireApproval, requireProposal } from "../housekeeping/run-dir.js";

export interface RunRow {
  run_id?: string;
  row_id?: string;
}

/**
 * Refuses unless `row` names no run, or names a run whose approval approves the row while the
 * file at `source` still holds the row's proposed hash. Run before the first filesystem change.
 */
export function requireApprovedRow(matterRoot: string, row: RunRow, source: string): void {
  if (row.run_id === undefined && row.row_id === undefined) return;
  if (row.run_id === undefined || row.row_id === undefined) {
    throw new DataServerError("run_id and row_id are given together or not at all", "invalid_argument");
  }
  const matter = openMatter(matterRoot);
  const dir = existingRunDir(matter, row.run_id);
  const proposed = requireProposal(dir, row.run_id, matter.root).rows.find((r) => r.row_id === row.row_id);
  if (!proposed) throw new DataServerError(`row ${row.row_id} is not in run ${row.run_id}'s proposal.json`, "unknown_row");
  if (!requireApproval(dir, row.run_id).rows.some((e) => e.row_id === row.row_id)) {
    throw new DataServerError(`row ${row.row_id} of run ${row.run_id} was not approved; nothing was moved`, "not_approved");
  }
  let hash: string;
  try {
    hash = createHash("sha256").update(readFileSync(source)).digest("hex");
  } catch (err) {
    throw new DataServerError(`the approved file of row ${row.row_id} cannot be read (${(err as Error).message}); nothing was moved: ${source}`, "changed_since_approval");
  }
  if (hash !== proposed.hash) {
    throw new DataServerError(
      `the file is not the one approved for row ${row.row_id} of run ${row.run_id}: it changed after approval; nothing was moved: ${source}`,
      "changed_since_approval"
    );
  }
}
