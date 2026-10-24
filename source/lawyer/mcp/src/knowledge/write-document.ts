// ------------------------------------------------------------ documents --

import { readFileSync } from "node:fs";

import { DataServerError, ValidationError } from "../errors.js";
import { pluginVersion } from "../repo-root.js";
import { parseItems, readFrontMatter, type FrontMatter } from "../sources/check.js";
import { htmlBlocks, passagePresent, sourcesFetcher, type SourceFetcher } from "../sources/fetch.js";
import { withFileLock, writeTextAtomic } from "./sidecar.js";
import { locate, entryType, type KnowledgePath } from "./tree.js";
import { provenance } from "./common.js";
import { blockOf, itemsOf } from "./items.js";
import { refuseArgs, stampedMatter, writableOverlayPath, type Args, type WriteSeams } from "./overlay.js";
import { copySavedCopy, deleteUnreferencedPdfs, pdfHashesIn, savedCopyOf } from "./fetched.js";

/** The size cap on one document file written to the overlay. */
export const MAX_DOCUMENT_BYTES = 200 * 1024;

/** Header fields the runtime stamps on every overlay document it writes, replacing any the content carries. */
const STAMPED = ["learned_by", "matter", "plugin_version", "shipped_from"] as const;
type Stamp = Record<(typeof STAMPED)[number], string | null>;

/**
 * The content with the runtime's fields opening its front matter, replacing any it carried:
 * the provenance stamp (section 8), and a saved PDF copy's `pdf_sha256`.
 */
function stampHeader(content: string, stamp: Record<string, string | null>): string {
  const keys = Object.keys(stamp);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const end = lines.findIndex((line, i) => i > 0 && (line.trimEnd() === "---" || line.trimEnd() === "..."));
  const kept: string[] = [];
  for (let i = 1; i < end; i++) {
    const key = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(lines[i])?.[1];
    if (key !== undefined && keys.includes(key)) {
      // The key's own continuation lines (a block list or block scalar) go with it.
      while (i + 1 < end && (lines[i + 1].trim() === "" || /^\s/.test(lines[i + 1]))) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  const header = keys.map((key) => `${key}: ${stamp[key] === null ? "null" : JSON.stringify(stamp[key])}`);
  return [lines[0], ...header, ...kept, ...lines.slice(end)].join(eol);
}

/** The joined text of a page's live memoized fetch, or a memo_expired refusal naming the URL (#989 item 2). */
function memoizedPage(path: string, pageUrl: string, fetcher: SourceFetcher): string {
  const memo = fetcher.memoized(pageUrl);
  if (memo === null || memo === "expired") {
    throw new DataServerError(
      `${path}: memo_expired: ${pageUrl} has no live memoized fetch in this session (${memo === null ? "never fetched" : "fetched over 24 hours ago"}); ` +
        "fetch it again with sources__fetch, then retry the write. Nothing was written.",
      "memo_expired"
    );
  }
  return htmlBlocks(memo.bytes.toString("utf-8")).join(" ");
}

/**
 * Every HTML-sourced item of a source record must appear in the memoized text of its page.
 * An item transcribed from a file (`checked_by: file_sha256`) is not checked here, nor is a
 * /publish property the practitioner sourced; any other item outside a record with a
 * `page_url` has nothing to be checked against and is refused.
 */
function checkExcerpts(path: string, front: FrontMatter, fetcher: SourceFetcher): void {
  const pageUrl = front.page_url;
  const items = parseItems(front, path).filter((item) => !item.fromFile && item.source !== "practitioner");
  if (items.length === 0) return;
  if (typeof pageUrl !== "string" || pageUrl === "") {
    throw new DataServerError(
      `${path}: rule_ref ${items.map((item) => JSON.stringify(item.rule_ref)).join(", ")} is neither transcribed from a file ` +
        "(checked_by: file_sha256) nor in a source record with a page_url, so its passage cannot be checked. Nothing was written.",
      "invalid_source_record"
    );
  }
  const joined = memoizedPage(path, pageUrl, fetcher);
  const missing = items.filter((item) => !passagePresent(joined, item.passage)).map((item) => JSON.stringify(item.rule_ref));
  if (missing.length) {
    throw new DataServerError(
      `${path}: excerpt_mismatch: the passage of rule_ref ${missing.join(", ")} is not in the memoized text of ${pageUrl}. Nothing was written.`,
      "excerpt_mismatch"
    );
  }
}

/** A currency marker as a date: ISO or "September 1, 2020". Any other marker is not ordered. */
function markerTime(marker: string): number {
  return /^(?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2}, \d{4})$/.test(marker) ? Date.parse(marker) : NaN;
}

/** How a refresh's currency markers were compared: in order, not orderable (a marker that is not a date), or not at all. */
type StaleCheck = "compared" | "not_ordered" | "no_pattern";

/**
 * A refresh (an overwrite of a source record) is refused as `stale_body` when the page it
 * was fetched from shows a currency marker older than the one the file records (#989 item 4).
 * Returns how the markers were compared, or null when the new file is not a source record.
 */
function checkStaleBody(path: string, existingAbs: string, previous: string, front: FrontMatter, fetcher: SourceFetcher): StaleCheck | null {
  const pageUrl = front.page_url;
  if (typeof pageUrl !== "string") return null;
  const old = readFrontMatter(previous, `the existing overlay copy of ${path} at ${existingAbs}`);
  const recorded = old?.currency_marker;
  const pattern = old?.currency_marker_pattern;
  if (typeof pattern !== "string") return "no_pattern";
  if (typeof recorded !== "string") return "not_ordered";
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "g");
  } catch (err) {
    throw new DataServerError(`${path}: its recorded currency_marker_pattern is not a valid regular expression: ${(err as Error).message}`, "invalid_source_record");
  }
  const found = [...new Set([...memoizedPage(path, pageUrl, fetcher).matchAll(regex)].map((m) => (m.length > 1 ? (m[1] ?? "") : m[0])))];
  const times = found.map(markerTime);
  const recordedTime = markerTime(recorded);
  if (found.length === 0 || Number.isNaN(recordedTime) || times.some((time) => Number.isNaN(time))) return "not_ordered";
  if (Math.max(...times) < recordedTime) {
    throw new DataServerError(
      `${path}: stale_body: ${pageUrl} shows ${found.map((marker) => JSON.stringify(marker)).join(", ")}, older than the recorded currency marker ${JSON.stringify(recorded)}. Nothing was written.`,
      "stale_body"
    );
  }
  return "compared";
}

