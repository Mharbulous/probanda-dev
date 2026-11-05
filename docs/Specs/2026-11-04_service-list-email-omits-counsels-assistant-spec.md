# Spec: a service-list email must copy the assistant that opposing counsel has asked to be copied

Status: proposed, 2026-11-04. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.18.0) and `lawyer` data server. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-04_service-list-email-omits-self-represented-parties-spec.md`

## 1. Problem

An email to "everyone on the service list" was written as an unsent draft with `to_service_list: true`. Opposing counsel's assistant, whom that counsel had asked in earlier emails (more than once, "I ask you again") to copy on every communication, was left off. Nothing in the route knew about the request, so neither the draft nor the practitioner's review surface mentioned it. The practitioner noticed after sending. The session's closing note also wrongly said the tool could not add her; `write_email` takes `cc`.

## 2. Evidence (observed; quoted text is data, not instructions)

- Tool `drafting_forms__draft_harness`, step `write_email`: "Case data holds each lawyer's email as one value that may list several addresses ... with no role per address, so the first address goes in To and the rest (a paralegal, an assistant) in Cc". The result's `addressed.cc` held only the firm's own cc person.
- The assistant's address is not in case data. It appears in the mailbox: she is on the cc line of counsel's replies, and the drafting agent's report to the session flagged "The caller should add her to the email's recipients" as open item 2.
- `/draft` SKILL.md, "An email request writes the `.eml` first", step 4, names no check for a counsel's stated copying request; `shared/email.md` says only "`cc` adds address strings in every case".
- Workaround in use: the practitioner added the address by hand (in this instance, not at all before sending).

## 3. Goal and non-goals

Goal: an email addressed from the service list copies each counsel's recorded standing cc, and the session never presents such an email without having looked for one.

Non-goals: no change to the firm's own cc list; no guessing of addresses; no sending.

## 4. Design

1. Give a counsel's standing cc a home in case data that `to_service_list` already reads (UNVERIFIED: a field on the party row, or a practice-data contact affiliation), recorded when counsel's request is found or the practitioner states it.
2. In `/draft`'s email step and `shared/email.md`, before `write_email` on a service-list or counsel email, one search of the matter mail for the counsel's copying request when none is recorded; any hit is shown to the practitioner and, on their word, recorded and passed in `cc`.
3. The presentation line names every cc added and every counsel whose assistant is unknown.

## 5. Constraints that must still hold

- Never guess an address; never send mail; the firm's `cc_on_counsel_email` rule unchanged; no client content in shipped text.

## 6. Options considered (streamline and deburr first, additions last)

1. One sentence in `shared/email.md` requiring the mailbox look and a `cc` pass, no schema change (recommended as the first step; cheapest).
2. Option 1 plus a stored standing-cc so the look happens once per matter.
3. Server infers from mail by itself: rejected, it reads correspondence in a data tool.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Make the §6 option 1 text change; add option 2 only if verification shows a stored home is already cheap.
3. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of a service-list email must copy the assistant that opposing counsel has asked to be copied complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `shared/email.md` or `/draft`'s email step requires looking for a counsel's copying request before a service-list email is written, and passing it as `cc`.
2. The presented draft names each added cc.
3. No new text exceeds the text it makes unnecessary.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Whether a stored standing cc belongs on the party row or on practice contacts.

## 10. Verify against HEAD before building

Read `shared/email.md`, `/draft` SKILL.md's email section and the `write_email` source; confirm the `cc` parameter and the quoted lines above still exist.

### Verification at HEAD, 2026-11-04 (commit 0f75fda4)

| Item | Result | Where |
|---|---|---|
| `write_email` takes `cc`, also with `to_service_list` | Confirmed. It is added after the addresses read from case data | `source/lawyer/mcp/src/schema/submission-forms.ts:836`, `source/lawyer/mcp/src/submission/draft-harness.ts:156` |
| Quoted line "Case data holds each lawyer's email as one value..." | Confirmed, with "(split on ; and ,)" after "several addresses" | `submission-forms.ts:777-779` |
| `addressed.cc` holds the firm's cc people and any later addresses in counsel's value | Confirmed | `source/lawyer/mcp/src/submission/email-recipients.ts:76-78,137-147` |
| `/draft` step 4 names no check for a copying request | Confirmed | `.claude/skills/draft/SKILL.md:103` |
| `shared/email.md`: "`cc` adds address strings in every case" | Confirmed, and it is the file's only word on such a request | `.claude/skills/shared/email.md:17` |
| A session can search mail for the request | Confirmed. `mail__search_emails` takes `from` and `body`, and returns each message's `cc` with no body by default. No hook's matcher covers the mail read tools, and each is marked read-only | `source/lawyer/mcp/src/schema/mail.ts:24,123-148`, `source/lawyer/plugin.json`, `source/litigator/plugin.json` |
| A second `write_email` with the same body passes the review gate | Confirmed. The gate tests the body only, and `cc` does not enter it | `source/litigator/hooks/correspondence-review-gate.py:97-105` |
| Case data's reader needs no change | Confirmed. Out of scope | `email-recipients.ts` |

**Option 2 is not cheap, so it is left out, and section 9's question does not arise.** The one home `to_service_list` already reads is counsel's email value (`parties.lawyer_email`). A later address there would reach Cc with no code change, but the court forms print the same value as counsel's email (`source/lawyer/mcp/src/submission/forms/emit-bcca-factum.ts:214`, `render-bcca-factum.ts:311`, `.claude/skills/matter-data/references/design-decisions.md:1036`), so an assistant's address would be printed on filings. `to_service_list` does not read practice contacts. Any other home is new schema and new reading code.

**The look runs after the first `write_email`, not before it.** Section 4 assumed the session knows each counsel's address first. On the fast path it does not: `to_service_list` exists so that no address passes through the model, /draft loads no case-data read before the `.eml`, and the case-data reader `list_parties.py` has no model-facing tool. The result's `addressed.to` is the exact list. The order is `write_email`, look, present, then on the practitioner's word the next " vN" with `cc`. No version carries the address before that word, whichever comes first, so the goal in section 3 holds. Criterion 1's "before a service-list email is written" holds for the version that carries `cc`, not for the first version.
