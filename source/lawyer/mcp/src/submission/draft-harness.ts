// /draft's host tool for a Cowork session (#1453, ADR 0031): one tool for the skill, a `step` name,
// arguments typed per step, and confinement the server decides per step. Step scrutiny_review is
// scrutiny-review.ts (ADR 0036).
//
// write_email runs draft/scripts/write_eml.py, which writes an unsent Outlook draft (.eml, X-Unsent: 1)
// and sends nothing. The server decides where it goes: the top of the matter's one 0. DRAFT folder,
// or one named folder under it, which the script creates when absent once every check has passed
// (0. DRAFT never is). An email that belongs to no matter omits matter_root and goes under
// <case_data_root>\_practice\drafts, created when absent. From is this machine's
// person in the firm roster, whose signature template under the firm folder, when present, is used
// before Outlook's (skills/shared/email.md). An attachment may be any host file, as an enclosure may under ADR 0027
// (Brahm, #1453). No database is opened, and no file content is returned.

import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError, NotFoundError, ValidationError } from "../errors.js";
import { validateMatterRoot } from "../files/matter-root.js";
import { resolveWithin } from "../files/scope.js";
import { runPythonDriver } from "../python-spawn.js";
import { resolveCaseDataRoot } from "../practice/matter-data-root.js";
import { pythonTimeoutMs } from "../python-timeout.js";
import { installedPluginLabel, resolveShippedRoot } from "../repo-root.js";
import { emailSignaturePath, readFirmProfile } from "../tools/practice/firm-profile.js";
import { assertSegment, confineWritingFolder } from "./bcsc-form-harness.js";
import { scrutinyReview, type ScrutinyReviewArgs } from "./scrutiny-review.js";

/**
 * write_email's spawn budget, under the Cowork bridge's 60 s limit, so a slow write surfaces as this
 * tool's own timeout. scrutiny_review does not use it: its spawns each have their own budget
 * (scrutiny-review.ts), and together they can pass 60 s.
 */
export const DRAFT_HARNESS_TIMEOUT_MS = 55_000;

export const DRAFT_STEPS = ["write_email", "scrutiny_review"] as const;

export interface DraftHarnessArgs extends Omit<ScrutinyReviewArgs, "step" | "matter_root"> {
  step: string;
  /** write_email: omitted for an email that belongs to no matter. */
  matter_root?: string;
  /** write_email: the draft's bare file name stem, composed under the firm's naming convention. */
  output_name?: string;
  /** write_email: one folder name under the 0. DRAFT folder (or the firm drafts folder); omitted, the draft goes at its top. */
  folder?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  /** write_email: any host files, absolute or relative to the matter folder; absolute with no matter. */
  attachments?: string[];
}

/** Runs one /draft step for a matter and returns its script's JSON line unchanged. */
export function draftHarness(args: DraftHarnessArgs, env: NodeJS.ProcessEnv = process.env, installRoot?: string): unknown {
  if (args.step === "scrutiny_review") return scrutinyReview(args as ScrutinyReviewArgs, env, installRoot);
  if (args.step !== "write_email") {
    throw new ValidationError(`drafting_forms__draft_harness.step must be one of: ${DRAFT_STEPS.join(", ")} (got ${JSON.stringify(args.step)})`);
  }
  return writeEmail(args, env, installRoot);
}

function writeEmail(args: DraftHarnessArgs, env: NodeJS.ProcessEnv, installRoot?: string): unknown {
  const outputName = requireString(args, "output_name");
  const subject = requireString(args, "subject");
  const body = requireString(args, "body");
  const to = stringList(args, "to", 1);
  const cc = stringList(args, "cc", 0);
  const attachments = stringList(args, "attachments", 0);
  assertSegment(outputName, "output_name");
  if (args.folder !== undefined) assertSegment(args.folder, "folder");

  let root: string;
  let outDir: string;
  if (args.matter_root === undefined) {
    const relative = attachments.filter((path) => !pathWin32.isAbsolute(path));
    if (relative.length) {
      throw new ValidationError(`drafting_forms__draft_harness.attachments must be absolute paths when no matter_root is given: ${relative.join(", ")}`);
    }
    root = realpathSync.native(resolveCaseDataRoot(env));
    const drafts = pathWin32.join("_practice", "drafts");
    outDir = resolveWithin(root, args.folder === undefined ? drafts : pathWin32.join(drafts, args.folder), "the firm drafts folder", false);
  } else {
    root = validateMatterRoot(args.matter_root);
    outDir = args.folder === undefined ? oneDraftFolder(root, draftFolders(root)) : oneDraftFolder(root, confineWritingFolder(root, args.folder));
  }
  const from = sender(env);
  if ("error" in from) return from;
  // The firm drafts folder is Probanda's own, so it is made here; write_eml.py makes a folder under it.
  if (args.matter_root === undefined) mkdirSync(pathWin32.join(root, "_practice", "drafts"), { recursive: true });

  return runPythonDriver({
    label: "draft write_email (write_eml.py)",
    driver: writeEmlPath(env, installRoot),
    payload: JSON.stringify({
      from_name: from.name,
      from_address: from.email,
      closing: from.closing,
      signature_template: emailSignaturePath(env, from.key),
      to,
      cc,
      subject,
      body,
      // A relative attachment is read against the matter folder; every path goes in absolute.
      attachments: attachments.map((path) => pathWin32.resolve(root, path)),
      out_dir: outDir,
      out_name: outputName,
    }),
    env,
    timeoutMs: pythonTimeoutMs(env, DRAFT_HARNESS_TIMEOUT_MS, "COCLERK_EMAIL_DRAFT_TIMEOUT_MS"),
    extraEnv: { PYTHONDONTWRITEBYTECODE: "1" },
    timeoutAdvice:
      "The script writes through a temporary file, so a killed run leaves no draft at the output name: call this tool again. " +
      "A ~<output_name>.<number>.tmp file may be left beside it: tell the practitioner.",
  });
}

