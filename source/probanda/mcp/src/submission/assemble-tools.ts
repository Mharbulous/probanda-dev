// assemble-general's host tool for a Cowork session (#1321, ADR 0027): binds a general Writing's
// .docx and its enclosures into one PDF host-side, through publish-host.ts. The Cowork sandbox has
// neither PyMuPDF nor Word and cannot reach the matter or case-data folders.
//
// The server decides where the Writing is read and where everything is written: the .docx and the
// PDF are bare names at the top of the matter's one 0. DRAFT folder, and enclosures.json goes only
// in <case-data folder>\assemble-general\. An enclosure may come from any host path: the lawyer's
// own signature, not a folder rule, is the safeguard (Brahm, #1321). The tool returns the binder's
// JSON line only, never file content.

import { win32 as pathWin32 } from "node:path";

import { ValidationError } from "../errors.js";
import { resolveWithin } from "../files/scope.js";
import { assertSegment } from "./bcsc-form-harness.js";
import { bindDraftTarget, runSubskillScript, writeWorkingFile, type DraftTarget } from "./publish-host.js";

export interface AssembleGeneralArgs {
  matter_root: string;
  /** The Writing's .docx, a bare file name at the top of the 0. DRAFT folder. */
  docx_name: string;
  /** The PDF's bare file name at the top of the 0. DRAFT folder; omitted, the binder's "<docx stem> UNSIGNED.pdf". */
  pdf_name?: string;
  enclosures: { label: string; path: string; pages?: string }[];
}

/** A bare file name ending `suffix`, resolved at the top of the 0. DRAFT folder; a link elsewhere is refused. */
function draftFile(target: DraftTarget, name: string, label: string, suffix: string): string {
  assertSegment(name, label);
  if (!name.toLowerCase().endsWith(suffix)) throw new ValidationError(`${label} must be a file name ending ${suffix}: ${name}`);
  return resolveWithin(target.draft, name, label, false);
}

/** assemble-general steps 1-3: writes enclosures.json, then runs bind_general.py --manifest. */
export function assembleGeneral(args: AssembleGeneralArgs, env: NodeJS.ProcessEnv = process.env, installRoot?: string): unknown {
  const isEnclosure = (e: { label?: unknown; path?: unknown; pages?: unknown }) =>
    typeof e?.label === "string" && typeof e.path === "string" && (e.pages === undefined || typeof e.pages === "string");
  if (!Array.isArray(args.enclosures) || !args.enclosures.every(isEnclosure)) {
    throw new ValidationError("enclosures must be a list of { label, path, pages? }, each a string");
  }
  const target = bindDraftTarget(args.matter_root, env);
  const docx = draftFile(target, args.docx_name, "docx_name", ".docx");
  const output = args.pdf_name === undefined ? null : draftFile(target, args.pdf_name, "pdf_name", ".pdf");
  // A relative enclosure path is read against the matter folder; every path goes in absolute. An
  // empty path stays empty, so the binder names it as "no file recorded".
  const enclosures = args.enclosures.map(({ label, path, pages }) => ({ label, path: path && pathWin32.resolve(target.root, path), ...(pages === undefined ? {} : { pages }) }));
  const manifest = writeWorkingFile(target, ["assemble-general"], "enclosures.json", JSON.stringify({ docx, output, enclosures }, null, 2));
  return runSubskillScript(
    {
      skill: "assemble",
      subskill: "assemble-general",
      script: "bind_general.py",
      runs: [["--manifest", manifest]],
      label: "assemble-general bind (bind_general.py)",
      timeoutVariable: "COCLERK_ASSEMBLE_BIND_TIMEOUT_MS",
      timeoutAdvice:
        "The binder writes through a temporary file, so a killed bind leaves no PDF at the output name: call this tool " +
        "again. A ~<name>.tmp-<number>.pdf file may be left at the top of the 0. DRAFT folder, and a hidden Word process may " +
        "still be running: tell the practitioner both. If the bind times out again, stop and tell the practitioner that this " +
        "step must run in a Claude Code (PC) session, where the binder runs in the session's own shell with no time budget.",
      stagingDescription: "temporary folder of converted PDFs",
    },
    env,
    installRoot
  );
}
