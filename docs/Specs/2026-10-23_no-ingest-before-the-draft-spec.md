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
