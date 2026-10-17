// The /housekeeping run directory (housekeeping redesign spec §B8.1).
//
// Every file of a run lives in `<case-data folder>\housekeeping\<run-id>\`, the case-data folder
// being the one the matter's probanda.json names (.claude/skills/AGENTS.md "Workspace output
// rule"). It must already exist; `housekeeping` beneath it is created on demand. This server
// writes every file of a run: the session cannot write into the case-data folder in the
// linked-device topology. The confinement is a realpath equality, not a prefix test: the run
// directory's canonical path must be exactly the canonical case-data folder, `housekeeping` and
// the run id, so a junction anywhere along that chain fails it.
//
// Run directories are never deleted by code, and every reader tolerates a missing one. A name
// that is not a run id is ignored by every reader.

import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { existingCaseDataFolder, validateMatterRoot } from "../files/matter-root.js";
import { writeStatusFile } from "../submission/render-job.js";
import { type Approval, type Proposal, validateApproval, validateProposal } from "./proposal.js";
import { inFirewall } from "./zones.js";

/**
 * Fixed-width local timestamp to the millisecond plus a short random suffix:
 * `20260924-204013123-a1b2`. Sorts by time, within one second too. A run directory named before
 * the milliseconds were added (`20260924-204013-a1b2`) still reads.
 */
export const RUN_ID_RE = /^\d{8}-\d{6}(?:\d{3})?-[0-9a-f]{4}$/;

export const PROPOSAL = "proposal.json";
export const APPROVAL = "approval.json";
export const JOURNAL = "applied.jsonl";

export interface Matter {
  /** Canonical (realpath) matter root. */
  root: string;
  /** Canonical case-data folder, which exists. */
  caseData: string;
  /** Canonical `<case-data folder>\housekeeping`, whether or not it exists yet. */
  housekeeping: string;
}

/**
 * Validates the matter root (probanda.json present) and finds its case-data folder, which must
 * exist (`case_data_missing` otherwise). A read never makes a folder.
 */
export function openMatter(matterRoot: string): Matter {
  const root = validateMatterRoot(matterRoot);
  const caseData = existingCaseDataFolder(root);
  return { root, caseData, housekeeping: pathWin32.join(caseData, "housekeeping") };
}

export function mintRunId(now = new Date()): string {
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${p(now.getMilliseconds(), 3)}`;
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    throw new DataServerError(`run_id must look like 20260924-204013123-a1b2: ${runId}`, "invalid_run_id");
  }
}

/** Creates a new run directory under a server-minted id. Only this server mints run ids. */
export function createRun(matter: Matter, now = new Date()): { runId: string; dir: string } {
  // Before creating anything: an existing link along the chain would carry the mkdir outside.
  for (let dir = matter.housekeeping; dir.length > matter.caseData.length; dir = pathWin32.dirname(dir)) {
    if (existsSync(dir) && realpathSync.native(dir).toLowerCase() !== dir.toLowerCase()) {
      throw new DataServerError(`${dir} resolves elsewhere (${realpathSync.native(dir)})`, "path_out_of_scope");
    }
  }
  for (;;) {
    const runId = mintRunId(now);
    const dir = pathWin32.join(matter.housekeeping, runId);
    if (existsSync(dir)) continue;
    mkdirSync(dir, { recursive: true });
    return { runId, dir: confineRunDir(matter, runId) };
  }
}

/** The existing, confined directory of `runId`. */
export function existingRunDir(matter: Matter, runId: string): string {
  assertRunId(runId);
  const dir = pathWin32.join(matter.housekeeping, runId);
  if (!isDirectory(dir)) throw new DataServerError(`no run directory ${runId} under ${matter.housekeeping}`, "run_not_found");
  return confineRunDir(matter, runId);
}

function confineRunDir(matter: Matter, runId: string): string {
  const expected = pathWin32.join(matter.housekeeping, runId);
  const real = realpathSync.native(expected);
  const segments = pathWin32.relative(matter.caseData, real).split(pathWin32.sep);
  if (real.toLowerCase() !== expected.toLowerCase() || inFirewall(segments)) {
    throw new DataServerError(`run directory resolves outside the case-data folder's housekeeping folder (${expected} -> ${real})`, "path_out_of_scope");
  }
  return real;
}

/** A file of the run directory, by bare name. A file that resolves elsewhere (a link) is refused. */
export function runFilePath(runDir: string, fileName: string): string {
  const path = pathWin32.join(runDir, fileName);
  if (existsSync(path) && realpathSync.native(path).toLowerCase() !== path.toLowerCase()) {
    throw new DataServerError(`${fileName} in the run directory resolves elsewhere: ${path}`, "path_out_of_scope");
  }
  return path;
}

