// A fact a submission on a Notice of Application or an Application Response rests on is placed in
// the form's facts Part (schema v59; planning/1. Design/2026-10-06_submission-facts-part3-placement-spec.md
// §4). The database places every such fact on a drafting Writing, so an attached fact missing from
// the facts Part survives only on a database held below v59 or on a Writing whose kind changed. The
// mockup names it NOT PLACED in a comment (renderSubmissionParagraphs); the filed face strips
// comments and would drop it silently, so both filed-face paths -- drafting_forms__render in filed
// mode, and drafting_forms__emit_form32 / emit_form33 -- refuse a drafting Writing through
// refuseUnplacedFacts. A sent or retired Writing renders as it was sent.

import { ValidationError } from "../../errors.js";
import { submissionDataQuery } from "../backend.js";
import type { FilingRow } from "./query.js";

export interface UnplacedFact {
  submission_id: number;
  fact_id: number;
  postulate: string;
}

/** Each kind's facts Part, as its form's filing_facts rows record it. */
const FACTS_PART = new Map([
  ["notice_of_application", "part2"],
  ["application_response", "part4"],
]);

/** Every fact attached to a live submission on a drafting Notice of Application's or Application
 * Response's form that the form's facts Part does not hold, in form order. Empty for a sent or
 * retired Writing and for every other kind. */
export function fetchUnplacedFacts(dbPath: string, filing: Pick<FilingRow, "id" | "kind" | "filed_on" | "retired_on">): UnplacedFact[] {
  const part = FACTS_PART.get(filing.kind);
  if (part === undefined || filing.filed_on || filing.retired_on) return [];
  return submissionDataQuery(
    dbPath,
    `SELECT fs.submission_id, sf.fact_id, f.postulate
     FROM filing_submissions fs
     JOIN submissions s ON s.id = fs.submission_id AND s.killed_on IS NULL
     JOIN submission_facts sf ON sf.submission_id = fs.submission_id
     JOIN facts f ON f.id = sf.fact_id
     WHERE fs.filing_id = ? AND fs.document = 'form'
       AND NOT EXISTS (SELECT 1 FROM filing_facts ff
                        WHERE ff.filing_id = fs.filing_id AND ff.document = 'form' AND ff.part = ? AND ff.fact_id = sf.fact_id)
     ORDER BY fs.ordinal, sf.fact_id`,
    [filing.id, part]
  ).rows as unknown as UnplacedFact[];
}

/** Throws `facts_not_placed`, naming the Writing and each submission and fact, when the Writing has
 * an attached fact fetchUnplacedFacts finds. `tool` names the caller in the message. */
export function refuseUnplacedFacts(dbPath: string, filing: Pick<FilingRow, "id" | "kind" | "filed_on" | "retired_on">, tool: string): void {
  const unplaced = fetchUnplacedFacts(dbPath, filing);
  if (unplaced.length === 0) return;
  throw new ValidationError(
    `Refusing ${tool}: Writing ${filing.id} has submissions resting on facts its facts Part does not hold, which the filed face would drop: ` +
      unplaced.map((u) => `submission ${u.submission_id}, fact ${u.fact_id} ${JSON.stringify(u.postulate)}`).join("; ") +
      `. The mockup names each NOT PLACED. Place each fact in the form's facts Part (filing_facts, document 'form', part '${FACTS_PART.get(filing.kind)}'), or detach it from its submission, then call ${tool} again.`,
    "facts_not_placed"
  );
}
