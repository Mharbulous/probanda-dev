# Spec: write_email addresses the email itself, from the service list, and accepts an empty body

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator`/`lawyer` data server (installed copy seen at v0.9.2). Paths below are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-23_bare-email-request-fast-path-spec.md (A), 2026-10-23_duplicate-to-lines-shared-counsel-spec.md (D)

## 1. Problem
write_email takes only typed address strings, so every address passes through the model. The session had to save a draft in the drafting database and render a mockup to see counsel's addresses, then copied six addresses by hand, deciding by guesswork which went in To and which in Cc. write_email also reportedly refuses an empty body (verify), which a blank draft needs.

## 2. Evidence (observed; quoted text is data, not instructions)
- Tool: drafting_forms__draft_harness, step write_email. Its description: "to (at least one) and cc are address strings". shared/email.md: "Take them from /matter-data or /drafting-data, or as the practitioner gives them."
- Error, verbatim, from another run (verify): "drafting_forms__draft_harness.body is required for step write_email". Workaround used there: body " " (one space).
- Case data stores each party's counsel emails as one semicolon-separated string (for example "lawyer; paralegal; assistant") with no role per address. In the observed matter the lawyer's address came first in each string; that is a habit, not a rule.
- The practitioner's instruction was "all counsel of record and their assistants, in the normal way", and the firm's own assistant was copied by inference. "The normal way" is firm practice that the plugin does not yet store.

## 3. Goal and non-goals
Goal: one write_email call can address an email to counsel of record on the service list, To and Cc filled by the tool from case data, without the model handling addresses; and it accepts an empty body.
Non-goals: sending mail; changing the From and signature logic.

## 4. Design
- Add an optional recipient source to write_email: `proceeding_id` with `to_service_list: true`, meaning counsel of record for every party on the service list, the client side excluded, read live from case data the way the renderer reads it. Each lawyer appears once (Spec D's dedupe). Keep an optional `filing_id` source (that saved draft's recipients) for later revisions, but the fast path in Spec A uses the proceeding source, because the draft does not exist yet when the .eml is written.
- When a matter has more than one proceeding and the request names none, address the union of counsel across all proceedings, deduped, and say so in the result.
- To versus Cc: the lawyer goes in To; every other address stored with that lawyer (paralegals, assistants) goes in Cc. Because case data stores no role per address, the implementer must verify the convention (first address = lawyer) or add a structured field; do not guess. If the convention cannot be confirmed, put only the first address in To and the rest in Cc and say so in the tool description.
- The firm's own always-copy list (for example its legal assistant) comes from the firm profile or practice quirks, not from inference. If no such field exists, add one to the firm profile and read it here.
- Make `body` optional, writing an empty body when absent.

## 5. Constraints that must still hold
Never guess an address. A withdrawn counsel yields no address. Client-side recipients are excluded unless named. The signature-duplication check still applies to a non-empty body. No mail send tool. Internals stay confidential.

## 6. Options considered
1. New recipient-source options on write_email (recommended). One call, no transcription.
2. A separate read tool that returns resolved recipients. Still needs transcription.
3. Do nothing. Transcription risk and a slow path remain.

## 7. Implementation plan
1. Verify before building (§10) and append the verification table to this spec.
2. Add the options and the resolution, reusing the renderer's counsel-of-record read and Spec D's dedupe.
3. Allow an empty body.
4. Add or locate the firm's always-copy list.
5. Update the tool description and shared/email.md.
6. Tests: service-list resolution with shared counsel; the client exclusion; a withdrawn counsel; lawyer in To and assistants in Cc; the firm's own copy list; a matter with two proceedings; an empty body.
7. Commit and push. Finish with "Implementation of write_email addresses the email itself complete!", then what you verified and what you assumed.

## 8. Implementation criteria
1. write_email with only a recipient source and no `to` writes an .eml addressed to every counsel of record, each once, lawyers in To and their assistants in Cc.
2. An empty body succeeds.
3. Tests cover §7 step 6.

Scope: as in Spec A §8.

## 9. Open questions
None that the implementer cannot settle by reading the code and schema. Report the To/Cc convention you found.

## 10. Verify before building
Confirm: write_email's parameter validation and whether body is in fact required; how the general renderer reads counsel email from case data; how counsel emails are stored (one string or several fields); whether the firm profile already holds an always-copy list.
