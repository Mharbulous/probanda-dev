// Confining the caller's presentation_dir and draft_dir.

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { draftDirOf, resolveDraftDir } from "../render-manifest.js";
import { sanitizeForPath } from "../writing-folder.js";
import { ValidationError } from "../../errors.js";
import { zoneProblem } from "../../files/zones.js";

/** #466 / ADR 0012: a caller-named Writing folder must sit directly under the matter's `0. DRAFT`
 * folder (the one beside the database's own case data) and be named for this filing's own sanitized
 * title, with or without a leading date, so the one matter-tree write this server makes cannot land
 * anywhere else. `realpathSync.native` resolves a junction to its true target (which then fails
 * containment) and reads cloud-sync placeholders as ordinary files. */
export function resolvePresentationDir(dbPath: string, presentationDir: string, filingTitle: string, styleOfCause: string | null): string {
  if (!isAbsolute(presentationDir)) {
    throw new ValidationError(`drafting_forms__render.presentation_dir must be an absolute path: ${presentationDir}`);
  }
  const dir = resolve(presentationDir);
  const refuse = (why: string) => new ValidationError(`drafting_forms__render.presentation_dir ${dir}: ${why}`);
  let parent: string;
  try {
    parent = realpathSync.native(dirname(dir));
  } catch {
    throw refuse("its parent must be the matter's existing 0. DRAFT folder, and it does not exist");
  }
  if (!/^0\. DRAFT/i.test(basename(parent))) throw refuse("its parent must be the matter's 0. DRAFT folder");
  if (zoneProblem("write", parent)) throw refuse("it lies inside a privileged or disclosed tree, TRASH or 0. CASE DATA");
  if (parent.toLowerCase() !== realpathSync.native(draftDirOf(dbPath)).toLowerCase()) throw refuse("its parent must be the 0. DRAFT folder of this database's matter");
  // A folder made while the title still ended in the style of proceeding keeps that name.
  const titles = [filingTitle, ...(styleOfCause ? [`${filingTitle} - ${styleOfCause}`] : [])].map((t) => sanitizeForPath(t).toLowerCase());
  const name = basename(dir).replace(/^\d{4}-\d{2}-\d{2} /, "").toLowerCase();
  if (!titles.includes(name)) {
    throw refuse(`the folder must be named "${sanitizeForPath(filingTitle)}" (this filing's title), with or without a leading YYYY-MM-DD`);
  }
  if (existsSync(dir) && dirname(realpathSync.native(dir)).toLowerCase() !== parent.toLowerCase()) {
    throw refuse("it resolves outside its 0. DRAFT folder");
  }
  return dir;
}

/** #585 / #689: a caller's draft_dir, confined, and the one the database's matter has: the pages are
 * written there and nowhere else. */
export function draftDirOfCaller(dbPath: string, draftDir: string, param = "drafting_forms__render.draft_dir"): string {
  const draft = resolveDraftDir(draftDir, param);
  if (realpathSync.native(draft).toLowerCase() !== realpathSync.native(draftDirOf(dbPath)).toLowerCase()) {
    throw new ValidationError(`${param} ${draftDir}: it is not the 0. DRAFT folder of this database's matter, ${draftDirOf(dbPath)}`);
  }
  return draft;
}
