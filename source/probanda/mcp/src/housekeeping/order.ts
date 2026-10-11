// The order and the 50-file cap of a /housekeeping run (spec §B3.4).
//
// Admitted candidates are ordered fresh root, fresh subfolder, rotated root, rotated subfolder:
// root files by name, subfolder files by folder, then name, each compared lowercased by UTF-16
// code unit. A candidate is rotated when its hash was an offered row on the previous run's page
// and that run's approval.json holds no approve entry for it (a row left as is, or a stuck or
// misfiled row, which is never approved). Match by hash, never by name. The previous run is the
// newest run earlier than this one whose proposal.json is valid, approved or not; none makes
// every candidate fresh. The first 50 in order are the run's rows; the rest are deferred.
//
// housekeeping__order_candidates computes this before ingest, so ingest reads exactly the admitted
// list, and housekeeping__write_run_file checks proposal.json against it. The check is not part of
// validateProposal, which also reads old proposals written before the order was enforced. It sees
// only the rows written, so it cannot tell that an admitted file was left off the page.

import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { HASH_RE, INFORMATION_ONLY, type Row, relativePathProblem, samePath } from "./proposal.js";
import { APPROVAL, type Matter, existingRunDir, listRuns, openMatter, readApproval, readProposal } from "./run-dir.js";

export const CAP = 50;

export interface Candidate {
  path: string;
  hash: string;
}

export interface OrderedCandidate extends Candidate {
  rotated: boolean;
}

export interface OrderResult {
  run_id: string;
  /** The run rotation was read from, or null (every candidate fresh). */
  previous_run: string | null;
  /** This run's rows, in order: at most 50. */
  admitted: OrderedCandidate[];
  /** Past the cap, in order: `deferred` rows. */
  deferred: OrderedCandidate[];
}

/**
 * The hashes that rotate: offered on the previous run's page and not approved there. A stuck or
 * misfiled row is never approved, whatever approval.json holds.
 */
function rotation(matter: Matter, runId: string): { previousRun: string | null; rotated: Set<string> } {
  const earlier = listRuns(matter).filter((id) => id < runId);
  for (let i = earlier.length - 1; i >= 0; i--) {
    const id = earlier[i];
    const dir = pathWin32.join(matter.housekeeping, id);
    const { proposal } = readProposal(dir, id, matter.root);
    if (!proposal) continue;
    const { approval, problem } = readApproval(dir, id);
    if (problem) {
      throw new DataServerError(
        `run ${id}: the saved approval ${pathWin32.join(dir, APPROVAL)} is unreadable, so rotation cannot be read from it (if it is only locked, retry): ${problem}`,
        "approval_corrupt"
      );
    }
    const approved = new Set((approval?.rows ?? []).map((e) => e.row_id));
    const rotates = (r: Row) => r.section === "offered" && (!approved.has(r.row_id) || INFORMATION_ONLY.includes(r.action!.kind));
    const rotated = new Set(proposal.rows.filter(rotates).map((r) => r.hash));
    return { previousRun: id, rotated };
  }
  return { previousRun: null, rotated: new Set() };
}

/**
 * Sort key: rotated, then subfolder, then folder, then name, lowercased. The folder's separators
 * become U+0000, below every character a name can hold, so folders compare segment by segment
 * (`a\b` before `a b`) and a folder's own files come before those of the folders inside it.
 */
function sortKey(c: OrderedCandidate): [number, number, string, string] {
  const path = samePath(c.path);
  const cut = path.lastIndexOf("\\");
  return [c.rotated ? 1 : 0, cut < 0 ? 0 : 1, cut < 0 ? "" : path.slice(0, cut).replace(/\\/g, "\0"), path.slice(cut + 1)];
}

function compare(a: OrderedCandidate, b: OrderedCandidate): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

function orderIn(matter: Matter, runId: string, candidates: Candidate[]): OrderResult {
  const { previousRun, rotated } = rotation(matter, runId);
  const ordered = candidates.map((c) => ({ path: c.path, hash: c.hash, rotated: rotated.has(c.hash) })).sort(compare);
  return { run_id: runId, previous_run: previousRun, admitted: ordered.slice(0, CAP), deferred: ordered.slice(CAP) };
}

/**
 * Orders run `runId`'s admitted candidates and caps them at 50. Every candidate is a
 * matter-root-relative path with its SHA-256; a path given twice is refused.
 */
export function orderCandidates(matterRoot: string, runId: string, candidates: unknown): OrderResult {
  const matter = openMatter(matterRoot);
  existingRunDir(matter, runId);
  if (!Array.isArray(candidates)) throw new DataServerError("candidates must be an array of {path, hash}", "invalid_argument");
  const seen = new Set<string>();
  candidates.forEach((c, i) => {
    const refuse = (problem: string) => new DataServerError(`candidates[${i}] ${problem}`, "invalid_argument");
    if (typeof c !== "object" || c === null) throw refuse("must be an object {path, hash}");
    const pathProblem = relativePathProblem(c.path);
    if (pathProblem) throw refuse(`path ${pathProblem}`);
    if (typeof c.hash !== "string" || !HASH_RE.test(c.hash)) throw refuse("hash must be a lowercase SHA-256 hex digest");
    if (seen.has(samePath(c.path))) throw refuse(`path ${c.path} is given twice`);
    seen.add(samePath(c.path));
  });
  return orderIn(matter, runId, candidates as Candidate[]);
}

/**
 * Why proposal.json's rows break the order or the cap, naming the first row out of place, or
 * null. The expected order is recomputed from the rows themselves (every row is an admitted
 * candidate) against the same previous run housekeeping__order_candidates reads.
 */
export function orderProblem(matter: Matter, runId: string, rows: Row[]): string | null {
  const { admitted, deferred } = orderIn(matter, runId, rows.map((r) => ({ path: r.current_path, hash: r.hash })));
  const expected = [...admitted, ...deferred];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const want = expected[i];
    if (samePath(r.current_path) !== samePath(want.path)) {
      return `rows[${i}] (${r.row_id}) ${r.current_path} is out of order: row ${i + 1} must be ${want.path}${want.rotated ? " (rotated)" : ""}; order fresh root, fresh subfolder, rotated root, rotated subfolder, each by folder then name (housekeeping__order_candidates returns it)`;
    }
    const capped = i >= CAP;
    if (capped !== (r.section === "deferred")) {
      return capped
        ? `rows[${i}] (${r.row_id}) is past the ${CAP}-file cap and must be deferred`
        : `rows[${i}] (${r.row_id}) is deferred, but only rows past the first ${CAP} are deferred`;
    }
  }
  return null;
}
