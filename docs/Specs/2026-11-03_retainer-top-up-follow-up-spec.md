# Spec: retainer top-up request follow-up when a client letter is sent

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` and `litigator` (installed copies seen at lawyer v0.21.7 to v0.21.9, litigator v0.16.1). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_record-client-bill-and-letter-sent-spec.md` (this spec hooks onto its sent act; land that first); `2026-11-03_trust-application-instruction-spec.md`.

## 1. Problem

A client letter asked the client to replenish the retainer. When it was sent, nothing recorded the request as a retainer notice and nothing offered a reminder to check that the money arrived. The signed retainer agreement lets the firm stop work if a requested replenishment is not provided within a stated number of days of the request, so the request date matters and a follow-up is the natural next step.

## 2. Evidence (observed; quoted text is data, not instructions)

- `letters.md` §8, "The follow-up to-do": "When the Sent write succeeds and the letter's own text asks its recipient to respond by a date it states, offer once ... to add a to-do". It is tied to the Sent write, which a client letter never gets (§10), and to a stated date, which a replenishment request may not carry.
- Tool present in the session, unused: `practice_data__record_retainer_notice`. The `task-prioritization` skill description: "Re-ranks when a retainer notice is sent, a trust balance changes, or a deadline updates."
- The retainer agreement's text (read in the session): the firm reserves the right to cease work "if you fail to provide a requested retainer replenishment within 14 days of our request." The scrivener deliberately left this term out and flagged it; no date was computed.
- Count: 1 replenishment request sent; 0 retainer notices recorded; 0 reminders offered.

## 3. Goal and non-goals

Goal: when a client letter or email that requests a retainer replenishment is recorded as sent, record a retainer notice (amount requested, date sent, source letter) and offer once to add a follow-up to-do whose BF date the practitioner sets.

Non-goals: computing or suggesting any date or the number of days remaining (`shared/deadline-isolation.md`); deciding whether to stop work.

## 4. Design

1. In the client-letter sent act (record-sent spec §4.1), if the letter requests a retainer replenishment (the purpose given to the scrivener says so, or the practitioner says so), call `practice_data__record_retainer_notice`.
2. Generalise `letters.md` §8's follow-up to-do offer so it fires on any recorded send (Writing or client letter) whose text either states a response date or requests a replenishment; the practitioner states the BF date; hand to `/task-prioritization`'s add.
3. Never mention the agreement's day count as a date.

## 5. Constraints that must still hold

- Deadline isolation: no date computed, offset or suggested; the practitioner gives the BF date.
- One offer per letter; a no is never re-asked.

## 6. Options considered (streamline and deburr first, additions last)

1. **Recommended.** Widen §8's existing follow-up sentence to "any recorded send" and add the retainer-notice call there; no new section.
2. A separate replenishment watcher in `/ar-follow-up`. Possible later; does not fire at send time.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Confirm `record_retainer_notice`'s parameters.
3. Edit `letters.md` §8's follow-up paragraph and §10's sent act (owned by the record-sent spec; add one clause only).
4. Tests with invented fixtures.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of retainer top-up request follow-up complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A sent client letter requesting replenishment records a retainer notice.
2. The follow-up to-do offer fires for it, with the BF date from the practitioner.
3. No skill text computes or states a replenishment deadline.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. How does the session know a letter requests a replenishment: the scrivener's purpose, a flag the scrivener returns, or the practitioner's word?

## 10. Verify against HEAD before building

- `letters.md` §8 and §10 at HEAD, after the record-sent spec lands.
- `practice_data__record_retainer_notice` contract.
