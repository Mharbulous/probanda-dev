// drafting_forms__emit_form32 and drafting_forms__emit_form33: the BCSC filed faces.

import { currentSchemaVersion } from "../migrate.js";
import { renderableSchemaVersion } from "../schema-ceiling.js";
import { fetchProceeding, fetchRevision, type FilingRow } from "./query.js";
import { renderForm32FiledFace } from "./render-form32-filed-face.js";
import { renderForm33FiledFace } from "./render-form33-filed-face.js";
import { fetchUnplacedFacts, refuseUnplacedFacts } from "./unplaced-facts.js";
import { publishFileName, publishSidecar, type PublishWarning } from "../publish-sidecar.js";
import { formCurrency, type FormCurrency } from "../form-currency.js";
import type { KnowledgeSeams } from "../../knowledge/tree.js";
import { confineCaseDataFolder, writeSubstanceFile } from "../substance-file.js";
import { fetchFilingById, refuseJobOnlyBoard, readSchemaVersion } from "./filing-reads.js";
import { buildContext } from "./render-context.js";
import { nowStamp } from "./timings.js";
import { partiesFor, type PartiesDriftRefusal, partiesDriftRefusal } from "./writing-parties.js";

/** The publish route's options for the Form 32 and Form 33 emitters (spec 2026-10-09). */
export interface PublishOptions {
  /** Print a placeholder and return a warning for missing data, never refusing for it. */
  lenient?: boolean;
  /** The session's own cover lines, such as the practitioner's words asking for the document. */
  cover_notes?: string[];
}

export interface EmitForm32Result {
  filing_id: number;
  revision: number;
  file_name: string;
  markdown: string;
  /** Where the markdown was written on the host, when case_data_folder was given. */
  written_path?: string;
  /** The publish sidecar (publish-sidecar.ts): its file name, its text, and where it was written. */
  publish_file_name: string;
  publish_json: string;
  publish_path?: string;
  /** Every cover line: the emitter's missing data (each Part 2 fact with no court record among it),
   * the unmet criteria, then the session's notes. */
  warnings: PublishWarning[];
  /** Form 32's currency (ADR 0038). The markdown never carries its warning. */
  form_currency: FormCurrency;
}

/** A lenient emit's line for each fact a submission rests on that the facts Part does not hold,
 * which a strict emit refuses (refuseUnplacedFacts): the filed face leaves the fact out. */
function unplacedFactWarnings(dbPath: string, filing: FilingRow): PublishWarning[] {
  return fetchUnplacedFacts(dbPath, filing).map((u): PublishWarning => ({
    kind: "other",
    field_or_id: `fact ${u.fact_id}`,
    message: `A submission rests on a fact the facts Part does not hold, so the form leaves it out: ${JSON.stringify(u.postulate)}.`,
  }));
}

export interface EmitForm32Refusal {
  filing_id: number;
  schema_version: number | null;
  current_schema_version: number;
  bundle_outdated: true;
  note: string;
}

/**
 * The Form 32 filed-face emitter (issue #392, handoff contract #376):
 * strict-grammar form-32.md for one notice_of_application filing, per
 * .claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md
 * (SSOT). Writes nothing to disk -- mirrors submissionFormsRender's
 * renderMode:'filed' precedent: under the contract's "Division of
 * discipline" the emitter owns filed-face content and the caller owns
 * placement, so the caller (the draft skill, /draft) writes the returned
 * markdown to {matter-data folder}/bcsc-form-substance/form-32.md itself.
 * Same ahead-of-bundle schema gate as
 * submissionFormsRender -- rendering against a schema newer than the
 * installed bundle is unsafe the same way here as anywhere else.
 * Given caseDataFolder (#1267, ADR 0025), it also writes the markdown there
 * itself, host-side, because a Cowork caller's own write lands in its sandbox.
 * Beside the markdown it returns, and given caseDataFolder writes, the publish sidecar
 * form-32-publish.json, from which asm32 reads the caption and the cover (spec 2026-10-09). Lenient,
 * missing data becomes warnings; the schema gate and the party drift gate still refuse.
 */
