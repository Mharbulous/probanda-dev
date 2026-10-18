// Party and counsel read from case data (party/counsel SSOT; ADR 0011's 2026-09-30 amendment).
//
// Counsel of record and the address for service are court-record state, owned by /matter-data, which
// applies every counsel-change notice and order. A drafting Writing's party rows take those five
// values from /matter-data, read live through case/parties-of-record.ts and matched by
// `case_party_id`: the parties of record of the proceeding's file number, or, for a proceeding with
// no file number yet, the linked parties themselves. Every row whose values cannot be read so is
// drift, and holds them NULL, never the submission copy: drafting_forms__open_session returns the
// drift rows, the mockup marks each drifted party for the human, and the filed render and the
// filed-face emitters refuse while any stands. A sent Writing is never read: it renders the party
// rows it printed (`parties_snapshot`, schema v41). counselOffers lists each value the submission
// copy still holds that case data does not, for the practitioner to apply to case data, discard or
// hold before the copy is dropped: schema v43 drops it, and drafting_data__migrate refuses that hop
// while any offer or drift row stands.
//
// No matter-data table or column name appears here: the read returns this runtime's own field names.

import { dirname } from "node:path";

import { gapMarker, mockupMessage } from "./forms/markers.js";
import {
  fetchAllProceedings,
  fetchParties,
  fetchPartiesAsHeld,
  type CaseDataField,
  type PartyRow,
  type StoredPartyRow,
} from "./forms/query.js";
import { readPartiesById, readPartiesOfRecord, type PartyOfRecord } from "../case/parties-of-record.js";

/** The values /matter-data owns, which a drafting Writing's party rows take from it. */
const CASE_DATA_FIELDS: readonly CaseDataField[] = ["counsel_name", "counsel_firm", "counsel_email", "counsel_phone", "address_for_service"];

export interface PartiesDriftRow {
  proceeding_id: number;
  file_number: string;
  party_id: number;
  name: string;
  role: string;
  case_party_id: number | null;
  /** `unlinked`: no case_party_id. `not_of_record`: linked to a matter-data party that is not a party
   * of record in this proceeding, or, with no file number, that case data does not hold.
   * `unchecked`: case data could not be read for this proceeding, and `reason` says why. */
  kind: "unlinked" | "not_of_record" | "unchecked";
  reason?: string;
}

export interface PartiesDrift {
  rows: PartiesDriftRow[];
  /** Present when case data could not be read for the proceeding: every party is then an
   * `unchecked` row, and the note says why. */
  unchecked?: { note: string };
}

export interface DraftingParties {
  /** The drafting party rows, each holding case data's five values, or NULL in all five where it drifts. */
  parties: PartyRow[];
  drift: PartiesDrift;
}

/** The row with case data's five values, or with all five NULL when `caseParty` is absent. */
function withCaseData(p: StoredPartyRow, caseParty: PartyOfRecord | undefined): PartyRow {
  const values = {} as Pick<PartyRow, CaseDataField>;
  for (const field of CASE_DATA_FIELDS) values[field] = caseParty === undefined ? null : caseParty[field];
  return { ...p, ...values };
}

/**
 * One proceeding's drafting party rows with counsel and the address for service read from case data
 * in `caseDataDir`, and the drift: every row whose values could not be read. With a file number the
 * read is the proceeding's parties of record; with none, each linked party's own values, and when no
 * party is linked there is nothing to read.
 */
export function draftingParties(
  caseDataDir: string,
  proceeding: { id: number; file_number: string | null },
  parties: readonly StoredPartyRow[],
  env: NodeJS.ProcessEnv = process.env
): DraftingParties {
  if (parties.length === 0) return { parties: [], drift: { rows: [] } };
  const fileNumber = (proceeding.file_number ?? "").trim();
  const linkOf = (p: StoredPartyRow) => p.case_party_id ?? null;
  const linked = [...new Set(parties.flatMap((p) => (linkOf(p) === null ? [] : [linkOf(p) as number])))];
  const base = (p: StoredPartyRow) => ({
    proceeding_id: proceeding.id,
    file_number: fileNumber,
    party_id: p.id,
    name: p.name,
    role: p.role,
    case_party_id: linkOf(p),
  });
  const record =
    fileNumber !== "" ? readPartiesOfRecord(caseDataDir, fileNumber, env) : linked.length > 0 ? readPartiesById(caseDataDir, linked, env) : null;
  if (record !== null && record.status !== "ok") {
    const which = fileNumber !== "" ? `proceeding ${fileNumber}` : `pre-filing proceeding ${proceeding.id}`;
    return {
      parties: parties.map((p) => withCaseData(p, undefined)),
      drift: {
        rows: parties.map((p) => ({ ...base(p), kind: "unchecked" as const, reason: record.reason })),
        unchecked: { note: `counsel of the parties of ${which} not read from case data: ${record.reason}` },
      },
    };
  }
  const read = new Map((record?.parties ?? []).map((c) => [c.case_party_id, c]));
  const rows: PartiesDriftRow[] = [];
  const resolved = parties.map((p) => {
    const link = linkOf(p);
    const caseParty = link === null ? undefined : read.get(link);
    if (link === null) rows.push({ ...base(p), kind: "unlinked" });
    else if (caseParty === undefined) rows.push({ ...base(p), kind: "not_of_record" });
    return withCaseData(p, caseParty);
  });
  return { parties: resolved, drift: { rows } };
}

/** Every proceeding's drift in the database at `dbPath`, read against the case data in the folder
 * holding it, with a note naming each proceeding whose case data could not be read. */
