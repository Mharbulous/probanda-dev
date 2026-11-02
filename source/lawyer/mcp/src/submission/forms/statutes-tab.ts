// The Legal Research page's Statutes tab (legal-research-page.ts): each statute, regulation and rule the
// board's Writings rely on, then the proceeding's other live ones, with when its currency was last checked
// and whether it has been noted up for cases. Everything shown is recorded. No step records a statute's
// note-up for cases yet (shared/statute-currency.md → Noting up legislation), so that status reads Not noted
// up until one does.

import { rows } from "../query-rows.js";
import { hasTable } from "../schema-capabilities.js";
import { foldKey, reliedOn } from "./case-briefs.js";
import { LEGISLATION_KINDS } from "./markers.js";
import { authorityNoteUp, treatmentWord, type NoteUpStatus } from "./note-up-status.js";

export interface StatuteProvision {
  /** The pinpoint exactly as a statement of law records it. */
  provision: string;
  currency_status: string | null;
  checked_on: string | null;
}

export interface StatuteRow {
  title: string;
  citation: string | null;
  relied_on: boolean;
  currency_status: string | null;
  currency_checked_on: string | null;
  note_up: NoteUpStatus;
  /** Each distinct treatment its authority rows record. */
  results: string[];
  provisions: StatuteProvision[];
}

export interface StatutesData {
  /** The relied-on ones by title, then the rest by title. */
  statutes: StatuteRow[];
}

interface AuthorityRow {
  id: number;
  style_of_cause_or_title: string;
  citation: string | null;
  treatment: string | null;
  currency_status: string | null;
  currency_checked_on: string | null;
}

/** Each pinpoint a statement records for the authority, with its own currency check where there is one. */
function provisionsOf(dbPath: string, authorityId: number): StatuteProvision[] {
  const checks = hasTable(dbPath, "provision_currency");
  return rows<StatuteProvision>(
    dbPath,
    `SELECT DISTINCT sl.pinpoint AS provision, ${checks ? "pc.currency_status, pc.checked_on" : "NULL AS currency_status, NULL AS checked_on"}
     FROM statements_of_law sl
     ${checks ? "LEFT JOIN provision_currency pc ON pc.authority_id = sl.authority_id AND pc.provision = sl.pinpoint" : ""}
     WHERE sl.authority_id = ? AND sl.pinpoint IS NOT NULL AND TRIM(sl.pinpoint) <> ''
     ORDER BY sl.pinpoint`,
    [authorityId]
  );
}

/** The tab's data for one board. `filingIds` are its Writings and `proceedingIds` their proceedings. */
export function buildStatutesData(dbPath: string, filingIds: number[], proceedingIds: number[]): StatutesData {
  const kinds = [...LEGISLATION_KINDS];
  const relied = reliedOn(dbPath, filingIds, kinds);
  const reliedIds = new Set(relied.map((a) => a.id));
  const ids = [...new Set(proceedingIds)];
  const others = ids.length === 0 ? [] : rows<AuthorityRow>(
    dbPath,
    `SELECT id, style_of_cause_or_title, citation, treatment, currency_status, currency_checked_on
     FROM authorities
     WHERE kind IN (${kinds.map((k) => `'${k}'`).join(", ")}) AND killed_on IS NULL AND proceeding_id IN (${ids.map(() => "?").join(", ")})
     ORDER BY style_of_cause_or_title, id`,
    ids
  ).filter((a) => !reliedIds.has(a.id));

  // Authorities are per proceeding, so a merged board's one statute can hold two rows: they fold as cases do.
  const statutes = new Map<string, StatuteRow>();
  const add = (a: AuthorityRow, isRelied: boolean) => {
    const key = foldKey(a.citation, a.id, a.style_of_cause_or_title);
    let target = statutes.get(key);
    if (target === undefined) {
      target = { title: a.style_of_cause_or_title, citation: a.citation, relied_on: isRelied, currency_status: a.currency_status, currency_checked_on: a.currency_checked_on, note_up: authorityNoteUp(null), results: [], provisions: [] };
      statutes.set(key, target);
    }
    if ((a.currency_checked_on ?? "") > (target.currency_checked_on ?? "")) {
      target.currency_status = a.currency_status;
      target.currency_checked_on = a.currency_checked_on;
    }
    if (a.treatment !== null) {
      target.note_up = authorityNoteUp(a.treatment);
      if (!target.results.includes(treatmentWord(a.treatment))) target.results.push(treatmentWord(a.treatment));
    }
    for (const p of provisionsOf(dbPath, a.id)) {
      if (!target.provisions.some((held) => held.provision === p.provision)) target.provisions.push(p);
    }
  };
  for (const a of relied) add(a, true);
  for (const a of others) add(a, false);
  const all = [...statutes.values()];
  return { statutes: [...all.filter((s) => s.relied_on), ...all.filter((s) => !s.relied_on)] };
}
