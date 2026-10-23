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

## 11. Verification against the repo

Paths are repo paths: the installed `litigator/skills/<x>` is `.claude/skills/<x>`, and the data server's source is `source/lawyer/mcp/src`. Line numbers in `draft-harness.ts` are those of the committed file (HEAD 20ccaa58).

| Claim | Finding (file:line) | Result |
|---|---|---|
| write_email takes only typed address strings | `source/lawyer/mcp/src/submission/draft-harness.ts:63-64` reads `to` (at least one) and `cc` as string lists and nothing else; the tool description says "to (at least one) and cc are address strings" (`source/lawyer/mcp/src/schema-gen.ts:2924`); `.claude/skills/shared/email.md:10` says "Take them from `/matter-data` or `/drafting-data`, or as the practitioner gives them". The step opens no database (`draft-harness.ts:11`). | confirmed |
| write_email refuses an empty body | `draft-harness.ts:62` calls `requireString(args, "body")`, which refuses a missing or `""` value with "drafting_forms__draft_harness.body is required for step write_email" (`:100-106`, message at `:103`), the error quoted in §2. The script itself accepts `""`: `.claude/skills/draft/scripts/write_eml.py:269` checks only that `body` is a string, and `repeats_signoff` (`:243`) is false for an empty body. So the fix is in `draft-harness.ts` alone. | confirmed |
| How the general renderer reads counsel email from case data | `source/lawyer/mcp/src/submission/forms/render-general.ts:222` calls `mergeSharedRecipients(fetchFilingRecipients(...))`. `forms/query.ts:349` gives a party-linked row the party's `counsel_name` (else its own name), `counsel_email` and `address_for_service`. The party rows come from `draftingParties` (`submission/parties-drift.ts:74`), read live through `case/parties-of-record.ts:59`, which runs `.claude/skills/matter-data/references/scripts/parties_of_record.py` mapping matter-data `lawyer_email` to `counsel_email` (`:47`), a per-proceeding override first. A party whose read drifts holds NULL counsel (`parties-drift.ts:62-66`). | confirmed |
| A proceeding-level service list exists to read | `recipients` is proceeding-scoped, the service list, with `forum_default = 1` for every service-list entry (`.claude/skills/drafting-data/references/filing-checklists.md:452`). The forum default idiom takes those rows less any client-side party (`:458-466`). Only a filing-level resolver exists (`forms/query.ts:321`, `fetchFilingRecipients`); a proceeding-level one must be added. | confirmed |
| Counsel emails are stored as one semicolon-separated string with no role per address | One TEXT field: matter-data `parties.lawyer_email` ("counsel email; NULL = none of record", `.claude/skills/matter-data/references/schema.sql:264`) and its per-proceeding override `proceeding_parties.lawyer_email` (`:282`). No role per address is stored, and no skill text, script or test in `.claude/skills/matter-data/` states a separator or an order convention (grep for "semicolon" and "assistant" finds none). The "first address is the lawyer" convention cannot be confirmed, so §4's fallback applies: the first address in To, the rest in Cc, said in the tool description. | confirmed (one string); convention unconfirmed |
| A withdrawn counsel yields no address | `.claude/skills/matter-data/operations/order-effects.md:84`: a withdrawn lawyer's fields are set NULL, never an empty string, so `counsel_email` reads NULL and yields no address. | confirmed |
| The firm profile holds an always-copy list | It does not. `FirmProfile` (`source/lawyer/mcp/src/tools/practice/firm-profile.ts:62-71`) holds firm_name, roster, letterhead, person, practice_quirks and idle_flag_hours; upsert takes those inputs only (`:268`). firm.json is a JSON file, not a database (`:1-5`), so a new optional field is an additive, patch-safe change with no migration: an older copy ignores it and keeps it on upsert (`:287`). | confirmed (absent) |
| write_eml.py can write Bcc | It cannot: it writes To and Cc only (`write_eml.py:324-325`). A `filing_id` source whose Writing has `'bcc'` rows needs a decision (refuse, or report them unwritten). | noted |