function requireString(args: DraftHarnessArgs, key: "output_name" | "subject" | "body"): string {
  const value = args[key];
  if (typeof value !== "string" || value === "") {
    throw new ValidationError(`drafting_forms__draft_harness.${key} is required for step ${args.step}`);
  }
  return value;
}

function stringList(args: DraftHarnessArgs, key: "to" | "cc" | "attachments", minimum: number): string[] {
  const value = args[key] ?? [];
  if (!Array.isArray(value) || value.length < minimum || !value.every((item) => typeof item === "string")) {
    throw new ValidationError(`drafting_forms__draft_harness.${key} must be a list of strings, at least ${minimum}, for step ${args.step}`);
  }
  return value;
}

/** Each 0. DRAFT folder of the matter, resolved; a link elsewhere is refused. */
function draftFolders(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => /^0\. DRAFT/i.test(entry.name))
    .map((entry) => resolveWithin(root, entry.name, "0. DRAFT folder", false));
}

/** The one candidate, else draft_dir_missing or draft_dir_ambiguous (publish-host.ts's rule). */
function oneDraftFolder(root: string, candidates: string[]): string {
  if (candidates.length !== 1) {
    throw new DataServerError(
      candidates.length === 0 ? `no 0. DRAFT folder in ${root}` : `more than one 0. DRAFT folder in ${root}; the draft's folder is ambiguous`,
      candidates.length === 0 ? "draft_dir_missing" : "draft_dir_ambiguous"
    );
  }
  return candidates[0];
}

/** This machine's person in the firm roster, or the from_unresolved refusal. */
function sender(
  env: NodeJS.ProcessEnv
): { key: string; name: string; email: string; closing: string } | { success: false; error: string; detail: string } {
  const refusal = (why: string) => ({
    success: false as const,
    error: "from_unresolved",
    detail: `${why} Set person, and the roster entry's name and email, with practice_data__upsert_firm_profile. Nothing was written.`,
  });
  let profile: ReturnType<typeof readFirmProfile>;
  try {
    profile = readFirmProfile(env);
  } catch (err) {
    if (err instanceof NotFoundError) return refusal(`${err.message}, so the draft has no sender.`);
    throw err;
  }
  const entry = profile.person === null ? undefined : profile.roster.find((candidate) => candidate.key === profile.person);
  if (entry === undefined || typeof entry.email !== "string" || entry.email === "") {
    return refusal(
      entry === undefined
        ? "This machine's person is not set, so the draft has no sender."
        : `The firm roster entry "${profile.person}" has no email, so the draft has no sender.`
    );
  }
  return {
    key: profile.person as string,
    name: typeof entry.name === "string" ? entry.name : "",
    email: entry.email,
    closing: typeof entry.closing === "string" ? entry.closing : "",
  };
}

/** draft/scripts/write_eml.py, install-first, in the shape of publish-host.ts's subskillScriptPath. */
export function writeEmlPath(env: NodeJS.ProcessEnv = process.env, installRoot?: string): string {
  const rel = ["draft", "scripts", "write_eml.py"];
  const shipped = resolveShippedRoot(rel.join("/"), env, {
    code: "repo_root_missing",
    subject: "the draft write_eml script",
    installRoot,
  });
  const path = pathWin32.join(shipped.root, ...rel);
  if (!existsSync(path)) {
    throw new DataServerError(
      `write_eml.py not found at ${path} -- ` +
        (shipped.shipped_from === "install"
          ? `${installedPluginLabel(shipped)}'s bundled skill source lacks it; reinstall the plugin and fully restart`
          : "the installed bundle predates this phase, or the repo has moved; reinstall the plugin and fully restart"),
      "repo_root_missing"
    );
  }
  return path;
}
