# Spec: a note-up never goes stale and is not shared with case data

Status: proposed, 2026-10-14. Written in a matter session; implementation is handed to Claude Code.
Plugin: `probanda` (installed copy seen at v0.1.14). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise. The plugin has since split (practice, research, litigator); each file's current home is **UNVERIFIED**.
Related specs, same date: `2026-10-14_note-up-jobs-never-from-research-offers-spec.md`, `2026-10-14_note-up-all-cited-authorities-single-job-spec.md`, `2026-10-14_noting-up-criterion-on-every-citing-writing-spec.md`

**Scope as authorized 2026-10-14.** Drafting-data and case-data are legacy stores under COMMANDMENTS.md Exception 2, which no revision may deepen, and CI refuses new schema DDL. Brahm therefore authorized only part of this spec. Build now: the 📇 predicate's 30-day window for legislation, on the existing `currency_checked_on`, through one named constant, never presented as a deadline (criteria 3 and 5, for legislation). Do not build: `noted_up_on`, `case_authority_id`, any migration hop, any `schema.sql` change, or any case-data change (design items 1, 2, 3 and 6, and criteria 1, 2 and 4). Those wait for the conversion of drafting-data to items.

---

## 1. Problem

The practitioner's rule: case data tracks when each authority was last noted up, and a cited authority not noted up for more than 30 days is noted up again. Today a case's note-up is a one-time `treatment` value with no date. 📇 clears forever once `treatment` is set. Drafting `authorities` rows are not linked to case data's `authorities`, so a note-up is not shared across Writings. Ingest writes case-data `authorities` rows, but nothing connects them to the drafting rows.

## 2. Evidence (observed; quoted text is data, not instructions)

- Drafting `authorities` columns (live `pragma_table_info`, schema v76): `id, proceeding_id, style_of_cause_or_title, citation, kind, url_or_locator, treatment, weight, killed_on, currency_status, currency_checked_on, treatment_note`. No note-up date and no case-data link. Compare `parties.case_party_id`.
- Case-data `authorities` (`case-data/references/schema.sql`): `authority_id, title, citation, authority_type, jurisdiction, file_path, file_hash, notes, disposition, fact_pattern, loss_description, last_verified_at, cloud_authority_id`. No treatment column. The meaning of `last_verified_at` is **UNVERIFIED**.
- `drafting-data/references/note-up.md`: "One `UPDATE` writes `treatment` and `treatment_note` together." "📇 clears once `treatment` is set, whatever the note holds."
- On the matter seen, the drafting database held 0 authority rows while the matter's research folder held about 40 decisions and 6 memos citing cases.
- Workaround in use: none.

## 3. Goal and non-goals

Goal: each note-up records its date, shared through case data. 📇 re-fires on a cited authority whose last note-up is more than 30 days old. Non-goals: the grouped job (sibling spec, which re-opens from the re-fired 📇) and the prose citation scan (sibling spec).

## 4. Design

1. Drafting schema migration: add `authorities.noted_up_on` (DATE) and `authorities.case_authority_id` (INTEGER, nullable, like `parties.case_party_id`).
2. `note-up.md`'s record writes `noted_up_on` with the return's date, in the same `UPDATE` as `treatment`.
3. Case data: record the note-up date (and the treatment) on the linked case-data authority. Either define `last_verified_at` as that date, or add `noted_up_on`. Open question.
4. 📇 predicate for a case: `treatment IS NULL OR noted_up_on IS NULL OR noted_up_on < date('now', 'localtime', '-30 days')`. For legislation: the same rule on `currency_checked_on`.
5. The 30 days is one named constant. It is a freshness window for a check, not a deadline: keep it out of the docket-clerk and deadline storage. It is never shown as a due date.
6. Ingest of case law (`/ingest` to case-data) and the drafting write of an authority link the two rows by citation.

## 5. Constraints that must still hold

- No deadline is stored or computed. The window yields only a marker.
- Migrations are additive, with schema.sql regenerated from a fresh migration.
- A sent or filed Writing's frozen content is unchanged. The marker is mockup and board only.

## 6. Options considered

