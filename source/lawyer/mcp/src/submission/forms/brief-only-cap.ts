// The brief-only cap, named once (#855). A statement of law that does not count as support ('lead',
// or 'failed' since schema v46: the research lawyer's negative return), resting on a killed
// authority (`authorities.killed_on` set, schema v16) or on an overruled one
// (`authorities.treatment = 'overruled'`, #842) prints on no venue face and is
// withheld from the forum. What the cap means is settled by #842 and #850 (work-markers.md §4,
// terms-and-symbols.md -> Rendering); this module only names it.
//
// 'settled' (schema v47) is counsel's confirmed close over a failed finding (spec R3/R4): counsel
// read the finding and the source and confirmed the statement over it. It counts as support and
// passes the cap by counsel's call, not as unverified material reaching the forum -- the filed-face
// exception the spec states deliberately. It is never 'verified': nothing here reads it as the
// research lawyer's pass.

/** The three statement-of-law fields the cap reads. */
export interface BriefOnlyCapRow {
  verification: string | null;
  authority_killed_on: string | null;
  treatment: string | null;
}

// The atomic checks, exported separately because submission-paragraphs.ts reads its
// intermediate steps (`live`, `counted`) for its own marker logic.
export const authorityNotKilled = (s: Pick<BriefOnlyCapRow, "authority_killed_on">): boolean => s.authority_killed_on === null;
export const authorityNotOverruled = (s: Pick<BriefOnlyCapRow, "treatment">): boolean => s.treatment !== "overruled";
/** The research lawyer's pass ('verified') or counsel's confirmed close over a finding ('settled',
 * schema v47): either counts as support. Named for what it admits, so no reader takes a settled
 * statement for a verified one. */
export const countsAsSupport = (s: Pick<BriefOnlyCapRow, "verification">): boolean => s.verification === "verified" || s.verification === "settled";
/** A failed statement counts toward nothing read across statements, as a killed or overruled
 * authority's statements do (schema v46). */
export const notFailed = (s: Pick<BriefOnlyCapRow, "verification">): boolean => s.verification !== "failed";

/** True when the statement may reach the filed face. */
export const passesBriefOnlyCap = (s: BriefOnlyCapRow): boolean => countsAsSupport(s) && authorityNotKilled(s) && authorityNotOverruled(s);

/** The same cap as a WHERE fragment, for a query joining `statements_of_law sl` to `authorities a`.
 * `IS NOT`, not `<>` -- in SQLite `NULL <> 'overruled'` is NULL, which would drop every authority
 * not yet noted up. `sl.verification` is NOT NULL in the schema, so `IN` there is exact. */
export const BRIEF_ONLY_CAP_SQL = "(a.killed_on IS NULL AND a.treatment IS NOT 'overruled' AND sl.verification IN ('verified', 'settled'))";
