// The session's two writes into a /housekeeping run directory (spec §B8.1, §B9.6): a run file
// (proposal.json above all) and a journal line. approval.json is written only by the page server.

import { existsSync, readFileSync } from "node:fs";

import { DataServerError } from "../errors.js";
import { orderProblem } from "./order.js";
import { type Proposal, bareNameProblem, validateProposal } from "./proposal.js";
import {
  APPROVAL,
  JOURNAL,
  PROPOSAL,
  appendLineDurably,
  createRun,
  existingRunDir,
  openMatter,
  readJournal,
  requireApproval,
  requireProposal,
  runFilePath,
  writeReplacing,
} from "./run-dir.js";

/** The run files this tool writes. approval.json and applied.jsonl have their own writers. */
const RUN_FILES = [PROPOSAL, "questions.json", "rule_gaps.json"];

export interface WriteRunFileResult {
  run_id: string;
  path: string;
  bytes: number;
  /** proposal.json already held exactly this content. */
  unchanged?: true;
}

/** Creates a new run directory under a server-minted run id. */
export function newRun(matterRoot: string): { run_id: string; run_dir: string } {
  const run = createRun(openMatter(matterRoot));
  return { run_id: run.runId, run_dir: run.dir };
}

/**
 * Writes `fileName` (proposal.json, questions.json or rule_gaps.json) into run `runId`, under its
 * lowercase name. proposal.json must validate, is written temp-then-rename, and is write-once:
 * rewriting it with other content is refused, so an approval can never name rows the page did not
 * show.
 */
export function writeRunFile(matterRoot: string, runId: string, fileName: string, content: string): WriteRunFileResult {
  const problem = bareNameProblem(fileName);
  if (problem) throw new DataServerError(`file_name ${problem}: ${fileName}`, "invalid_filename");
  const lower = fileName.toLowerCase();
  if (lower === APPROVAL || lower === JOURNAL) {
    throw new DataServerError(`${fileName} is written only by ${lower === APPROVAL ? "the approval page" : "housekeeping__journal_append"}`, "reserved_file");
  }
  if (!RUN_FILES.includes(lower)) {
    throw new DataServerError(`file_name must be one of ${RUN_FILES.join(", ")}: ${fileName}`, "invalid_filename");
  }

  const matter = openMatter(matterRoot);
  const run = { runId, dir: existingRunDir(matter, runId) };
  let parsed: unknown;
  if (lower === PROPOSAL) {
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new DataServerError(`proposal.json content does not parse: ${(err as Error).message}`, "invalid_proposal");
    }
  }
  const path = runFilePath(run.dir, lower);
  if (lower === PROPOSAL) {
    const problems = validateProposal(parsed, run.runId, matter.root);
    if (problems.length) throw new DataServerError(`proposal.json is invalid: ${problems.join("; ")}`, "invalid_proposal");
    const outOfOrder = orderProblem(matter, run.runId, (parsed as Proposal).rows);
    if (outOfOrder) throw new DataServerError(`proposal.json breaks the order or the 50-file cap: ${outOfOrder}`, "proposal_out_of_order");
    if (existsSync(path)) {
      if (readFileSync(path, "utf-8") === content) return { run_id: run.runId, path, bytes: Buffer.byteLength(content), unchanged: true };
      throw new DataServerError(`run ${run.runId} already has a proposal.json; start a new run to propose again`, "proposal_exists");
    }
  }
  writeReplacing(path, content);
  return { run_id: run.runId, path, bytes: Buffer.byteLength(content) };
}

/** Appends `{row_id, outcome, reason?}` to applied.jsonl after a move row's last step or its failure. */
export function journalAppend(
  matterRoot: string,
  runId: string,
  rowId: string,
  outcome: string,
  reason?: string
): { path: string; line: { row_id: string; outcome: string; reason?: string } } {
  if (outcome !== "done" && outcome !== "failed") {
    throw new DataServerError(`outcome must be done or failed: ${outcome}`, "invalid_argument");
  }
  const matter = openMatter(matterRoot);
  const dir = existingRunDir(matter, runId);
  const proposal = requireProposal(dir, runId, matter.root);
  if (!proposal.rows.some((r) => r.row_id === rowId)) {
    throw new DataServerError(`row ${rowId} is not in run ${runId}'s proposal.json`, "unknown_row");
  }
  requireApproval(dir, runId);
  const earlier = readJournal(dir).get(rowId);
  if (earlier) {
    throw new DataServerError(`row ${rowId} is already journalled ${earlier.outcome}${earlier.reason ? ` (${earlier.reason})` : ""}`, "already_journalled");
  }
  const line = reason === undefined ? { row_id: rowId, outcome } : { row_id: rowId, outcome, reason };
  const path = runFilePath(dir, JOURNAL);
  appendLineDurably(path, JSON.stringify(line));
  return { path, line };
}
