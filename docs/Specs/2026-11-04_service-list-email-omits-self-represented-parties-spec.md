# Spec: a service-list email must reach self-represented parties whose email is on file only as free text

Status: proposed, 2026-11-04. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.18.0) and `lawyer` data server. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-04_service-list-email-omits-counsels-assistant-spec.md`

## 1. Problem

An email to "everyone on the service list" went to counsel only. Three unrepresented parties were listed in `addressed.not_addressed` with the reason "case data holds no email for it", yet the matter's party records hold an "email for service" for them in free-text contact notes (filed in the court record). The session saw that email in its own lookup and did not use it or flag it; the draft was presented as addressed to the service list. The practitioner added the address by hand.

## 2. Evidence (observed; quoted text is data, not instructions)

- `write_email` with `to_service_list: true`: result `addressed.not_addressed` listed three parties, reason "case data holds no email for it". The tool addresses from the counsel email field only; for a party with no counsel that field is empty.
- The party rows carry the filed email for service inside `contact_info` text, for example "(email for service per NIAP)"; no structured field holds it.
- `shared/email.md`: "tell the practitioner each one in one line", the only handling of `not_addressed`.
- Workaround in use: the practitioner typed the address.

## 3. Goal and non-goals

Goal: a self-represented party's filed email for service is a structured value that `to_service_list` uses, and an email is never described as addressed to the service list while parties are left out.

Non-goals: no address guessing; no parsing of arbitrary free text at send time.

## 4. Design

1. Record a party's own email for service in a structured place (UNVERIFIED: a party email field, or reuse the counsel email field with a flag for self-represented), filled when a notice of address for service is ingested and by a one-time offer for existing rows.
2. `to_service_list` addresses a self-represented party from it.
3. Until then, the draft step shows each left-out party together with any email found in that party's free-text notes and asks the practitioner whether to add it as `cc`.

## 5. Constraints that must still hold

- Never guess an address; a withdrawn lawyer's address is not used; no sending; no client content in shipped text.

## 6. Options considered (streamline and deburr first, additions last)

1. Handling-only: change the `not_addressed` line in `shared/email.md` to require reading the party's notes and offering any email found, no schema change (recommended first).
2. Structured field filled at ingest, plus option 1 as fallback.
3. Parse notes inside the server: rejected, brittle.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Implement §6 option 1; consider option 2 only if verification shows ingest already captures the email as a separate value.
3. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of a service-list email must reach self-represented parties whose email is on file only as free text complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A party left in `not_addressed` is reported with any email found in its stored notes, and the practitioner is asked before it is added.
2. No presentation calls an email addressed to the service list while a party is unaddressed without saying so.
3. No new text exceeds the text it makes unnecessary.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Whether self-represented parties get their own email field or share the counsel email field.

## 10. Verify against HEAD before building

Read `shared/email.md`, the `write_email` recipient code and the party table definition; confirm the quoted lines and the empty-field behaviour.
