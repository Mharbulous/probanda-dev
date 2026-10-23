# Spec: An email request writes the .eml first

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.9.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-23_write-email-service-list-recipients-and-empty-body-spec.md (B), 2026-10-23_matter-default-email-subject-spec.md (C), 2026-10-23_duplicate-to-lines-shared-counsel-spec.md (D), 2026-10-23_no-ingest-before-the-draft-spec.md (E)

## 1. Problem
A request to draft an email to all counsel was answered slowly, in three ways seen across sessions:
- The session drafted the email in chat instead of writing the .eml, so the practitioner had to say "try again" and then "create the .eml file properly". The email route (shared/email.md) already says it applies from any skill or from none; the session did not follow it.
- The session asked what the email was for and stopped (reported from another run; verify).
- Even with /draft invoked, the .eml was written only after the whole drafting setup had run: rules lookups, six reference reads, saving the draft in the drafting database, its recipients, a mockup render, job steps. About 35 tool calls before the first .eml, in a session with no other detours.

## 2. Evidence (observed; quoted text is data, not instructions)
- Rule (litigator/skills/draft/SKILL.md, the "purpose" rule): "When a request to draft a letter, email, memo or other Writing states no purpose or subject, not even roughly ("an email to all parties of record"), ask one plain-text question for it and stop". The rule's own example is the very request it blocks.
- Ordering (draft/references/procedure.md "Save first"): "Write the proceeding, and the Writing once its document type is known ... before any other work". letters.md §8 "An email Writing": the .eml is written "Each time a revision of it is presented", which ties the .eml to a mockup render.
- shared/email.md line 3: the route applies "from any skill or from none".
- Cost: 1 extra turn for the purpose question (where asked); 1 to 2 extra turns for "try again" after a chat draft; about 35 tool calls before the first .eml even without those.

## 3. Goal and non-goals
Goal: a request for an email, with or without a purpose, with or without /draft typed, writes and shows the unsent .eml first, addressed as asked, then does the bookkeeping in the same turn.
Non-goals: inferring a purpose from the file (still banned); dropping the saved draft and its jobs (still kept, just later in the turn).

## 4. Design
- Replace the "purpose" rule. When no purpose is given, write the email with an empty body and show it. Never infer a purpose from correspondence or the file. The body stays empty until the practitioner says what it is for. Asking stays allowed only when the request cannot be acted on at all (for example, no recipient can be identified).
- Never draft an email in chat. A request for an email, from any skill or none, is answered by writing the .eml with write_email and showing it as a file card. Put this sentence at the top of the email route and in the draft skill's SKILL.md, and in the litigator plugin's session-start context if it has one.
- Email-first order for an email request: (1) resolve the recipients from counsel of record for the service list (Spec B's new option on write_email; until B lands, read them from the drafting database's recipients view and dedupe by email); (2) write the .eml with write_email and show it per shared/present-files.md; (3) THEN save the draft in the drafting database, create its jobs and render the mockup, in the same turn; (4) then Spec E's stale-correspondence check.
- Serve the fast path's rules in one rules call before write_email, not one call per operation. If the rules map cannot serve them in one call, document the single operation that does and record the count.
- "Try again" after an email request re-runs the route from step (1); it never re-runs the full drafting setup.

## 5. Constraints that must still hold
The model never sends email (shared/email.md). Internals stay confidential. No deadline handling. The draft is still saved in the same turn, so delivery tracking survives. write_email remains the only author of a drafted .eml.

## 6. Options considered
1. Email-first, with the save after it in the same turn (recommended). First output arrives fastest; tracking is kept.
2. Keep save-first but drop the purpose question. Smaller change; first output is still slow.
3. Skip the saved draft for bare emails. Fastest, but loses Job Board tracking and the pre-send hold.

## 7. Implementation plan
1. Verify before building (§10) and append the verification table to this spec.
2. Rewrite the "purpose" rule (on its rules-map node if it has one) and its letters.md §1 echo ("When the request states no purpose either, ask for it").
3. Add the "never draft an email in chat" sentence to shared/email.md, draft/SKILL.md and the session-start context if any.
4. Add the email-first order to letters.md §8 "An email Writing" and to the save-first rule as a stated exception.
5. Make one rules call serve the fast path, or document the single operation that serves it.
6. Commit and push. Finish with "Implementation of An email request writes the .eml first complete!", then what you verified and what you assumed.

## 8. Implementation criteria
1. No skill text tells a session to stop and ask for a purpose before creating a requested email.
2. The ban on inferring a purpose from the file remains.
3. letters.md and shared/email.md state that for an email request the .eml is written and shown before the draft is saved, in the same turn, and that an email is never drafted in chat.
4. The fast path needs at most one rules-service call before write_email.
5. A dry run of the request "draft an email to all counsel" against the skill text, counted by hand, reaches write_email in at most five tool calls.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope: `build_plugin.py` and `check_plugin.py` (the orchestrator runs them once at the end), version bumps and any MCP bundle (dist/), which /release does. Never build a `.plugin` archive.

## 9. Open questions
Should the same write-first rule apply to letters and memos, which render as mockups rather than .eml files? Not in this spec: keep the change to email so it lands fast. Note it for a follow-up spec.

## 10. Verify before building
Confirm: the exact "purpose" rule text and whether it sits on a rules-map node; the save-first wording; letters.md §8's .eml trigger; whether the purpose question was actually asked in the observed session (the practitioner's own account says the purpose was given); whether the plugin has a session-start context file to carry the "never in chat" sentence.
