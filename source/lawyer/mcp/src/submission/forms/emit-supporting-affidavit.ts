// drafting_forms__emit_affidavit: a supporting affidavit's filed face.

import { currentSchemaVersion } from "../migrate.js";
import { renderableSchemaVersion } from "../schema-ceiling.js";
import { fetchProceeding, fetchRevision } from "./query.js";
import { renderAffidavitFiledFace } from "./emit-affidavit.js";
import { fetchAffidavits } from "./render-bcsc-affidavit.js";
import { ValidationError } from "../../errors.js";
import { confineCaseDataFolder, writeSubstanceFile } from "../substance-file.js";
import { type EmitForm32Refusal } from "./emit-bcsc-forms.js";
import { fetchFilingById, refuseJobOnlyBoard, readSchemaVersion } from "./filing-reads.js";
import { buildContext } from "./render-context.js";
import { partiesFor, type PartiesDriftRefusal, partiesDriftRefusal } from "./writing-parties.js";

export interface EmitAffidavitResult {
  filing_id: number;
  document_id: number;
  revision: number;
  file_name: string;
  markdown: string;
  /** Where the markdown was written on the host, when case_data_folder was given. */
  written_path?: string;
}

/**
 * The supporting affidavit filed-face emitter (#1487): affidavit-<document_id>.md for one affidavit
 * a notice_of_application or application_response lists under role 'affidavit', the input of
 * publish-bcsc-form's Form 109 fill (#1488). Same ahead-of-bundle schema gate, party drift gate
 * and optional host-side write as submissionFormsEmitForm32. It refuses on every 🧩 the
 * affidavit's mockup shows (forms/emit-affidavit.ts).
 */
export function submissionFormsEmitAffidavit(dbPath: string, filingId: number, documentId: number, caseDataFolder?: string): EmitAffidavitResult | EmitForm32Refusal | PartiesDriftRefusal {
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
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_affidavit again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing);
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_affidavit");
  if (refusal) return refusal;
  if (filing.kind !== "notice_of_application" && filing.kind !== "application_response") {
    throw new ValidationError(
      `"${filing.title}" is not a notice of application or an application response, the only Writings whose supporting affidavits are made here.`
    );
  }
  const affidavit = fetchAffidavits(dbPath, filingId).find((a) => a.id === documentId);
  if (affidavit === undefined) {
    throw new ValidationError(`That document is not an affidavit listed as supporting "${filing.title}".`);
  }
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  const markdown = renderAffidavitFiledFace(ctx, affidavit);
  const fileName = `affidavit-${documentId}.md`;
  return {
    filing_id: filingId,
    document_id: documentId,
    revision,
    file_name: fileName,
    markdown,
    ...(caseData === undefined ? {} : { written_path: writeSubstanceFile(caseData, fileName, markdown) }),
  };
}
