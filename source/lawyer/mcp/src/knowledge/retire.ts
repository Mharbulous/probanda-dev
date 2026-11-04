// ------------------------------------------------------------ knowledge__retire --

import { existsSync, readFileSync, renameSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { withFileLock } from "../file-lock.js";
import { identicalText, locate, parseKnowledgePath, readLayerFiles, SIDECAR_SUFFIX, entryType, type KnowledgePath, type KnowledgeSeams } from "./tree.js";
import { provenance } from "./common.js";
import { knowledgeList, type GrammarBreak, type ListEntry } from "./list.js";
import { grammarCheck, matterOf, writableOverlayPath, type Args, type WriteSeams } from "./overlay.js";
import { deleteUnreferencedPdfs, pdfHashesIn } from "./fetched.js";

interface Retired {
  path: string;
  to: string;
  sidecar_to?: string;
  pdf_hashes: string[];
}

/** Move one overlay file, and its sidecar with it, to `_superseded\<same path>`. */
async function retireOne(kp: KnowledgePath, seams: KnowledgeSeams, label: string): Promise<Retired> {
  if (entryType(locate(kp, seams, label).local, label, kp.path) === null) {
    throw new DataServerError(`${kp.path} is not in the overlay (a second retire getting not_found counts as done)`, "not_found");
  }
  const dest = parseKnowledgePath(`_superseded/${kp.path}`, label);
  grammarCheck(dest, "file", label);
  const source = writableOverlayPath(kp, seams, label);
  const sidecar = `${source.abs}${SIDECAR_SUFFIX}`;
  // Both locks before any check, so a concurrent confirm cannot write a sidecar beside a file being retired.
  return withFileLock(source.abs, () =>
    withFileLock(sidecar, () => {
      const type = entryType(source, label, kp.path);
      if (type === null) throw new DataServerError(`${kp.path} is not in the overlay (a second retire getting not_found counts as done)`, "not_found");
      if (type === "dir") throw new DataServerError(`${label}: ${kp.path} is a folder; retire moves one file and its sidecar`, "not_a_file");
      const hasSidecar = existsSync(sidecar);
      const to = pathWin32.join(source.canon, ...dest.segments);
      for (const abs of [to, ...(hasSidecar ? [`${to}${SIDECAR_SUFFIX}`] : [])]) {
        if (existsSync(abs)) {
          throw new DataServerError(`${abs} already holds a retired copy, which is never overwritten; nothing was moved`, "superseded_exists");
        }
      }
      // The destination folder is made only now, once the move is certain, so a refused retire leaves none behind.
      const target = writableOverlayPath(dest, seams, label);
      const text = readFileSync(source.abs, "utf-8");
      renameSync(source.abs, target.abs);
      if (hasSidecar) renameSync(sidecar, `${target.abs}${SIDECAR_SUFFIX}`);
      return {
        path: kp.path,
        to: dest.path,
        ...(hasSidecar ? { sidecar_to: `${dest.path}${SIDECAR_SUFFIX}` } : {}),
        pdf_hashes: pdfHashesIn(text),
      };
    })
  );
}

/** A file the sweep left in place because `_superseded\` already holds a retired copy of it. */
interface Skipped {
  path: string;
  reason: string;
}

/**
 * The sweep: every overlay file whose shipped copy is identical after line-ending
 * normalization. A file whose retired copy already exists is skipped and reported; the sweep goes on.
 */
async function retireShadowed(seams: KnowledgeSeams, label: string): Promise<{ retired: Retired[]; skipped: Skipped[] }> {
  const listing = knowledgeList({ recursive: true }, seams);
  const broken = new Set((listing.grammar_breaks as GrammarBreak[]).map((entry) => entry.path));
  const retired: Retired[] = [];
  const skipped: Skipped[] = [];
  for (const entry of listing.entries as ListEntry[]) {
    if (entry.type !== "file" || entry.layers.length !== 2 || broken.has(entry.path)) continue;
    const kp = parseKnowledgePath(entry.path, label);
    const { shipped, local } = readLayerFiles(locate(kp, seams, label), label);
    if (!shipped || !local || !identicalText(shipped.text, local.text)) continue;
    try {
      retired.push(await retireOne(kp, seams, label));
    } catch (err) {
      if (!(err instanceof DataServerError && err.code === "superseded_exists")) throw err;
      skipped.push({ path: entry.path, reason: err.message });
    }
  }
  return { retired, skipped };
}

/**
 * knowledge__retire: move one overlay file and its sidecar to `_superseded\`, or with
 * `shadowed_only: true` sweep every overlay file the shipped tree now holds identically.
 * Then delete each `_fetched\` PDF whose hash no live excerpt records any more.
 */
export async function knowledgeRetire(args: Args, seams: WriteSeams = {}): Promise<Record<string, unknown>> {
  const label = "knowledge__retire.path";
  matterOf(args.matter, "knowledge__retire");
  let retired: Retired[];
  let skipped: Skipped[] | null = null;
  if (args.shadowed_only === true) {
    if (args.path !== undefined) throw new ValidationError("knowledge__retire.shadowed_only sweeps the whole overlay; pass no path");
    ({ retired, skipped } = await retireShadowed(seams, label));
  } else {
    const kp = parseKnowledgePath(args.path, label);
    if (!kp.skill) throw new DataServerError(`${label}: knowledge__retire moves a skill tree's file; "${kp.head}" is not one`, "reserved_entry");
    if (kp.path.endsWith(SIDECAR_SUFFIX)) throw new DataServerError(`${label}: a sidecar moves with its file; name the file (${kp.path})`, "reserved_suffix");
    grammarCheck(kp, "file", label);
    retired = [await retireOne(kp, seams, label)];
  }
  const hashes = [...new Set(retired.flatMap((entry) => entry.pdf_hashes))];
  return {
    retired: retired.map(({ pdf_hashes: _hashes, ...entry }) => entry),
    ...(skipped ? { skipped } : {}),
    fetched_deleted: deleteUnreferencedPdfs(hashes, seams, label),
    ...provenance(null, seams),
  };
}
