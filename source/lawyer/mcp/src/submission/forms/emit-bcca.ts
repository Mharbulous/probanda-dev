// drafting_forms__emit_bcca_book and drafting_forms__emit_bcca_factum.

import { currentSchemaVersion } from "../migrate.js";
import { renderableSchemaVersion } from "../schema-ceiling.js";
import { fetchProceeding, fetchRevision } from "./query.js";
import { renderBccaBookFiledFace } from "./emit-bcca-book.js";
import { renderBccaFactumFiledFace } from "./emit-bcca-factum.js";
import { fetchFilingById, refuseJobOnlyBoard, readSchemaVersion } from "./filing-reads.js";
import { buildContext } from "./render-context.js";
import { partiesFor, type PartiesDriftRefusal, partiesDriftRefusal } from "./writing-parties.js";

export interface EmitBccaBookResult {
  filing_id: number;
  revision: number;
  file_name: string;
  markdown: string;
}

export interface EmitBccaBookRefusal {
  filing_id: number;
  schema_version: number | null;
  current_schema_version: number;
  bundle_outdated: true;
  note: string;
}

/**
 * The bcca-book.md filed-face emitter: response-book and Book of Authorities cover/TOC data
 * for one bcca_stay_response filing, per
 * source/skills/publish/subskills/publish-bcca-book/references/bcca-book-contract.md (SSOT). Mirrors
 * submissionFormsEmitForm32/33 exactly -- same write-nothing-to-disk shape, same
 * ahead-of-bundle schema gate.
 */
export function submissionFormsEmitBccaBook(dbPath: string, filingId: number): EmitBccaBookResult | EmitBccaBookRefusal | PartiesDriftRefusal {
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
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_bcca_book again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing);
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_bcca_book");
  if (refusal) return refusal;
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  return {
    filing_id: filingId,
    revision,
    file_name: "bcca-book.md",
    markdown: renderBccaBookFiledFace(ctx),
  };
}

/**
 * The bcca-factum.md filed-face emitter (#648): one bcca_factum filing's cover, parts and
 * appendices, per source/skills/publish/subskills/publish-bcca-factum/references/bcca-factum-contract.md (SSOT).
 * Same shape as submissionFormsEmitBccaBook; datedOn is the factum's date, which is never stored.
 */
export function submissionFormsEmitBccaFactum(dbPath: string, filingId: number, datedOn: string): EmitBccaBookResult | EmitBccaBookRefusal | PartiesDriftRefusal {
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
        "Nothing was emitted. Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_bcca_factum again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing);
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_bcca_factum");
  if (refusal) return refusal;
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  return {
    filing_id: filingId,
    revision,
    file_name: "bcca-factum.md",
    markdown: renderBccaFactumFiledFace(ctx, datedOn),
  };
}
