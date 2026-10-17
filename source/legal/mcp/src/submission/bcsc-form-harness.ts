// publish-bcsc-form's harness, run host-side for a Cowork session (#1267, ADR 0025).
//
// The Cowork sandbox cannot see the matter folder or its case-data folder, so a harness run there
// never writes context.json where asm32 reads it. This server runs on the host, so it runs the
// harness itself: one harness CLI call per tool call, through the shared host-Python spawn, and the
// harness's JSON action goes back to the caller unchanged. Nothing here interprets the protocol,
// except to refuse the paths an asm32/asm33 locate result names outside the case-data folder.
//
// The server, not the caller, decides every path the harness may write: the matter folder is
// canonicalised, the case-data folder is the one its probanda.json names, the Writing folder is one
// segment under the matter's 0. DRAFT folder (an individual form's out_name is one file name stem at
// that folder's top instead), and session state lives in
// {case-data folder}\form-sessions. A session made anywhere else, and the new-template operation
// (which writes into the plugin's own folder), are refused.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { existingCaseDataFolder, validateMatterRoot } from "../files/matter-root.js";
import { PathOutOfScopeError, assertContained, resolveWithin } from "../files/scope.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs } from "../python-timeout.js";
import { installedPluginLabel, resolveShippedRoot } from "../repo-root.js";

// Sets argv and runs harness.py as __main__. The harness ends by printing one JSON line and exiting,
// but code it runs in-process also prints (fill_plain.py's "Written: <path>"), so everything printed
// is captured: the last non-empty line, the harness's JSON, goes to stdout, and the rest to stderr.
const DRIVER = `import contextlib, io, json, runpy, sys
payload = json.load(sys.stdin)
sys.argv = [payload["harness"], *payload["argv"]]
buf = io.StringIO()
code = 0
try:
    with contextlib.redirect_stdout(buf):
        runpy.run_path(payload["harness"], run_name="__main__")
except SystemExit as exc:
    code = exc.code
finally:
    lines = [line for line in buf.getvalue().splitlines() if line.strip()]
    if len(lines) > 1:
        sys.stderr.write("\\n".join(lines[:-1]) + "\\n")
    if lines:
        sys.stdout.write(lines[-1] + "\\n")
sys.exit(code)
`;

/** Under the Cowork bridge's 60 s limit, so a slow step surfaces as this tool's own timeout. */
export const HARNESS_TIMEOUT_MS = 55_000;

export const HARNESS_COMMANDS = ["list", "init", "classify", "step", "resume", "abandon", "reset", "clarify", "rewind"] as const;
export type HarnessCommand = (typeof HARNESS_COMMANDS)[number];

export interface HarnessArgs {
  matter_root: string;
  command: HarnessCommand;
  harness_session?: string;
  user_request?: string;
  writing_folder?: string;
  /** In place of writing_folder: an individual form's file name stem, written at the top of the 0. DRAFT folder. */
  out_name?: string;
  /** init only: the practitioner has seen a manual_edits report, so the fill writes the new copy anyway. */
  edits_reviewed?: boolean;
  result_json?: string;
  new_request?: string;
  answer?: string;
  target_step_id?: string;
}

/** The text argument each command takes after the session id. */
const TEXT_ARG: Partial<Record<HarnessCommand, keyof HarnessArgs>> = {
  classify: "result_json",
  step: "result_json",
  reset: "new_request",
  clarify: "answer",
  rewind: "target_step_id",
};

/** harness.py, install-first (resolveShippedRoot), in the shape of name-gate.ts's fileNamingSkillDir. */
export function bcscFormHarnessPath(env: NodeJS.ProcessEnv = process.env, installRoot?: string): string {
  const rel = ["publish", "subskills", "publish-bcsc-form", "scripts", "harness.py"];
  const shipped = resolveShippedRoot(rel.join("/"), env, {
    code: "repo_root_missing",
    subject: "the publish-bcsc-form harness",
    installRoot,
  });
  const path = pathWin32.join(shipped.root, ...rel);
  if (!existsSync(path)) {
    throw new DataServerError(
      `harness.py not found at ${path} -- ` +
        (shipped.shipped_from === "install"
          ? `${installedPluginLabel(shipped)}'s bundled skill source lacks it; reinstall the plugin and fully restart`
          : "the installed bundle predates this phase, or the repo has moved; reinstall the plugin and fully restart"),
      "repo_root_missing"
    );
  }
  return path;
}

