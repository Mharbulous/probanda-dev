// The /publish fills run host-side for a Cowork session (#1268, ADR 0026), in the shape of
// bcsc-form-harness.ts (ADR 0025).
//
// The Cowork sandbox sees neither the matter folder nor its matter-data folder, and its Write tool
// lands in the VM, so a fill run there writes nothing the practitioner receives. This server runs on
// the host, so it runs the fill itself and returns the fill's JSON line unchanged. The server, not
// the caller, decides every path: the matter folder is canonicalised, the matter-data folder is the
// one its probanda.json names and must hold db_path, the Writing folder is one segment under the
// matter's one 0. DRAFT folder (publish-general and publish-bcca-factum write that folder's top
// instead), and working files go only in the named subfolder of the matter-data folder. Anything
// resolving elsewhere, through a link included, is refused. assemble-tools.ts runs assemble-general's
// binder through the same helpers (#1321, ADR 0027), taking the matter-data folder from probanda.json
// with no db_path, since the bind never opens the database (#1427).

import { existsSync, readdirSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { existingCaseDataFolder, validateMatterRoot } from "../files/matter-root.js";
import { resolveWithin } from "../files/scope.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs } from "../python-timeout.js";
import { installedPluginLabel, resolveShippedRoot } from "../repo-root.js";
import { confineWritingFolder } from "./bcsc-form-harness.js";
import { confineCaseDataFolder, writeSubstanceFile } from "./substance-file.js";

// Runs the fill script as __main__ once per argv in `runs`, stopping at the first run that exits
// non-zero (factum: validate, then fill). Everything a run prints is captured: its last non-empty
// line, the fill's JSON, goes to stdout and the rest to stderr. A refusal exits non-zero by the
// fills' own contract, so the driver exits 0 whenever the fill printed its line: that line is the
// result. A run that printed nothing (a crash before main) keeps its exit code and its traceback.
const DRIVER = `import contextlib, io, json, runpy, sys
payload = json.load(sys.stdin)
code, last = 0, None
for argv in payload["runs"]:
    sys.argv = [payload["script"], *argv]
    buf = io.StringIO()
    code = 0
    try:
        with contextlib.redirect_stdout(buf):
            runpy.run_path(payload["script"], run_name="__main__")
    except SystemExit as exc:
        code = exc.code
    lines = [line for line in buf.getvalue().splitlines() if line.strip()]
    if len(lines) > 1:
        sys.stderr.write("\\n".join(lines[:-1]) + "\\n")
    last = lines[-1] if lines else None
    if last is None or code not in (0, None):
        break
if last is None:
    sys.exit(code or 1)
sys.stdout.write(last + "\\n")
`;

/** Under the Cowork bridge's 60 s limit, so a slow fill surfaces as this tool's own timeout. */
export const PUBLISH_FILL_TIMEOUT_MS = 55_000;

/** The paths one publish call may write, all resolved by the server. */
export interface PublishTarget {
  /** The canonical matter folder. */
  root: string;
  /** The canonical matter-data folder: probanda.json's case_data_dir, which must hold db_path. */
  caseData: string;
  /** The Writing folder, resolved: one segment under the matter's one 0. DRAFT folder. */
  writing: string;
}

/** The paths publish-general, publish-bcca-factum and assemble-general may write: their files go at the top of the 0. DRAFT folder. */
export interface DraftTarget {
  root: string;
  caseData: string;
  /** The matter's one 0. DRAFT folder, resolved; never created. */
  draft: string;
}

/** The one candidate, else draft_dir_missing or draft_dir_ambiguous. */
function oneDraftFolder(root: string, candidates: string[], what: string): string {
  if (candidates.length !== 1) {
    throw new DataServerError(
      candidates.length === 0 ? `no 0. DRAFT folder in ${root}` : `more than one 0. DRAFT folder in ${root}; ${what} is ambiguous`,
      candidates.length === 0 ? "draft_dir_missing" : "draft_dir_ambiguous"
    );
  }
  return candidates[0];
}

export function publishTarget(matterRoot: string, dbPath: string, writingFolder: string, env: NodeJS.ProcessEnv): PublishTarget {
  const root = validateMatterRoot(matterRoot);
  const caseData = confineCaseDataFolder(dbPath, existingCaseDataFolder(root, env));
  return { root, caseData, writing: oneDraftFolder(root, confineWritingFolder(root, writingFolder), "the Writing folder") };
}

/** The matter's one 0. DRAFT folder, resolved. */
function draftFolder(root: string): string {
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => /^0\. DRAFT/i.test(entry.name))
    .map((entry) => resolveWithin(root, entry.name, "0. DRAFT folder", false));
  return oneDraftFolder(root, candidates, "the draft folder");
}