export async function writeDocument(kp: KnowledgePath, args: Args, matter: string, seams: WriteSeams, label: string): Promise<Record<string, unknown>> {
  refuseArgs(args, ["row"], "to a document file");
  const mattNum = await stampedMatter(matter, seams, kp.path);
  const content = args.content;
  if (typeof content !== "string" || content.trim() === "") throw new ValidationError("knowledge__write.content must be the document's full text");
  if (!kp.path.endsWith(".md")) {
    throw new DataServerError(`${label}: knowledge__write creates .md documents and index rows only; ${kp.path} is neither`, "grammar_violation");
  }
  if (/\x00/.test(content)) throw new ValidationError("knowledge__write.content must be text; it holds a NUL character");
  const size = Buffer.byteLength(content, "utf-8");
  if (size > MAX_DOCUMENT_BYTES) {
    throw new DataServerError(`${kp.path}: ${size} bytes, over the ${MAX_DOCUMENT_BYTES}-byte cap on a knowledge document`, "too_large");
  }
  const loc = locate(kp, seams, label);
  if (loc.shipped && entryType(loc.shipped, label, kp.path) !== null) {
    throw new DataServerError(
      `${label}: ${kp.path} exists in the shipped tree, so the overlay never holds it: a firm correction is a correct row, ` +
        "and a shipped file changes only by a repo-session refresh",
      "shipped_path"
    );
  }
  const front = readFrontMatter(content, kp.path);
  if (!front) throw new DataServerError(`${kp.path}: a learned file opens with its front matter header (shared/knowledge-tree.md section 8)`, "invalid_front_matter");
  blockOf(kp, content, { corrections: [] }, itemsOf(kp, front, seams, label).items);
  const fetcher = seams.fetcher ?? sourcesFetcher;
  checkExcerpts(kp.path, front, fetcher);
  const saved = args.saved_copy === undefined ? null : savedCopyOf(args.saved_copy, kp.path, front, seams);

  const stamp: Stamp = { learned_by: "agent", matter: mattNum, plugin_version: pluginVersion(seams.installRoot), shipped_from: loc.shipped_from };
  const text = stampHeader(content, saved?.pdf ? { ...stamp, pdf_sha256: saved.pdf.sha256 } : stamp);
  const target = writableOverlayPath(kp, seams, label);
  const previous = await withFileLock(target.abs, () => {
    const existing = entryType(target, label, kp.path);
    if (existing === "dir") throw new DataServerError(`${label}: ${kp.path} is a folder in the overlay`, "not_a_file");
    if (existing === "file" && args.overwrite !== true) {
      throw new DataServerError(
        `${kp.path} already exists in the overlay: re-read it with knowledge__read and return that path, or pass overwrite: true to replace it`,
        "exists"
      );
    }
    const old = existing === "file" ? readFileSync(target.abs, "utf-8") : null;
    const stale_check = old === null ? null : checkStaleBody(kp.path, target.abs, old, front, fetcher);
    writeTextAtomic(target.abs, text);
    return { old, stale_check };
  });
  return {
    path: kp.path,
    layer: "local",
    status: previous.old === null ? "created" : "overwritten",
    size: Buffer.byteLength(text, "utf-8"),
    header: stamp,
    ...(previous.stale_check ? { stale_check: previous.stale_check } : {}),
    ...(saved ? { saved_copy: copySavedCopy(saved, seams, label) } : {}),
    fetched_deleted: previous.old === null ? [] : deleteUnreferencedPdfs(pdfHashesIn(previous.old), seams, label),
    ...provenance(loc.shipped_from, seams),
  };
}
