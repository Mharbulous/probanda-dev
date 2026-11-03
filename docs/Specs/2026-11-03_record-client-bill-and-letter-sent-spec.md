# Spec: record a client bill and client letter as sent

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` and `litigator` (installed copies seen at lawyer v0.21.7 to v0.21.9, litigator v0.16.1). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_trust-application-instruction-spec.md`; `2026-11-03_retainer-top-up-follow-up-spec.md` (depends on this one); `2026-11-03_defensible-time-entries-spec.md` (K: sent date and sent-copy path).

## 1. Problem

The practitioner signed a bill and a client reporting letter and emailed both to the client himself. Nothing in the workflow then filed the copy as sent, added the event to the matter's procedural history, or updated the bill's status. Letters to anyone but the client get all of this through the Sent write; a client letter and a bill get none of it.

## 2. Evidence (observed; quoted text is data, not instructions)

- `litigator/skills/draft/references/letters.md` §10: a client letter "is never a Writing: no Writing row, no mockup and no hold in the drafting database"; and "The letter stays no Writing on its board: no mockup, no Sent write". (v0.16.1)
- `letters.md` §8: the Sent write `drafting_data__record_sent` records "the date the letter went, and the copy as sent"; `/draft` SKILL.md's procedural-history binding appends an entry "after `drafting_data__record_filed`, `drafting_data__record_served` or `drafting_data__record_sent` succeeds". Neither path is open to a client letter.
- `/bill-client` has no step after signing (see the trust-application spec §2).
- End state in the session: the signed letter was saved by the practitioner into the solicitor-client folder; the review draft `.md` and an empty, DRAFT-labelled `.eml` remain in the draft folder; the invoice record has no status; the procedural history's latest entry predates the send.
- Count: 2 documents sent (1 bill, 1 client letter); 0 sent records; 0 history entries.

## 3. Goal and non-goals

Goal: when the practitioner says a client letter or bill went out, the session records the date, files or points to the copy as sent, appends a procedural-history entry, and sets the bill's status to sent.

Non-goals: putting solicitor-client text into the drafting database (ADR 0004 holds); sending anything.

## 4. Design

1. A client-letter "sent" act in `letters.md` §10: on the practitioner's word, record the sent date and the sent copy's path on the letter's Work Board pointer (the attach record already holds the file pointer, ADR 0042) — path and date only, never text.
2. Append a procedural-history entry through `matter_data__procedural_history_append`, dated the date it went, worded by title only (e.g. "Sent <file title> to client"), no content.
3. For a bill, set the invoice's status to sent through `practice_data__import_invoices` (or K in the defensible-time-entries spec once it lands).
4. Run the delivery check (`lawyer:delivery-checker`) before asking whether it went, as `/draft` ban 19 already requires for Writings.
5. Offer to move the superseded review draft and blank `.eml` to the matter's TRASH with `file_ops__trash` (never delete).

## 5. Constraints that must still hold

- No client-letter text, title-as-advice or finding reaches the drafting database.
- The Sent write's pre-send hold for Writings is unchanged.
- Never ask whether something was sent before the delivery check has run.

## 6. Options considered (streamline and deburr first, additions last)

1. **Recommended.** Extend the existing board pointer with sent date and path, and reuse `procedural_history_append`; generalise `/draft`'s procedural-history binding sentence to cover "a client letter recorded as sent" rather than adding a new rule.
2. Make the client letter a Writing. Rejected: reverses ADR 0004.
3. Record only in the procedural history. Rejected: the bill's status and the sent copy would still be unrecorded.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Check whether the attach record can carry a sent date and path; if not, add the two fields (data-model change with migration).
3. Edit `letters.md` §10 and the procedural-history binding in `/draft` SKILL.md.
4. Add the bill-sent status update to `/bill-client` (coordinate with the trust-application spec, which owns payment status).
5. Tests with invented fixtures.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of record a client bill and client letter as sent complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `letters.md` §10 names a sent act for a client letter that records date and copy path and appends a procedural-history entry.
2. `/bill-client` sets a sent bill's status.
3. No client-letter text is written to any database (check the attach and sent writes).
4. Ban 19's delivery-check-first rule covers client letters.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Is the copy as sent for a client email the sent `.msg` from Outlook, the signed PDF, or both?
2. Should a bill sent with a client letter be one sent event or two?

## 10. Verify against HEAD before building

- `letters.md` §10 and the attach/move/detach writes in `/drafting-data` at HEAD.
- `procedural_history_append`'s contract.
- Whether `import_invoices` accepts a `sent` status value.