export function publishDraftTarget(matterRoot: string, dbPath: string, env: NodeJS.ProcessEnv): DraftTarget {
  const root = validateMatterRoot(matterRoot);
  const caseData = confineCaseDataFolder(dbPath, existingCaseDataFolder(root, env));
  return { root, caseData, draft: draftFolder(root) };
}

/** assemble-general's target: it never opens the database, so it takes no db_path to check against (#1427). */
export function bindDraftTarget(matterRoot: string, env: NodeJS.ProcessEnv): DraftTarget {
  const root = validateMatterRoot(matterRoot);
  return { root, caseData: existingCaseDataFolder(root, env), draft: draftFolder(root) };
}

/** Writes one working file into <matter-data folder>\<folders...>, creating only those folders. */
export function writeWorkingFile(target: { caseData: string }, folders: string[], fileName: string, text: string): string {
  return writeSubstanceFile(target.caseData, fileName, text, folders);
}

/** A folder inside the Writing folder, refused if it resolves anywhere else (a link). */
export function writingSubfolder(target: PublishTarget, name: string): string {
  return resolveWithin(target.writing, name, `${name} folder`, false);
}

/** A script of a /publish or /assemble subskill, install-first, in the shape of bcscFormHarnessPath. */
export function subskillScriptPath(skill: "publish" | "assemble", subskill: string, script: string, env: NodeJS.ProcessEnv = process.env, installRoot?: string): string {
  const rel = [skill, "subskills", subskill, "scripts", script];
  const shipped = resolveShippedRoot(rel.join("/"), env, {
    code: "repo_root_missing",
    subject: `the ${subskill} script`,
    installRoot,
  });
  const path = pathWin32.join(shipped.root, ...rel);
  if (!existsSync(path)) {
    throw new DataServerError(
      `${script} not found at ${path} -- ` +
        (shipped.shipped_from === "install"
          ? `${installedPluginLabel(shipped)}'s bundled skill source lacks it; reinstall the plugin and fully restart`
          : "the installed bundle predates this phase, or the repo has moved; reinstall the plugin and fully restart"),
      "repo_root_missing"
    );
  }
  return path;
}

/** One host run of a subskill script: `runs` holds one argv per run, `timeoutVariable` overrides the 55 s budget. */
export interface SubskillScriptRun {
  skill: "publish" | "assemble";
  subskill: string;
  script: string;
  runs: string[][];
  label: string;
  timeoutVariable: string;
  timeoutAdvice: string;
  stagingDescription?: string;
}

/** Runs a subskill script once per argv in `runs` and returns the last run's JSON line unchanged. */
export function runSubskillScript(run: SubskillScriptRun, env: NodeJS.ProcessEnv, installRoot?: string): unknown {
  return runPythonDriver({
    label: run.label,
    driver: pythonDriverFile("publish-fill", DRIVER),
    payload: JSON.stringify({ script: subskillScriptPath(run.skill, run.subskill, run.script, env, installRoot), runs: run.runs }),
    env,
    timeoutMs: pythonTimeoutMs(env, PUBLISH_FILL_TIMEOUT_MS, run.timeoutVariable),
    extraEnv: { PYTHONDONTWRITEBYTECODE: "1" },
    timeoutAdvice: run.timeoutAdvice,
    stagingDescription: run.stagingDescription,
  });
}

/** Runs a fill script once per argv in `runs` and returns the last run's JSON line unchanged. */
export function runPublishFill(subskill: string, script: string, runs: string[][], env: NodeJS.ProcessEnv, installRoot?: string): unknown {
  return runSubskillScript({
    skill: "publish",
    subskill,
    script,
    runs,
    label: `${subskill} fill (${script})`,
    timeoutVariable: "COCLERK_PUBLISH_FILL_TIMEOUT_MS",
    timeoutAdvice:
      "The general and factum fills write through a temporary file, so a killed general or factum fill leaves no deliverable " +
      "behind: call this tool again. A killed VanIAC fill may already have written a .docx in the Writing folder. That fill " +
      "never overwrites, so calling this tool again refuses with output_exists while that file is there: tell the practitioner " +
      "which file may be incomplete and ask them to move it aside by hand before trying again. If the fill times out again, stop and tell the " +
      "practitioner that this step must run in a Claude Code (PC) session, where the fill runs in the session's own " +
      "shell with no time budget.",
  }, env, installRoot);
}