export function submissionFormsEmitForm32(
  dbPath: string,
  filingId: number,
  caseDataFolder?: string,
  /** Test seam only: the scratch skills tree the form currency check reads (ADR 0038). */
  seams: KnowledgeSeams = {},
  publish: PublishOptions = {}
): EmitForm32Result | EmitForm32Refusal | PartiesDriftRefusal {
  const caseData = caseDataFolder === undefined ? undefined : confineCaseDataFolder(dbPath, caseDataFolder);
  const schemaVersion = readSchemaVersion(dbPath);
  // The ceiling is what THIS bundle can read, not what the working tree's engine targets
  // (#812) -- the two are the same number only until a schema hop lands unpackaged.
  const currentVersion = renderableSchemaVersion(currentSchemaVersion());
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was emitted -- rendering against a schema newer than the installed bundle can crash or produce wrong output. " +
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_form32 again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing);
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_form32");
  if (refusal) return refusal;
  const lenient = publish.lenient === true ? unplacedFactWarnings(dbPath, filing) : undefined;
  if (lenient === undefined) refuseUnplacedFacts(dbPath, filing, "drafting_forms__emit_form32");
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  const markdown = renderForm32FiledFace(ctx, lenient);
  const sidecar = publishSidecar(ctx, lenient ?? [], publish.cover_notes ?? []);
  const publishName = publishFileName("form-32.md");
  return {
    filing_id: filingId,
    revision,
    file_name: "form-32.md",
    markdown,
    ...(caseData === undefined ? {} : { written_path: writeSubstanceFile(caseData, "form-32.md", markdown) }),
    publish_file_name: publishName,
    publish_json: sidecar.json,
    ...(caseData === undefined ? {} : { publish_path: writeSubstanceFile(caseData, publishName, sidecar.json) }),
    warnings: sidecar.warnings,
    form_currency: formCurrency("form-32", nowStamp().slice(0, 10), seams),
  };
}

export interface EmitForm33Result {
  filing_id: number;
  revision: number;
  file_name: string;
  markdown: string;
  /** Where the markdown was written on the host, when case_data_folder was given. */
  written_path?: string;
  /** The publish sidecar, as on EmitForm32Result. */
  publish_file_name: string;
  publish_json: string;
  publish_path?: string;
  warnings: PublishWarning[];
  /** Form 33's currency (ADR 0038). The markdown never carries its warning. */
  form_currency: FormCurrency;
}

export interface EmitForm33Refusal {
  filing_id: number;
  schema_version: number | null;
  current_schema_version: number;
  bundle_outdated: true;
  note: string;
}

/**
 * The Form 33 filed-face emitter (issue #386, handoff contract #376):
 * strict-grammar form-33.md for one application_response filing, per
 * .claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md
 * (SSOT). Mirrors submissionFormsEmitForm32 (#392) exactly -- same
 * write-nothing-to-disk shape, same ahead-of-bundle schema gate, same
 * optional host-side write given caseDataFolder, same publish sidecar and lenient emit.
 */
export function submissionFormsEmitForm33(
  dbPath: string,
  filingId: number,
  caseDataFolder?: string,
  /** Test seam only: the scratch skills tree the form currency check reads (ADR 0038). */
  seams: KnowledgeSeams = {},
  publish: PublishOptions = {}
): EmitForm33Result | EmitForm33Refusal | PartiesDriftRefusal {
  const caseData = caseDataFolder === undefined ? undefined : confineCaseDataFolder(dbPath, caseDataFolder);
  const schemaVersion = readSchemaVersion(dbPath);
  // The ceiling is what THIS bundle can read, not what the working tree's engine targets
  // (#812) -- the two are the same number only until a schema hop lands unpackaged.
  const currentVersion = renderableSchemaVersion(currentSchemaVersion());
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was emitted -- rendering against a schema newer than the installed bundle can crash or produce wrong output. " +
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_form33 again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing);
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_form33");
  if (refusal) return refusal;
  const lenient = publish.lenient === true ? unplacedFactWarnings(dbPath, filing) : undefined;
  if (lenient === undefined) refuseUnplacedFacts(dbPath, filing, "drafting_forms__emit_form33");
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  const markdown = renderForm33FiledFace(ctx, lenient);
  const sidecar = publishSidecar(ctx, lenient ?? [], publish.cover_notes ?? []);
  const publishName = publishFileName("form-33.md");
  return {
    filing_id: filingId,
    revision,
    file_name: "form-33.md",
    markdown,
    ...(caseData === undefined ? {} : { written_path: writeSubstanceFile(caseData, "form-33.md", markdown) }),
    publish_file_name: publishName,
    publish_json: sidecar.json,
    ...(caseData === undefined ? {} : { publish_path: writeSubstanceFile(caseData, publishName, sidecar.json) }),
    warnings: sidecar.warnings,
    form_currency: formCurrency("form-33", nowStamp().slice(0, 10), seams),
  };
}
