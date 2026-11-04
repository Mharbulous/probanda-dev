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