export function matterPartiesDrift(dbPath: string, env: NodeJS.ProcessEnv = process.env): { rows: PartiesDriftRow[]; note?: string } {
  const rows: PartiesDriftRow[] = [];
  const uncheckedWhy: string[] = [];
  for (const proceeding of fetchAllProceedings(dbPath)) {
    const { drift } = draftingParties(dirname(dbPath), proceeding, fetchParties(dbPath, proceeding.id), env);
    rows.push(...drift.rows);
    if (drift.unchecked) uncheckedWhy.push(drift.unchecked.note);
  }
  return { rows, ...(uncheckedWhy.length > 0 ? { note: uncheckedWhy.join("; ") } : {}) };
}

/** A value the submission copy holds that case data does not, offered back to the practitioner. */
export interface CounselOffer {
  proceeding_id: number;
  file_number: string;
  party_id: number;
  name: string;
  role: string;
  case_party_id: number | null;
  /** `offer`: case data holds another value for `field`, or none. `unlinked` / `not_of_record`: the
   * party holds values and is linked to no matter-data party of record, so nothing can be compared
   * until the confirm write links it. `unchecked`: case data could not be read, and `reason` says why. */
  kind: "offer" | "unlinked" | "not_of_record" | "unchecked";
  /** `offer` only: the field, case data's value (NULL when it holds none) and the value held here. */
  field?: CaseDataField;
  case_data_value?: string | null;
  held_value?: string;
  /** Every other kind: each value the party holds. */
  held?: Partial<Record<CaseDataField, string>>;
  reason?: string;
}

/** The five values a party row holds, trimmed, leaving out NULL and blank ones. */
function heldValues(p: Partial<Pick<PartyRow, CaseDataField>>): Partial<Record<CaseDataField, string>> {
  const held: Partial<Record<CaseDataField, string>> = {};
  for (const field of CASE_DATA_FIELDS) {
    const value = p[field];
    if (typeof value === "string" && value.trim() !== "") held[field] = value.trim();
  }
  return held;
}

/**
 * The counsel offer-back: every value a party row of the database holds in the five columns that
 * case data does not hold for the party it is linked to, compared trimmed, read through the same
 * matter-data read a drafting Writing uses. One row per party and field; one row per party holding
 * values that is unlinked, linked to a party not of record, or whose proceeding's case data cannot
 * be read. A proceeding none of whose parties holds a value is not read. Empty on a database the
 * columns are gone from (schema v43).
 */
export function counselOffers(dbPath: string, env: NodeJS.ProcessEnv = process.env): CounselOffer[] {
  const offers: CounselOffer[] = [];
  for (const proceeding of fetchAllProceedings(dbPath)) {
    const stored = fetchPartiesAsHeld(dbPath, proceeding.id);
    const held = new Map(stored.map((p) => [p.id, heldValues(p)]));
    if (![...held.values()].some((h) => Object.keys(h).length > 0)) continue;
    const { parties, drift } = draftingParties(dirname(dbPath), proceeding, stored, env);
    const drifted = new Map(drift.rows.map((r) => [r.party_id, r]));
    for (const p of parties) {
      const values = held.get(p.id) ?? {};
      if (Object.keys(values).length === 0) continue;
      const base = {
        proceeding_id: proceeding.id,
        file_number: (proceeding.file_number ?? "").trim(),
        party_id: p.id,
        name: p.name,
        role: p.role,
        case_party_id: p.case_party_id ?? null,
      };
      const d = drifted.get(p.id);
      if (d !== undefined) {
        offers.push({ ...base, kind: d.kind, held: values, ...(d.reason !== undefined ? { reason: d.reason } : {}) });
        continue;
      }
      for (const field of CASE_DATA_FIELDS) {
        const value = values[field];
        const caseValue = p[field];
        if (value !== undefined && (caseValue === null || caseValue.trim() !== value)) {
          offers.push({ ...base, kind: "offer", field, case_data_value: caseValue, held_value: value });
        }
      }
    }
  }
  return offers;
}

/** One mockup-only 🏷️ line per drifted party: rendered for the human, withheld from the forum. */
export function partiesDriftLines(rows: readonly PartiesDriftRow[]): string[] {
  return rows.map((r) => {
    const what =
      r.kind === "unlinked"
        ? "not linked to a party in case data, so no counsel or address for service is printed; confirm which party it is"
        : r.kind === "not_of_record"
          ? r.file_number === ""
            ? `linked to matter-data party ${r.case_party_id}, which case data does not hold; confirm the link`
            : `linked to matter-data party ${r.case_party_id}, which is not a party of record in ${r.file_number}; confirm the link`
          : `counsel and address for service not read from case data: ${r.reason}`;
    // 🏷️ *not recorded* (work-markers.md 1a): nothing usable is recorded until the row is confirmed
    // against the court record -- look up, not draft. It records no inventory entry, as the
    // unrecognized-template-key 🏷️ records none (render-requisition.ts).
    return mockupMessage(gapMarker("not_recorded"), `${r.name} (${r.role}): ${what}`);
  });
}

/** `markdown` with `lines` placed after its frontmatter, each its own paragraph. */
export function withLeadLines(markdown: string, lines: readonly string[]): string {
  if (lines.length === 0) return markdown;
  const block = lines.join("\n\n") + "\n\n";
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(markdown);
  return frontmatter ? frontmatter[0] + block + markdown.slice(frontmatter[0].length) : block + markdown;
}

/** `markdown` with the drift lines placed after its frontmatter, each its own paragraph. */
export function withPartiesDriftLines(markdown: string, rows: readonly PartiesDriftRow[]): string {
  return withLeadLines(markdown, partiesDriftLines(rows));
}