/** Runs one harness command for a matter and returns the harness's JSON output unchanged. */
export function bcscFormHarness(args: HarnessArgs, env: NodeJS.ProcessEnv = process.env, installRoot?: string): unknown {
  const root = validateMatterRoot(args.matter_root);
  const caseData = existingCaseDataFolder(root, env);
  const sessions = confinedSessionsDir(caseData);

  const argv: string[] = [args.command];
  if (args.command === "init") {
    const writingFolder = args.writing_folder ?? "";
    const outName = args.out_name ?? "";
    if ((writingFolder === "") === (outName === "")) {
      throw new ValidationError("drafting_forms__bcsc_form_harness init takes exactly one of writing_folder (a package) and out_name (an individual form)");
    }
    argv.push("--matter-path", root, "--case-data-folder", caseData);
    if (writingFolder !== "") {
      confineWritingFolder(root, writingFolder);
      argv.push("--writing-folder", writingFolder);
    } else {
      assertSegment(outName, "out_name");
      argv.push("--out-name", outName);
    }
    if (args.edits_reviewed === true) argv.push("--edits-reviewed");
    argv.push("--", requireArg(args, "user_request"));
  } else if (args.command !== "list") {
    const sessionId = requireArg(args, "harness_session");
    // abandon only deletes the session's own folder, so a refused session can still be cleared.
    let ctx: Record<string, unknown> | undefined;
    if (args.command === "abandon") confineSessionDir(sessions, sessionId);
    else ctx = checkSession(root, caseData, sessions, sessionId);
    argv.push("--", sessionId);
    const text = TEXT_ARG[args.command];
    if (text) argv.push(requireArg(args, text));
    if (args.command === "step" && LOCATE_STEPS.has(ctx?.current_step as string)) confineLocatePaths(caseData, argv[argv.length - 1]);
  }

  const action = runPythonDriver({
    label: `publish-bcsc-form harness (${args.command})`,
    driver: pythonDriverFile("bcsc-form-harness", DRIVER),
    payload: JSON.stringify({ harness: bcscFormHarnessPath(env, installRoot), argv }),
    env,
    timeoutMs: pythonTimeoutMs(env, HARNESS_TIMEOUT_MS, "COCLERK_BCSC_HARNESS_TIMEOUT_MS"),
    extraEnv: { DRAFT_BCSC_SESSIONS_DIR: sessions, PYTHONDONTWRITEBYTECODE: "1" },
    timeoutAdvice: timeoutAdvice(args.command, args.harness_session),
  });
  if (isNewTemplate(action)) throw newTemplateRefusal((action as { session_id?: string }).session_id);
  return action;
}

function requireArg(args: HarnessArgs, key: keyof HarnessArgs): string {
  const value = args[key];
  if (typeof value !== "string" || value === "") {
    throw new ValidationError(`drafting_forms__bcsc_form_harness.${key} is required for command ${args.command}`);
  }
  return value;
}

/** One path segment: no separator, no drive colon, not "." or "..". */
export function assertSegment(value: string, label: string): void {
  if (value === "." || value === ".." || /[\\/:\0]/.test(value)) {
    throw new PathOutOfScopeError(`${label} must be one folder name, not a path: ${value}`);
  }
}

/** {case-data folder}\form-sessions, refused if it exists but resolves elsewhere (a link). */
function confinedSessionsDir(caseData: string): string {
  const dir = pathWin32.join(caseData, "form-sessions");
  if (existsSync(dir) && realpathSync.native(dir).toLowerCase() !== dir.toLowerCase()) {
    throw new PathOutOfScopeError(`${dir} resolves elsewhere (${realpathSync.native(dir)})`);
  }
  return dir;
}

function confineSessionDir(sessions: string, sessionId: string): string {
  assertSegment(sessionId, "harness_session");
  const dir = pathWin32.join(sessions, sessionId);
  if (existsSync(dir) && realpathSync.native(dir).toLowerCase() !== dir.toLowerCase()) {
    throw new PathOutOfScopeError(`session ${sessionId} resolves elsewhere (${realpathSync.native(dir)})`);
  }
  return dir;
}

/**
 * The Writing folder is one segment under the matter's 0. DRAFT folder. The harness finds that
 * folder itself and creates the Writing folder in it; every candidate must resolve inside the matter.
 * Returns each candidate, resolved, one per 0. DRAFT* folder.
 */
export function confineWritingFolder(root: string, writingFolder: string): string[] {
  assertSegment(writingFolder, "writing_folder");
  const candidates: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!/^0\. DRAFT/i.test(entry.name)) continue;
    candidates.push(resolveWithin(root, pathWin32.join(entry.name, writingFolder), "writing_folder", false));
  }
  return candidates;
}

/**
 * A session this tool drives must have been made by it for this matter: its stored matter and
 * case-data folders must be the ones this call resolved, since the harness writes to them.
 */
