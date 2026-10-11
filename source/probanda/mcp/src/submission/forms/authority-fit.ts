// Cheap mechanical checks of an authority's fit to its proposition (schema v61,
// planning/1. Design/2026-10-06_authority-fit-checks-spec.md). They rate nothing and state no law:
// 🕰️ is an event that tells counsel to look, and the quoting tag says whose words an excerpt is.

/** The first four-digit year (1800-2099) in a citation: a neutral citation's year ("2011 BCCA 1"),
 * a reporter's ("[1981] AC 909"), or an enactment's ("SBC 2020, c 1", "BC Reg 168/2009"). Null
 * when the citation holds none. */
export function citationYear(citation: string | null): number | null {
  const m = citation === null ? null : /(?<!\d)(1[89]\d{2}|20\d{2})(?!\d)/.exec(citation);
  return m === null ? null : Number(m[1]);
}

/** Field and record separators of the linked-provisions column (query.ts linkedProvisionsColumn). */
export const PROVISION_FIELD_SEP = "\u001f";
export const PROVISION_RECORD_SEP = "\u001e";

/** One provision cited for the same proposition: its authority's citation and, when the currency
 * check recorded one, the date it came into force (provision_currency.in_force_on). */
export interface LinkedProvision {
  citation: string | null;
  in_force_on: string | null;
}

/** Parses the linked-provisions column: records of `in_force_on<US>citation`, joined by RS. A row
 * read without the column (undefined) has none. */
export function parseLinkedProvisions(column: string | null | undefined): LinkedProvision[] {
  if (!column) return [];
  return column.split(PROVISION_RECORD_SEP).map((rec) => {
    const [inForce = "", citation = ""] = rec.split(PROVISION_FIELD_SEP);
    return { citation: citation === "" ? null : citation, in_force_on: inForce === "" ? null : inForce };
  });
}

/** A provision's year: its recorded in-force date's year, else the year in its citation. */
function provisionYear(p: LinkedProvision): number | null {
  return p.in_force_on !== null ? citationYear(p.in_force_on) : citationYear(p.citation);
}

/** The first provision cited for the same proposition that came into force in a later year than the
 * case was decided, or null. Only a case's statement is tested; an unknown year on either side
 * tests nothing, and the same year is not "before". */
export function predatedProvision(row: { authority_kind: string | null; authority_citation: string | null }, provisions: readonly LinkedProvision[]): LinkedProvision | null {
  if (row.authority_kind !== "case") return null;
  const decided = citationYear(row.authority_citation);
  if (decided === null) return null;
  return provisions.find((p) => {
    const year = provisionYear(p);
    return year !== null && year > decided;
  }) ?? null;
}
