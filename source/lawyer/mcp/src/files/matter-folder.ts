// research_filing__matter_folder: one matter's folder as a helper agent reads it, on the PC side and
// read-only: list a folder, find files by name, read one file. It writes nothing, not even a temp
// file: a scanned page comes back as an image in the reply. Scope is the matter folder and zones.ts:
// every path, as given and as resolved, is held to the "read" zone, and a name search also skips what
// a scan skips. An HTML file is never read, because a Probanda page is made for a person to view
// (shared/html-pages.md), and this tool sits outside the hook that refuses a page elsewhere.

import { readdirSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { MESSAGE_EXTENSIONS, parseMessage } from "../correspondence/message.js";
import { DataServerError } from "../errors.js";
import { WithImages } from "../tool-list.js";
import { classifyPdfPages, pageRange, pdfPagePngs } from "./extract/page-images.js";
import { pdfPages, PdfExtractorUnavailable } from "./extract/pdf.js";
import { validateMatterRoot } from "./matter-root.js";
import { assertContained, assertRelativeSyntax, resolveWithin } from "./scope.js";
import { extractText } from "./text-extract.js";
import { zoneProblem } from "./zones.js";

// Keeps a reply within what a client takes from one tool: a call past either limit gives where to
// resume. A single page's text is never cut.
const TEXT_LIMIT = 40_000;
const IMAGE_PAGE_LIMIT = 5;
const ENTRY_LIMIT = 500;
const WALK_LIMIT = 20_000;
const HTML_EXTENSIONS = new Set([".htm", ".html"]);

export interface MatterFolderArgs {
  matter_root: string;
  path?: string;
  name?: string;
  pages?: string;
  offset?: number;
}

interface Entry {
  path: string;
  type: "file" | "folder";
  bytes?: number;
  modified: string;
}

interface Skipped {
  path: string;
  reason: string;
}

function refuseZone(purpose: "read" | "scan", path: string): void {
  const problem = zoneProblem(purpose, path);
  if (problem) throw new DataServerError(`${path}: ${problem}`, "protected");
}

/** `given` as a real path in the matter, relative to it or absolute inside it, or the matter itself. */
function resolveInMatter(root: string, given: string | undefined): string {
  if (given === undefined || given === "") {
    refuseZone("read", root);
    return root;
  }
  refuseZone("read", given);
  let full: string;
  if (pathWin32.isAbsolute(given)) {
    try {
      full = realpathSync.native(given);
    } catch {
      throw new DataServerError(`path not found: ${given}`, "not_found");
    }
    assertContained(root, full, "path", given);
  } else {
    assertRelativeSyntax(given, "path");
    full = resolveWithin(root, given, "path");
  }
  refuseZone("read", full);
  return full;
}

/** A folder entry's real path and stat, or why it is left out: a barred zone, or a link out of the matter. */
function inspect(root: string, full: string): { real: string; stat: Stats } | { reason: string } {
  try {
    const problem = zoneProblem("read", full);
    if (problem) return { reason: problem };
    const real = realpathSync.native(full);
    assertContained(root, real, "path", full);
    const realProblem = zoneProblem("read", real);
    if (realProblem) return { reason: realProblem };
    return { real, stat: statSync(real) };
  } catch (err) {
    return { reason: (err as Error).message };
  }
}

function entry(root: string, full: string, stat: Stats): Entry {
  const path = pathWin32.relative(root, full);
  const modified = stat.mtime.toISOString();
  return stat.isDirectory() ? { path, type: "folder", modified } : { path, type: "file", bytes: stat.size, modified };
}

function sortedNames(dir: string): string[] {
  return readdirSync(dir).sort((a, b) => a.localeCompare(b));
}

function listFolder(root: string, dir: string) {
  const entries: Entry[] = [];
  const skipped: Skipped[] = [];
  const names = sortedNames(dir);
  for (const name of names) {
    const full = pathWin32.join(dir, name);
    const seen = inspect(root, full);
    if ("reason" in seen) skipped.push({ path: pathWin32.relative(root, full), reason: seen.reason });
    else if (entries.length < ENTRY_LIMIT) entries.push(entry(root, full, seen.stat));
  }
  return { path: pathWin32.relative(root, dir) || ".", entries, truncated: names.length - skipped.length > ENTRY_LIMIT, skipped };
}

/** Files and folders under `start` whose own name holds every word of `name`, in any case and order. */
function findByName(root: string, start: string, name: string) {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new DataServerError("name must hold at least one word", "invalid_argument");
  const matches: Entry[] = [];
  const skipped: Skipped[] = [];
  const visited = new Set<string>([start.toLowerCase()]);
  let walked = 0;
  let truncated = false;
  const walk = (dir: string): void => {
    for (const child of sortedNames(dir)) {
      if (truncated) return;
      if (++walked > WALK_LIMIT) {
        truncated = true;
        return;
      }
      const full = pathWin32.join(dir, child);
      const seen = inspect(root, full);
      if ("reason" in seen) {
        skipped.push({ path: pathWin32.relative(root, full), reason: seen.reason });
        continue;
      }
      const isDir = seen.stat.isDirectory();
      // Below `start`, so naming a draft folder as `path` searches it.
      const scanProblem = isDir ? zoneProblem("scan", pathWin32.relative(start, seen.real)) : null;
      if (scanProblem) {
        skipped.push({ path: pathWin32.relative(root, full), reason: scanProblem });
        continue;
      }
      const lower = child.toLowerCase();
      if (words.every((word) => lower.includes(word))) {
        if (matches.length === ENTRY_LIMIT) {
          truncated = true;
          return;
        }
        matches.push(entry(root, full, seen.stat));
      }
      if (isDir && !visited.has(seen.real.toLowerCase())) {
        visited.add(seen.real.toLowerCase());
        walk(seen.real);
      }
    }
  };
  walk(start);
  return { path: pathWin32.relative(root, start) || ".", name, matches, match_count: matches.length, truncated, skipped };
}

function textWindow(text: string, offset: number) {
  const end = offset + TEXT_LIMIT;
  return { text: text.slice(offset, end), total_chars: text.length, next_offset: end < text.length ? end : null };
}

async function readPdf(path: string, full: string, pages: string | undefined): Promise<unknown> {
  const kinds = await classifyPdfPages(full);
  const [first, last] = pageRange(pages, kinds.length);
  let layers: string[] = [];
  if (kinds.slice(first - 1, last).includes("born_digital")) {
    try {
      layers = await pdfPages(full);
    } catch (err) {
      const code = err instanceof PdfExtractorUnavailable ? "extractor_unavailable" : "unreadable";
      throw new DataServerError(`${code}: ${(err as Error).message}`, code);
    }
  }
  const shown: Array<{ page: number; kind: string; text?: string; images?: unknown[] }> = [];
  let chars = 0;
  let imagePages = 0;
  let next: number | null = null;
  for (let n = first; n <= last; n++) {
    if (kinds[n - 1] === "scanned") {
      if (imagePages === IMAGE_PAGE_LIMIT) {
        next = n;
        break;
      }
      imagePages += 1;
      shown.push({ page: n, kind: "scanned" });
      continue;
    }
    const text = layers[n - 1];
    if (chars > 0 && chars + text.length > TEXT_LIMIT) {
      next = n;
      break;
    }
    chars += text.length;
    shown.push({ page: n, kind: "born_digital", text });
  }
  const result = { path, type: "pdf", page_count: kinds.length, pages: shown, next_page: next };
  if (imagePages === 0) return result;

  const rendered = await pdfPagePngs(full, `${first}-${shown[shown.length - 1].page}`);
  const images: Buffer[] = [];
  for (const row of shown) {
    if (row.kind !== "scanned") continue;
    row.images = rendered.pages[row.page - first].images?.map(({ png, width, height, tile }) => {
      images.push(png);
      return { image: images.length, width, height, ...(tile === undefined ? {} : { tile }) };
    });
  }
  return new WithImages(result, images);
}

async function readFile(root: string, full: string, args: MatterFolderArgs): Promise<unknown> {
  const path = pathWin32.relative(root, full);
  const ext = pathWin32.extname(full).toLowerCase();
  if (ext === ".pdf") {
    if (args.offset !== undefined) throw new DataServerError("a PDF is read by pages, not offset", "invalid_argument");
    return readPdf(path, full, args.pages);
  }
  if (args.pages !== undefined) throw new DataServerError("pages applies only to a PDF", "invalid_argument");
  if (HTML_EXTENSIONS.has(ext)) throw new DataServerError(`an HTML file is never read: ${path}`, "html_page");
  const offset = args.offset ?? 0;
  if (MESSAGE_EXTENSIONS.has(ext)) {
    const { body, body_truncated: _cut, highlights: _runs, highlight_source: _source, ...headers } = parseMessage(readFileSync(full), ext, Infinity);
    return { path, type: "message", ...headers, ...textWindow(body, offset) };
  }
  const read = await extractText(full);
  if (read.status === "unread") throw new DataServerError(read.reason, read.reason.split(":")[0]);
  return { path, type: read.kind, ...textWindow(read.text, offset) };
}

export async function matterFolder(args: MatterFolderArgs): Promise<unknown> {
  const root = validateMatterRoot(args.matter_root);
  const full = resolveInMatter(root, args.path);
  if (statSync(full).isDirectory()) {
    if (args.pages !== undefined || args.offset !== undefined) {
      throw new DataServerError("pages and offset apply only to a file", "invalid_argument");
    }
    return args.name === undefined ? listFolder(root, full) : findByName(root, full, args.name);
  }
  if (args.name !== undefined) throw new DataServerError("name searches a folder, and path is a file", "invalid_argument");
  return readFile(root, full, args);
}
