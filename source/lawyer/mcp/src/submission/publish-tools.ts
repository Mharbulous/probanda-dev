// The three /publish host tools for a Cowork session (#1268, ADR 0026): publish-general,
// publish-bcca-factum and publish-vaniac-package, each run host-side through publish-host.ts.
//
// Each tool takes identifiers plus only what the session composes, fetches its own inputs
// in-process (the filed render, the format file, the firm profile, the factum emitter), writes the
// working files the subskill names at the same matter-data paths, and runs the subskill's fill script
// with the same argv the Code-tab route uses. A refusal from the render or the emitter comes back as
// a refusal before anything is written or run.

import { existsSync, readdirSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { ValidationError } from "../errors.js";
import { assertSegment } from "./bcsc-form-harness.js";
import { knowledgeRead } from "../knowledge/tools.js";
import { readFirmProfile } from "../tools/practice/firm-profile.js";
import { submissionFormsEmitBccaFactum, submissionFormsRender, type RenderResult } from "./forms.js";
import { publishDraftTarget, publishTarget, runPublishFill, writeWorkingFile, writingSubfolder } from "./publish-host.js";

export interface PublishGeneralArgs {
  matter_root: string;
  db_path: string;
  filing_id: number;
  /** The deliverable's base name, a bare stem the caller composed under the firm's naming convention. */
  output_name: string;
  format_path: string;
  letter?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
}

export interface PublishBccaFactumArgs {
  matter_root: string;
  db_path: string;
  filing_id: number;
  /** The factum's base name, a bare stem the caller composed under the firm's naming convention. */
  output_name: string;
  dated_on: string;
}

export interface PublishVaniacArgs {
  matter_root: string;
  db_path: string;
  filing_id: number;
  writing_folder: string;
  round: string;
}

/** A filed render that refused (bundle_outdated, filing_retired or any *_gate_failed), as this tool's refusal. */
function renderRefusal(render: RenderResult): Record<string, unknown> | null {
  const refusal = (key: string) => key === "bundle_outdated" || key === "filing_retired" || key.endsWith("_gate_failed");
  const flag = Object.entries(render).find(([key, value]) => value === true && refusal(key));
  return flag ? { success: false, error: flag[0], detail: render.note, render } : null;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** publish-general steps 2-5: the filed render, the format file, the letterhead inputs, then fill_general.py. */
export function publishGeneral(args: PublishGeneralArgs, env: NodeJS.ProcessEnv = process.env, installRoot?: string): unknown {
  assertSegment(args.output_name, "output_name");
  const target = publishDraftTarget(args.matter_root, args.db_path, env);
  const filed = submissionFormsRender(args.db_path, args.filing_id, {}, "filed");
  const refused = renderRefusal(filed);
  if (refused) return refused;
  const layout = filed.stored_layout?.layout as Record<string, unknown> | undefined;
  if (layout?.renderer === "bespoke") {
    return {
      success: false,
      error: "bespoke_renderer",
      detail: `Filing ${args.filing_id}'s stored layout declares the bespoke renderer, which publish-general never renders. Name the subskill that fills this kind.`,
    };
  }
  const format = knowledgeRead(args.format_path, { env, installRoot });

  const write = (name: string, value: unknown) => writeWorkingFile(target, ["publish-general"], name, json(value));
  const argv = ["--filed", write("filed.json", filed), "--format", write("format.json", format), "--out-dir", target.draft, "--out-name", args.output_name];
  if (args.letter !== undefined) argv.push("--letter", write("letter.json", args.letter));
  if (layout?.letterhead === true) argv.push("--profile", write("profile.json", readFirmProfile(env)));
  if (args.tokens !== undefined) argv.push("--tokens", write("tokens.json", args.tokens));
  return runPublishFill("publish-general", "fill_general.py", [argv], env, installRoot);
}

/** publish-bcca-factum steps 4-7: the emitter, bcca-factum.md, then fill_factum.py --validate and the fill. */
export function publishBccaFactum(args: PublishBccaFactumArgs, env: NodeJS.ProcessEnv = process.env, installRoot?: string): unknown {
  assertSegment(args.output_name, "output_name");
  const target = publishDraftTarget(args.matter_root, args.db_path, env);
  const emitted = submissionFormsEmitBccaFactum(args.db_path, args.filing_id, args.dated_on);
  if ("bundle_outdated" in emitted) return { success: false, error: "bundle_outdated", detail: emitted.note, emit: emitted };
  if ("parties_drift_gate_failed" in emitted) return { success: false, error: "parties_drift_gate_failed", detail: emitted.note, emit: emitted };
  const md = writeWorkingFile(target, ["bcca-factum-substance"], "bcca-factum.md", emitted.markdown);
  return runPublishFill("publish-bcca-factum", "fill_factum.py", [["--validate", md], [md, target.draft, "--out-name", args.output_name]], env, installRoot);
}

const WITNESS_SOURCE = /^Witness Statement - (.+)\.md$/;
const SOURCES = new Set(["Written Arguments.md", "Evidence Index.md"]);
/** publish-vaniac-package step 6: what the binder takes by name, PDFs included. */
const PREVIOUS_SET = /^(Index\.docx$|Written Argument of the |Witness Statement of )/i;

/** publish-vaniac-package step 3: the mockup folder's name without any leading date and the SUB code. */
function vaniacFilingFolder(writingFolder: string): string {
  const match = /^(?:\d{4}-\d{2}-\d{2} )?SUB (.+)$/.exec(writingFolder);
  if (!match) {
    throw new ValidationError(`writing_folder must be the filing's mockup folder, "SUB <filing folder>" with or without a leading YYYY-MM-DD: ${writingFolder}`);
  }
  assertSegment(match[1], "writing_folder's filing folder");
  return match[1];
}

/** publish-vaniac-package steps 3-8: the wider Package\ scan, the filed render, the source files, then fill_vaniac.py. */
export function publishVaniacPackage(args: PublishVaniacArgs, env: NodeJS.ProcessEnv = process.env, installRoot?: string): unknown {
  const target = publishTarget(args.matter_root, args.db_path, args.writing_folder, env);
  const dataFolders = ["vaniac-submissions", vaniacFilingFolder(args.writing_folder)];
  const pkg = writingSubfolder(target, "Package");
  const previous = existsSync(pkg) ? readdirSync(pkg).filter((name) => PREVIOUS_SET.test(name)) : [];
  if (previous.length > 0) {
    return {
      success: false,
      error: "output_exists",
      detail: `Package\\ still holds the previous set: ${previous.join(", ")}. Nothing was written. Ask the practitioner to move it aside by hand; never overwrite, rename or delete it.`,
    };
  }

  const filed = submissionFormsRender(args.db_path, args.filing_id, {}, "filed");
  const refused = renderRefusal(filed);
  if (refused) return refused;
  const sources = filed.documents.filter((doc) => SOURCES.has(doc.file_name) || WITNESS_SOURCE.test(doc.file_name));
  if (!sources.some((doc) => doc.file_name === "Written Arguments.md")) {
    return { success: false, error: "not_vaniac", detail: `Filing ${args.filing_id}'s filed render has no Written Arguments.md: it is not a VanIAC submissions package.` };
  }
  const witnesses: string[] = [];
  for (const doc of sources) {
    writeWorkingFile(target, dataFolders, doc.file_name, doc.markdown ?? "");
    const witness = WITNESS_SOURCE.exec(doc.file_name);
    if (witness) witnesses.push(witness[1]);
  }

  const data = pathWin32.join(target.caseData, ...dataFolders);
  const argv = [data, pkg, "--round", args.round, "--index-json", pathWin32.join(data, "Package index.json")];
  for (const name of witnesses) argv.push("--witness", name);
  return runPublishFill("publish-vaniac-package", "fill_vaniac.py", [argv], env, installRoot);
}
