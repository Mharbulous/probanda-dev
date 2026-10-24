// drafting_forms__pre_filing_check: the pre-filing consistency gate.

import { currentSchemaVersion } from "../migrate.js";
import { renderableSchemaVersion } from "../schema-ceiling.js";
import { fetchRevision } from "./query.js";
import { ValidationError } from "../../errors.js";
import { runPreFilingChecks, type PreFilingChecksResult } from "../pre-filing/index.js";
import { fetchFilingById, refuseJobOnlyBoard, readSchemaVersion } from "./filing-reads.js";

export interface PreFilingCheckResult extends PreFilingChecksResult {
  filing_id: number;
  revision: number;
}

export interface PreFilingCheckRefusal {
  filing_id: number;
  schema_version: number | null;
  current_schema_version: number;
  bundle_outdated: true;
  note: string;
}

/**
 * The pre-filing consistency gate (issue #615): deterministic, read-only checks of one
 * filing's assembled package folder against itself and the filing's Evidence Index rows.
 * Writes nothing anywhere (decision D4 -- the gate reports, a ticket fixes). Same
 * ahead-of-bundle schema gate as the emitters; refuses a retired filing outright.
 */
export function submissionFormsPreFilingCheck(dbPath: string, filingId: number, packageDir: string): PreFilingCheckResult | PreFilingCheckRefusal {
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
        "Nothing was checked -- reading against a schema newer than the installed bundle can produce wrong output. " +
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__pre_filing_check again.",
    };
  }
  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing);
  if (filing.retired_on) throw new ValidationError(`"${filing.title}" was retired on ${filing.retired_on}; there is nothing to check before filing`);
  const revision = fetchRevision(dbPath);
  return { filing_id: filingId, revision, ...runPreFilingChecks(dbPath, filingId, packageDir) };
}
