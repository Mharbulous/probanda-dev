// The write side's shared checks: the live matter, refused arguments, the folder grammar, and an overlay path made safe to write.

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { assertContained } from "../files/scope.js";
import { resolveCaseDataRoot } from "../practice/backend.js";
import type { SourceFetcher } from "../sources/fetch.js";
import { grammarProblem, locate, parseKnowledgePath, entryType, type EntryType, type KnowledgePath, type KnowledgeSeams, type LayerRoot } from "./tree.js";

/**
 * The record contract's repo-run marker (shared/knowledge-tree.md section 8). A repo
 * session writes the shipped tree through the scratchpad and a reviewed commit (section
 * 9), never the overlay, and never confirms or corrects (section 10).
 */
export const REPO_RUN_MARKER = "repo-run";

export interface WriteSeams extends KnowledgeSeams {
  /** Tests only: the fetcher whose memo excerpts are checked against. Production uses the runtime's one fetcher. */
  fetcher?: SourceFetcher;
  /** The practice-data matters whose `matt_num` is the given number. Production wires practice_data__matter_lookup. */
  lookUpMatter?: (mattNum: string) => Promise<Record<string, unknown>[]>;
}

export type Args = Record<string, unknown>;
export type Json = Record<string, unknown>;

/** The live matter a write serves. The repo-run marker is refused: the overlay is written only from a matter session. */
export function matterOf(raw: unknown, tool: string): string {
  if (typeof raw !== "string" || raw.trim() === "" || /[\r\n]/.test(raw)) {
    throw new ValidationError(`${tool}.matter must name, on one line, the live matter this run serves`);
  }
  if (raw.trim() === REPO_RUN_MARKER) {
    throw new DataServerError(
      `${tool}: a repo session never writes the firm overlay and never confirms or corrects: it writes the shipped tree ` +
        "through the scratchpad and a reviewed commit, and confirmation happens only in a matter session (shared/knowledge-tree.md sections 9 and 10)",
      "repo_session"
    );
  }
  return raw.trim();
}

/**
 * The matter number a document is stamped with: the `matt_num` of the one practice-data
 * matter the caller's `matter` names. The caller's string itself is never stamped, so a
 * style of cause or a party's name cannot reach the shared overlay.
 */
export async function stampedMatter(matter: string, seams: WriteSeams, path: string): Promise<string> {
  if (!seams.lookUpMatter) throw new Error("knowledge__write: no practice-data matter lookup is wired");
  const rows = await seams.lookUpMatter(matter);
  if (rows.length !== 1 || typeof rows[0].matt_num !== "string") {
    throw new DataServerError(
      `${path}: matter_unknown: ${JSON.stringify(matter)} is not the matter number of exactly one practice-data matter ` +
        `(found ${rows.length}). Pass the live matter's number (e.g. L1234), never its name. Nothing was written.`,
      "matter_unknown"
    );
  }
  return rows[0].matt_num;
}

export function refuseArgs(args: Args, keys: string[], why: string): void {
  const present = keys.filter((key) => args[key] !== undefined);
  if (present.length) throw new ValidationError(`knowledge__write: ${present.join(", ")} ${present.length === 1 ? "does" : "do"} not apply ${why}`);
}

export function grammarCheck(kp: KnowledgePath, type: EntryType, label: string): void {
  const problem = grammarProblem(kp.head, kp.rest, type, "local");
  if (problem) throw new DataServerError(`${label}: ${kp.path} breaks the folder grammar: ${problem}`, "grammar_violation");
}

/**
 * Create `dir` and its missing parents, but only after proving that its deepest existing
 * ancestor's real path lies inside `root`, so a junction cannot put new folders outside it.
 */
function mkdirInside(root: string, dir: string, label: string, original: string): void {
  let existing = dir;
  while (!existsSync(existing)) {
    const parent = pathWin32.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  assertContained(root, realpathSync.native(existing), label, original);
  mkdirSync(dir, { recursive: true });
}

/** The overlay root's real path, created when absent and proven inside the case data root. */
export function overlayCanon(seams: KnowledgeSeams, label: string): string {
  const root = parseKnowledgePath("", label, true);
  let layer = locate(root, seams, label).local;
  if (layer.canon === null) {
    mkdirInside(realpathSync.native(resolveCaseDataRoot(seams.env ?? process.env)), layer.abs, label, "(knowledge root)");
    layer = locate(root, seams, label).local;
  }
  return layer.canon!;
}

/** Where `kp` lives in the overlay, its folder created and proven inside the overlay root, as is any entry already there. */
export function writableOverlayPath(kp: KnowledgePath, seams: KnowledgeSeams, label: string): LayerRoot & { canon: string } {
  locate(kp, seams, label); // the path-length check
  const canon = overlayCanon(seams, label);
  const abs = pathWin32.join(canon, ...kp.segments);
  mkdirInside(canon, pathWin32.dirname(abs), label, kp.path);
  assertContained(canon, realpathSync.native(pathWin32.dirname(abs)), label, kp.path);
  entryType({ canon, abs }, label, kp.path);
  return { canon, abs };
}

export function rowString(row: Json, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value === "") throw new ValidationError(`knowledge__write.row.${key} must be a non-empty string`);
  return value;
}
