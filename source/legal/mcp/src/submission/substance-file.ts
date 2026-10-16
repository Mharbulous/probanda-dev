// The optional host-side write of emit_form32/emit_form33 (#1267, ADR 0025).
//
// A Cowork session's Write tool lands in its sandbox, not on the host, so asm32/asm33 (run host-side
// by drafting_forms__bcsc_form_harness) would never see the file. Given case_data_folder, the
// emitter writes form-32.md / form-33.md itself, where publish-bcsc-form's locate steps read it:
// {case-data folder}\bcsc-form-substance\. The case-data folder must be the one holding the filing's
// submission database (open_session derives db_path as <case_data_dir>\submission.sqlite), and no
// link along the way may lead elsewhere.

import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { PathOutOfScopeError, canonicalRoot } from "../files/scope.js";

/** publish-bcsc-form's SUBSTANCE_WORKFLOW (scripts/steps/shared/paths.py). */
export const BCSC_SUBSTANCE_FOLDER = "bcsc-form-substance";

/** The canonical case-data folder, which must be the folder holding `dbPath`. */
export function confineCaseDataFolder(dbPath: string, caseDataFolder: string): string {
  if (!pathWin32.isAbsolute(caseDataFolder)) {
    throw new PathOutOfScopeError(`case_data_folder must be an absolute path: ${caseDataFolder}`);
  }
  const folder = canonicalRoot(caseDataFolder, `case_data_folder not found: ${caseDataFolder}. Run /case-data initialize on this matter first.`, "case_data_missing");
  const dbFolder = canonicalRoot(pathWin32.dirname(dbPath), `db_path's folder not found: ${dbPath}`, "not_found");
  if (folder.toLowerCase() !== dbFolder.toLowerCase()) {
    throw new PathOutOfScopeError(
      `case_data_folder must be the matter's case-data folder, the one holding db_path (${dbFolder}); got ${caseDataFolder} (${folder})`
    );
  }
  return folder;
}

/**
 * Writes `markdown` to <caseData>\<folders...>\<fileName> (bcsc-form-substance by default), creating
 * only those subfolders. The /publish host tools (#1268, ADR 0026) name their own. Returns the path.
 */
export function writeSubstanceFile(caseData: string, fileName: string, markdown: string, folders: string[] = [BCSC_SUBSTANCE_FOLDER]): string {
  const dirs = folders.map((_, i) => pathWin32.join(caseData, ...folders.slice(0, i + 1)));
  const path = pathWin32.join(dirs[dirs.length - 1], fileName);
  for (const p of [...dirs, path]) {
    if (existsSync(p) && realpathSync.native(p).toLowerCase() !== p.toLowerCase()) {
      throw new PathOutOfScopeError(`${p} resolves elsewhere (${realpathSync.native(p)})`);
    }
  }
  for (const dir of dirs) if (!existsSync(dir)) mkdirSync(dir);
  writeFileSync(path, markdown, "utf-8");
  return path;
}
