// The noting-up status the Legal Research page shows on a case, a statute and a proposition's authority.
// The database records that a case was noted up but not how far the check went, so a recorded result reads
// as negative treatment only, the least it can mean: a badge never claims more than the record proves. It
// records nothing at the proposition level, so no status here reaches that level. The 📇 marker
// (markers.ts noteUpMarker) is a separate question, and this reads nothing from it.

import { LEGISLATION_KINDS } from "./markers.js";

export interface NoteUpStatus {
  label: string;
  /** Whether any note-up is recorded, which the page's badge colour follows. */
  noted: boolean;
}

const NOT_NOTED_UP: NoteUpStatus = { label: "Not noted up", noted: false };

/** The currency results that finish a statute's in-force check (shared/statute-currency.md): any other
 * value means the check did not complete. */
const CHECK_FINISHED: ReadonlySet<string> = new Set(["current", "repealed", "archived"]);

/** A recorded treatment as the page prints it. */
export function treatmentWord(treatment: string): string {
  return treatment.replace(/_/g, " ");
}

/** A case on the Cases tab, or a statute's note-up for cases on the Statutes tab. */
export function authorityNoteUp(treatment: string | null): NoteUpStatus {
  return treatment === null ? NOT_NOTED_UP : { label: "Noted up: negative treatment only", noted: true };
}

/** A proposition's authority on the Propositions tab, or null for doctrine, which is never noted up. */
export function statementNoteUp(kind: string | null, treatment: string | null, currencyStatus: string | null): NoteUpStatus | null {
  if (kind === "doctrine") return null;
  if (kind !== null && LEGISLATION_KINDS.has(kind)) {
    return currencyStatus !== null && CHECK_FINISHED.has(currencyStatus) ? { label: "Statute level: in-force check done", noted: true } : NOT_NOTED_UP;
  }
  return treatment === null ? NOT_NOTED_UP : { label: "Case noted up: negative treatment only", noted: true };
}
