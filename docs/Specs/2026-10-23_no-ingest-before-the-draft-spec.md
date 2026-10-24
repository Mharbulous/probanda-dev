# Spec: Un-ingested correspondence never delays a requested draft

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugins: `litigator` (draft) and `lawyer` (ingest, matter-data). Paths below are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-23_bare-email-request-fast-path-spec.md (A), 2026-10-23_write-email-service-list-recipients-and-empty-body-spec.md (B)

## 1. Problem
This was the single largest delay in the observed session, and the original plan did not cover it. Before drafting the email, the session found nine correspondence and court-file items not yet in case data, stopped to ask whether to ingest them, and on "yes" spent most of the session ingesting them (nine documents, several reading agents, counsel-of-record updates, procedural-history entries). Only then did it draft the email. The ingest did matter: it showed that one party's counsel had changed. But the practitioner wanted the email first and the news second.

## 2. Evidence (observed)
- The question asked was, in effect, "ingest the nine un-ingested files first so the recipient list is current?" The practitioner answered yes because it was the only option offered that led to the email.
- The practitioner's standing rules: never stop work to ask about non-blocking issues; never ask what can be looked up; do what was asked before asking anything.
- matter-data already has a cheap coverage check (operation "ingest-coverage": is this folder fully ingested, with the newest ingested correspondence date) and an unattended ingest (operation "ingest-unattended").

## 3. Goal and non-goals
Goal: a draft request is never preceded by an ingest or by a question about one. The draft is written from counsel on file; then, in the same turn, one coverage check reports what is missing and offers the ingest.
Non-goals: making the ingest itself faster; changing what the ingest records.

## 4. Design
- In /draft (and the email route), the order is: write and show the draft; then run one coverage check on the correspondence and court-file folders; then, if files are missing from case data, say so in one line ("N correspondence files since <date> are not yet in the file; counsel may have changed; shall I bring them in?"). Ask nothing before the draft.
- If the practitioner says yes, run the unattended ingest, and when it changes counsel of record for any recipient, write the email again (write_email gives it the next " vN") and show the new version with a one-line note of what changed. Do not re-run the drafting setup.
- The practitioner decides whether to wait for the ingest, after seeing the draft, not before.

## 5. Constraints that must still hold
The model never sends email. An ingest still writes only through matter-data. Internals stay confidential. No deadline handling.

## 6. Options considered
1. Draft first, one coverage check after, ingest only on yes (recommended).
2. Draft first and never check coverage. Fastest, but the practitioner can send to withdrawn counsel without warning.
3. Check coverage first and draft only when current. This is the slow path observed.

## 7. Implementation plan
1. Verify before building (§10) and append the verification table to this spec.
2. Add the draft-first order and the single after-draft coverage check to the draft skill's procedure and letters.md §8, and to shared/email.md.
3. State in the draft skill that an ingest is never run, and never offered, before the requested draft is shown.
4. Add the re-write-as-next-version step after an ingest that changes counsel.
5. Commit and push. Finish with "Implementation of Un-ingested correspondence never delays a requested draft complete!", then what you verified and what you assumed.

## 8. Implementation criteria
1. No skill text lets a session run or offer an ingest before a requested draft is shown.
2. After the draft, at most one coverage call is made, and its result is reported in one line with an offer.
3. After an ingest that changes a recipient's counsel, the email is rewritten as the next version and shown, without re-running the drafting setup.

Scope: as in Spec A §8 (2026-10-23_bare-email-request-fast-path-spec.md).

## 9. Open questions
None.

## 10. Verify before building
Confirm the names and parameters of the coverage check and unattended ingest operations, and where in the draft skill text the current "check case data is current" step (if any) lives.

## 11. Verification against the repo

Paths are repo paths: the installed `litigator/skills/<x>` and `lawyer/skills/<x>` are `.claude/skills/<x>`, and the data server's source is `source/lawyer/mcp/src`.

| Claim | Finding (file:line) | Result |
|---|---|---|
| matter-data has a cheap coverage check, operation "ingest-coverage" | `.claude/skills/matter-data/operations/ingest-coverage.md:1`. Input (:13-17): `matter_root`, `matter_folder`, `folder_globs`, `correspondence_globs`. Output (:21-29): `to_ingest`, `records` (`{path, verdict, source_id, possible_version_of}`), `damaged`, `unreadable`, `folders`, `missing`, `newest_correspondence`. Read-only (:5). Run host-side by `.claude/skills/matter-data/references/scripts/ingest_coverage.py`. Routed from `.claude/skills/matter-data/SKILL.md:71`. | confirmed |
| matter-data has an unattended ingest, operation "ingest-unattended" | `.claude/skills/matter-data/operations/ingest-unattended.md:1`. Input (:15-17): `matter_root`, `matter_folder`, `files` (`{path, hash, folder_type, answer?}`, an explicit list, never a folder walk). Output per file (:23-31) with `outcome` and `pending`. | confirmed |
| After the unattended ingest, it may have changed counsel of record (§4) | Wrong. The unattended ingest never runs the order-effects pass: on a counsel-change notice it writes `ORDER-EFFECTS-PENDING` and stops there (`ingest-unattended.md:88`). Counsel of record changes only through `.claude/skills/matter-data/operations/order-effects.md` (:5, :21, :31), behind its approval gate. So on a yes the session runs the offer the coverage wording already makes (`/ingest` for each file, or `/matter-data`'s supersede of a pair: `.claude/skills/work/references/opening.md:33`), whose attended path runs the order-effects pass. The goal and §8's criteria are unchanged. | wrong (no design change) |
| Where the "check case data is current" step lives in the draft skill text | Three places, all before the draft: (1) `.claude/skills/draft/references/letters.md:41` (§1, "Ingestion check"), before a letter's first text; (2) `.claude/skills/work/references/procedure.md:67` (fast open, step 3) with `.claude/skills/work/references/opening.md:28-33`, which offers each ingest at session entry; (3) `.claude/skills/work/references/job-session.md:36-46` ("The input check", called from :9), which assigns nothing until the inputs are ingested, so no draft under a job starts. `.claude/skills/draft/SKILL.md:99` (Spec A) already puts any ingestion check after the `.eml`. No `/draft` rules-map node mentions ingest (`.claude/skills/draft/rules/` has no match). `.claude/skills/draft/references/unattended-run.md:7` gates an unattended run, which has no requested draft. | confirmed |
| Session entry's own coverage result | `source/lawyer/mcp/src/submission/open-session.ts:241-247, 422`: session entry runs the coverage itself, only for the opened Writing with a Ready job. A new letter or email is not that Writing, so its after-draft check is its own call. | confirmed |
| A rewrite after a counsel change needs no new setup | An email addressed with `to_service_list: true` or `filing_id` reads counsel from case data when written (`.claude/skills/shared/email.md:13-14`), so calling `write_email` again with the same arguments gives the next " vN" (:27). A letter's party recipients take counsel from case data at each render (`source/lawyer/mcp/src/submission/forms/query.ts:349`), so a re-render shows the new counsel. | confirmed |
| letters.md §8 is where the order goes | §8 "Sending" is `letters.md:126`, and "An email Writing" is :134. The ingestion check itself is in §1 (:41), so both are changed. | confirmed, with §1 added |
