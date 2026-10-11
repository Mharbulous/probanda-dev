// drafting_forms__reply_draft: /draft's reply route (references/reply.md, ADR 0040) keeps its
// draft as a plain markdown file at the top of the matter's one 0. DRAFT folder, never as a
// Writing. step save writes the next free " vN" .md; step export_docx writes a .docx beside a
// saved .md. Neither ever overwrites: every write is an exclusive create.

import { closeSync, openSync, readdirSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { basename, extname, win32 as pathWin32 } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { validateMatterRoot } from "../files/matter-root.js";
import { assertContained, PathOutOfScopeError, resolveWithin } from "../files/scope.js";
import { assertSegment } from "../submission/bcsc-form-harness.js";
import { markdownToDocx } from "./docx.js";

export const REPLY_DRAFT_STEPS = ["save", "export_docx"] as const;

export interface ReplyDraftArgs {
  step: string;
  matter_root: string;
  /** save: the grammar stem, "YYYY-MM-DD CODE Recipient re Subject", no extension and no " vN". */
  name?: string;
  /** save: the draft's markdown. */
  text?: string;
  /** export_docx: a saved .md at the top of the draft folder, by file name or absolute path. */
  path?: string;
}

const NAME_SHAPE = /^\d{4}-\d{2}-\d{2} [A-Z]{2,4} \S/;
const VERSION_SUFFIX = / v(\d+)$/;

/** The matter's one 0. DRAFT folder, real path, inside the matter. */
function draftFolder(root: string): string {
  const names = readdirSync(root, { withFileTypes: true })
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && /^0\. DRAFT/i.test(e.name))
    .map((e) => e.name);
  if (names.length !== 1) {
    throw new DataServerError(
      names.length === 0 ? `no 0. DRAFT folder in ${root}` : `more than one 0. DRAFT folder in ${root}; the draft's folder is ambiguous`,
      names.length === 0 ? "draft_dir_missing" : "draft_dir_ambiguous"
    );
  }
  return resolveWithin(root, names[0], "0. DRAFT folder");
}

/**
 * Writes `data` at `<dir>\<stem><ext>`, else at the next free " vN" after the stem's own version
 * (" v2" for an unversioned stem). Each attempt is an exclusive create, so nothing is overwritten.
 */
function writeNextFree(dir: string, stem: string, ext: string, data: string | Buffer): { path: string; version: number } {
  const m = VERSION_SUFFIX.exec(stem);
  const base = m ? stem.slice(0, m.index) : stem;
  const own = m ? Number(m[1]) : 1;
  const candidates: [string, number][] = [[stem, own]];
  for (let v = Math.max(2, own + 1); v < 1000; v += 1) candidates.push([`${base} v${v}`, v]);
  for (const [name, version] of candidates) {
    const path = pathWin32.join(dir, `${name}${ext}`);
    let fd: number;
    try {
      fd = openSync(path, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    try {
      writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf-8") : data);
    } finally {
      closeSync(fd);
    }
    return { path, version };
  }
  throw new DataServerError(`no free version of "${base}${ext}" below v1000`, "no_free_version");
}

function realpathOrMissing(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    throw new DataServerError(`path not found: ${path}`, "not_found");
  }
}

function save(args: ReplyDraftArgs, root: string): unknown {
  const name = args.name;
  const text = args.text;
  if (typeof name !== "string" || name === "") throw new ValidationError("drafting_forms__reply_draft.name is required for step save");
  if (typeof text !== "string" || text.trim() === "") throw new ValidationError("drafting_forms__reply_draft.text is required for step save");
  assertSegment(name, "name");
  if (/\.[a-z0-9]{1,5}$/i.test(name)) throw new ValidationError(`name is a bare file name stem, without an extension: ${name}`);
  if (VERSION_SUFFIX.test(name)) throw new ValidationError(`name is the stem without " vN"; the server picks the version: ${name}`);
  if (!NAME_SHAPE.test(name)) {
    throw new ValidationError(`name must follow the firm's grammar, "YYYY-MM-DD CODE Recipient re Subject" (e.g. an ET or LET code): ${name}`);
  }
  const dir = draftFolder(root);
  const written = writeNextFree(dir, name, ".md", text);
  return { success: true, path: written.path, version: written.version };
}

function exportDocx(args: ReplyDraftArgs, root: string): unknown {
  const given = args.path;
  if (typeof given !== "string" || given === "") throw new ValidationError("drafting_forms__reply_draft.path is required for step export_docx");
  const dir = draftFolder(root);
  if (!pathWin32.isAbsolute(given)) assertSegment(given, "path");
  const source = pathWin32.isAbsolute(given) ? realpathOrMissing(given) : resolveWithin(dir, given, "path");
  assertContained(dir, source, "path", given);
  if (pathWin32.dirname(source).toLowerCase() !== dir.toLowerCase()) {
    throw new PathOutOfScopeError(`path must be a .md at the top of the 0. DRAFT folder: ${given}`);
  }
  if (extname(source).toLowerCase() !== ".md") throw new ValidationError(`path must be a saved .md draft: ${given}`);

  const stem = basename(source, extname(source));
  const docx = markdownToDocx(readFileSync(source, "utf-8"));
  const written = writeNextFree(dir, stem, ".docx", docx);
  const wanted = pathWin32.join(dir, `${stem}.docx`);
  return {
    success: true,
    path: written.path,
    source: source,
    ...(written.path.toLowerCase() !== wanted.toLowerCase() ? { versioned_from: wanted } : {}),
  };
}

export function replyDraft(args: ReplyDraftArgs): unknown {
  if (!(REPLY_DRAFT_STEPS as readonly string[]).includes(args.step)) {
    throw new ValidationError(`drafting_forms__reply_draft.step must be one of: ${REPLY_DRAFT_STEPS.join(", ")} (got ${JSON.stringify(args.step)})`);
  }
  const root = validateMatterRoot(args.matter_root);
  return args.step === "save" ? save(args, root) : exportDocx(args, root);
}
