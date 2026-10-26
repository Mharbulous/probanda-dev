// The opposing points of a proceeding.

import { rows } from "../query-rows.js";


export interface OpposingPointRow {
  id: number;
  component: string;
  pinpoint: string | null;
  verbatim_words: string | null;
  answered_by_submission_id: number | null;
  answered_by_contention: string | null;
}

/** opposing_points (build #359): proceeding-scoped -- the table carries no
 * filing/round column, and a coverage inventory is meant to read across the
 * whole proceeding, not just this filing. Rendered as a mockup-only
 * "Opposing points" section (↩️ is a work marker like any other, so it
 * renders for the human and is stripped from the filed face, filed-face.ts)
 * -- the filed answer to a point is the responsive submission's own
 * verbatim-quoted anchor, not this inventory. */
export function fetchOpposingPoints(dbPath: string, proceedingId: number): OpposingPointRow[] {
  return rows<OpposingPointRow>(
    dbPath,
    `SELECT op.id, op.component, op.pinpoint, op.verbatim_words, op.answered_by_submission_id,
            s.contention AS answered_by_contention
     FROM opposing_points op
     LEFT JOIN submissions s ON s.id = op.answered_by_submission_id
     WHERE op.proceeding_id = ?
     ORDER BY op.ordinal`,
    [proceedingId]
  );
}