function checkSession(root: string, caseData: string, sessions: string, sessionId: string): Record<string, unknown> {
  const ctxPath = pathWin32.join(confineSessionDir(sessions, sessionId), "ctx.json");
  if (!existsSync(ctxPath)) {
    throw new DataServerError(`no session ${sessionId} under ${sessions}. Call this tool with command list to see the sessions.`, "session_not_found");
  }
  const ctx = JSON.parse(readFileSync(ctxPath).toString("utf-8").replace(/\0+$/, "")) as Record<string, unknown>;
  const same = (stored: unknown, expected: string) => {
    if (typeof stored !== "string" || stored === "" || !existsSync(stored)) return false;
    return realpathSync.native(stored).toLowerCase() === expected.toLowerCase() && statSync(stored).isDirectory();
  };
  if (!same(ctx.matter_path, root) || !same(ctx.case_data_folder, caseData)) {
    throw new PathOutOfScopeError(
      `session ${sessionId} was not started by this tool for this matter (its matter folder is ${JSON.stringify(ctx.matter_path)}, ` +
        `its case-data folder ${JSON.stringify(ctx.case_data_folder)}). Abandon it and start again with command init.`
    );
  }
  if (typeof ctx.writing_folder === "string" && ctx.writing_folder !== "") confineWritingFolder(root, ctx.writing_folder);
  if (typeof ctx.out_name === "string" && ctx.out_name !== "") assertSegment(ctx.out_name, "the session's out_name");
  if (ctx.sequence === "new-template" || ctx.mode === "new-template") throw newTemplateRefusal(sessionId);
  return ctx;
}

/**
 * asm32.locate and asm33.locate take their input paths from the step result, and asm32/asm33.transform
 * then write working files beside them. At those steps every such path must resolve inside the
 * case-data folder, where the emitters put the substance files.
 */
const LOCATE_STEPS = new Set(["asm32.locate", "asm33.locate"]);
const LOCATE_PATH_KEYS = ["form32_path", "form33_path", "context_path"];

function confineLocatePaths(caseData: string, resultJson: string): void {
  let result: unknown;
  try {
    result = JSON.parse(resultJson);
  } catch {
    return; // Not JSON: the harness refuses it without writing anything.
  }
  if (typeof result !== "object" || result === null) return;
  // The harness's own envelope rule (cmd_step): a step_result's data, else the object itself.
  const outer = result as Record<string, unknown>;
  const data = (outer.kind === "step_result" && typeof outer.data === "object" && outer.data !== null ? outer.data : outer) as Record<string, unknown>;
  for (const key of LOCATE_PATH_KEYS) {
    const value = data[key];
    if (value === undefined) continue;
    const label = `result_json data.${key}`;
    if (typeof value !== "string" || !pathWin32.isAbsolute(value)) {
      throw new PathOutOfScopeError(`${label} must be an absolute path inside the case-data folder ${caseData}: ${JSON.stringify(value)}`);
    }
    const resolved = existsSync(value) ? realpathSync.native(value) : pathWin32.resolve(value);
    assertContained(caseData, resolved, label, value);
  }
}

/** The harness routed to new-template: an unregistered form, or a LEAP template conversion. */
function isNewTemplate(action: unknown): boolean {
  if (typeof action !== "object" || action === null) return false;
  const { action: kind, step_id } = action as { action?: unknown; step_id?: unknown };
  return kind === "missing_template" || (typeof step_id === "string" && step_id.startsWith("nt."));
}

function newTemplateRefusal(sessionId: string | undefined): DataServerError {
  return new DataServerError(
    "The new-template operation is not run by this tool: it converts a LEAP template and registers the form " +
      "inside the plugin's own folder, which this tool never writes. Tell the practitioner that a new form " +
      "template ships only in a plugin update, and to run /legal:suggestion naming the form they need." +
      (sessionId ? ` Then call this tool with command abandon and harness_session ${sessionId}.` : ""),
    "new_template_refused"
  );
}

/**
 * The harness saves a session's ctx.json only once a step's script has finished (cmd_step), so a
 * step killed mid-script leaves the session at that same step, and resume returns it again.
 * classify, reset and clarify rename the session, and the interpreter may outlive the kill and
 * finish the rename, so after one of those the id passed in may be gone.
 */
const RENAMING = new Set<HarnessCommand>(["classify", "reset", "clarify"]);

function timeoutAdvice(command: HarnessCommand, sessionId: string | undefined): string {
  const resume = !sessionId
    ? "Call this tool with command list to find any session this call started, then resume it, or abandon it and start again."
    : RENAMING.has(command)
      ? `Session ${sessionId} may have been renamed: ${command} renames the session, and the interpreter may outlive the kill and finish it. ` +
        "Wait a minute, then call this tool with command list to find the session, and resume or abandon it under the session_id list shows."
      : `Session ${sessionId} is normally not advanced: the harness saves its state only after a step's script finishes. ` +
        "But the interpreter may outlive the kill and finish the step, so wait a minute, then call this tool again with command resume " +
        "and the same harness_session, and trust what it returns: the same step again (answering it re-runs the step) or the next one.";
  return (
    resume +
    " A killed fill step may already have written its .docx in the Writing folder (an out_name session: the 0. DRAFT folder), and Word may still finish its .pdf. " +
    "The re-run writes a new \" vN\" copy beside it and never overwrites, so tell the practitioner which earlier copy is incomplete. " +
    "If the same step times out again, stop and tell the practitioner that this step must run in a Claude Code (PC) session, " +
    "where the harness runs in the session's own shell with no time budget."
  );
}