/** Run ids under the case-data folder's housekeeping folder, oldest first. A missing folder is no runs. */
export function listRuns(matter: Matter): string[] {
  if (!isDirectory(matter.housekeeping)) return [];
  return readdirSync(matter.housekeeping, { withFileTypes: true })
    .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * The newest run directory later than `runId`, whether or not it has a proposal yet, or null. Its
 * existence invalidates `runId`'s page (spec A4: an old page stops working as soon as a new run
 * starts).
 */
export function newerRun(matter: Matter, runId: string): string | null {
  const runs = listRuns(matter);
  const newest = runs[runs.length - 1];
  return newest !== undefined && newest > runId ? newest : null;
}

/** The newest run directory holding a parseable, valid proposal.json, or null. */
export function newestProposalRun(matter: Matter): string | null {
  const runs = listRuns(matter);
  for (let i = runs.length - 1; i >= 0; i--) {
    if (readProposal(pathWin32.join(matter.housekeeping, runs[i]), runs[i], matter.root).proposal) return runs[i];
  }
  return null;
}

/** proposal.json, or the reason it cannot be used. A half-written file reads as no proposal. */
export function readProposal(runDir: string, runId: string, root: string): { proposal: Proposal | null; problem?: string } {
  let text: string;
  try {
    text = readFileSync(pathWin32.join(runDir, PROPOSAL), "utf-8");
  } catch {
    return { proposal: null, problem: "no proposal.json" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { proposal: null, problem: `proposal.json does not parse: ${(err as Error).message}` };
  }
  const problems = validateProposal(parsed, runId, root);
  if (problems.length) return { proposal: null, problem: `proposal.json is invalid: ${problems.join("; ")}` };
  return { proposal: parsed as Proposal };
}

/** The valid proposal of `runDir`, or a thrown refusal. */
export function requireProposal(runDir: string, runId: string, root: string): Proposal {
  const { proposal, problem } = readProposal(runDir, runId, root);
  if (!proposal) throw new DataServerError(`run ${runId}: ${problem}`, "invalid_proposal");
  return proposal;
}

/**
 * approval.json, or why it cannot be used. A missing file is no approval and no problem; a file
 * that is there but unreadable, unparseable or invalid is a problem, never read as no approval.
 */
export function readApproval(runDir: string, runId: string): { approval: Approval | null; problem?: string } {
  let text: string;
  try {
    text = readFileSync(pathWin32.join(runDir, APPROVAL), "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? { approval: null } : { approval: null, problem: `approval.json cannot be read (${code})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { approval: null, problem: `approval.json does not parse: ${(err as Error).message}` };
  }
  const problems = validateApproval(parsed, runId);
  if (problems.length) return { approval: null, problem: `approval.json is invalid: ${problems.join("; ")}` };
  return { approval: parsed as Approval };
}

/** The approval of `runDir`, or a thrown refusal: `not_approved` when missing, `approval_corrupt` when unusable. */
export function requireApproval(runDir: string, runId: string): Approval {
  const { approval, problem } = readApproval(runDir, runId);
  if (approval) return approval;
  if (problem) {
    throw new DataServerError(
      `run ${runId}: the saved approval ${pathWin32.join(runDir, APPROVAL)} is unreadable, so nothing is applied from it: ${problem}`,
      "approval_corrupt"
    );
  }
  throw new DataServerError(`run ${runId} has no approval.json; nothing was approved`, "not_approved");
}

export interface JournalLine {
  row_id: string;
  outcome: "done" | "failed";
  reason?: string;
}

/** applied.jsonl as row id -> its first line. A torn line is skipped. */
export function readJournal(runDir: string): Map<string, JournalLine> {
  const lines = new Map<string, JournalLine>();
  let text: string;
  try {
    text = readFileSync(pathWin32.join(runDir, JOURNAL), "utf-8");
  } catch {
    return lines;
  }
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const line = JSON.parse(raw) as JournalLine;
      if (typeof line?.row_id === "string" && !lines.has(line.row_id)) lines.set(line.row_id, line);
    } catch {
      // A line torn by a crash mid-append.
    }
  }
  return lines;
}

/** Writes `text` whole, then flushes it to disk before returning. Fails if the file exists. */
export function writeNewDurably(path: string, text: string): void {
  const fd = openSync(path, "wx");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Appends one line and flushes it to disk. A torn previous line is closed off first. */
export function appendLineDurably(path: string, line: string): void {
  let prefix = "";
  if (existsSync(path)) {
    const text = readFileSync(path, "utf-8");
    if (text.length && !text.endsWith("\n")) prefix = "\n";
  }
  const fd = openSync(path, "a");
  try {
    writeSync(fd, prefix + line + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Temp-then-rename with the bounded retry OneDrive needs (submission/render-job.ts). */
export function writeReplacing(path: string, text: string): void {
  const code = writeStatusFile(path, text);
  if (code) throw new DataServerError(`could not write ${path}: ${code}`, "write_failed");
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