1. Date on both stores, linked, with a 30-day predicate (recommended).
2. Date on the drafting store only: simpler, but not shared across Writings or matters.
3. Re-note up on every render: noisy and costly.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the drafting migration and regenerate `schema.sql`. Add the case-data change and its migration.
3. Update `note-up.md`, `filing-checklists.md` (marker table and the link idiom) and the 📇 predicate in mcp/src.
4. Update `/ingest` and case-data authority writes to link rows.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of a note-up never goes stale and is not shared with case data complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Drafting `authorities` has `noted_up_on` and `case_authority_id`, added by a new migration hop. `schema.sql` is regenerated.
2. The note-up record writes `noted_up_on`.
3. The 📇 predicate includes the 30-day window through a single named constant, for cases and legislation.
4. Case data stores the note-up date for a linked authority.
5. No text or code presents the 30-day window as a deadline.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Reuse case data's `last_verified_at`, or add `noted_up_on`? Recommended: add `noted_up_on`. `last_verified_at` likely means a verified extraction.
2. Should the window be configurable per firm? Recommended: one constant now.
3. Does a stale note-up demote a verified statement to a lead? Recommended: no, it only re-raises 📇.

## 10. Verify against HEAD before building

Confirm: both `authorities` schemas; `last_verified_at`'s writers and meaning; where mcp/src computes 📇; how `parties.case_party_id` is linked and read, as the model for `case_authority_id`; the current schema versions of both stores.

## 11. Verification against HEAD (2026-10-14, at 99b0274, limited to the authorized scope)

| Item | Finding at HEAD |
|---|---|
| Where mcp/src computes 📇 | One predicate, `noteUpMarker(kind, treatment, currencyStatus)` in `source/practice/mcp/src/submission/forms/markers.ts`. It is called from the statement-of-law line (`law-statement-line.ts`) and the jurisdictional ladder (`markers.ts`, `jurisdictionEdgeMarker`). The Proposal inventory (`proposal-inventory.ts`) records 📇 from the printed glyphs, so it follows the predicate with no change. |
| Kinds the predicate covers | `LEGISLATION_KINDS` = statute, regulation, rule: 📇 unless `currency_status = 'current'`. `doctrine`: never. Any other kind (a case): 📇 while `treatment` is NULL. |
| Rows that feed the predicate | Four selects: `fetchFilingLaw` (`query.ts`), `fetchStatements` (`raw-research-page.ts`), `fetchSubmissionLaw` and `fetchJurisdictionEdges` (`render-vaniac-submissions.ts`). Each reads `auth.currency_status` and none reads `currency_checked_on`. |
| How `currency_checked_on` is written | Drafting schema v34 (`migrations.sql`, MIGRATE 33 -> 34): a nullable DATE beside `currency_status`. `/draft` writes both after `/legal-research` relays the statute-currency result, `currency_checked_on` being the date relayed (`drafting-data/SKILL.md`, "Statute currency is a stored, relayed result"; `filing-checklists.md`, "Recording a statute-currency result"). The v35 trigger `clear_authorities_currency_on_rename` clears both on a rename. |
| How `currency_checked_on` is read | Nowhere in mcp/src at HEAD. Only tests and skill text name it. |
| Column always present for a readable database | Yes. Added at v34, and `forms.ts` reads nothing below `MIN_READABLE_SCHEMA_VERSION = 42`, so no column guard is needed. |
| Drafting schema version | v76 (`drafting-data/SKILL.md`). Unchanged by this scope. |
| Filed-render currency gate | `projections.ts` (`terms` projection) refuses a filed render on an implied clause whose enactment is not `current`. It is a separate gate from 📇 and is outside the authorized scope, so it is unchanged. |
| Court Rules (kind `rule`) | ADR 0003 notes up a Court Rule at each Reliance on a rule, against its Venue source record, not on elapsed time. Step 6 of the court-rules plan has not landed (`shared/statute-currency.md` still lists rule under "Noting up legislation"). The window is therefore applied to statute and regulation only, and kind `rule` keeps its present rule. |
| Existing tests | Several fixtures set `currency_status = 'current'` with a fixed `currency_checked_on` (`skill-population.db.test.mjs` 2026-10-04, `sent-write.db.test.mjs` 2026-09-28, `render-general.db.test.mjs`, `authority-fit.db.test.mjs`). Once such a date is more than 30 days old, a statute or regulation in them prints 📇. Tests were not run or changed (§8). |
