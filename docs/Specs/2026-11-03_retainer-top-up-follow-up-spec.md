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

## 11. Verification against HEAD (b4a3dab9, 2026-11-03)

| Item | Finding | Evidence |
|---|---|---|
| `letters.md` path and landing of the record-sent spec | Holds. The source is `.claude/skills/draft/references/letters.md`, and §10's "When it goes out" paragraph landed in 4e5a33cb. | `git log` on the file; `letters.md` §10 |
| §2's quotation of §8's follow-up paragraph | Holds. It fires only "When the Sent write succeeds" and only on a date the letter states. A client letter has no Sent write. | `letters.md` §8, §10 |
| "client letter or email" | An email to the client is a client letter: only a client letter and a reply on the reply route are not Writings, and a client letter's send copy is emailed. So §10's sent act covers both, and a Writing never goes to the client. | `procedure.md` "Save first"; `letters.md` §10 |
| A reply on the reply route | No trigger: a reply is no Writing and has no Sent record, so a reply that requests replenishment is never "recorded as sent". Left out of this spec. | `.claude/skills/draft/references/reply.md` |
| `record_retainer_notice` contract | Holds `sent_at` only, plus the matter reference. The goal's amount requested and source letter need two optional inputs, a patch change. | `source/lawyer/mcp/src/tools/practice/writes.ts:295`; `source/lawyer/mcp/src/schema/practice.ts:466` |
| The store and the cloud accept the extra data | Yes. Data fields stay on the machine and only their keyed hashes leave. The cloud checks each hash's format and keeps no list of field names by kind. | `cloud/items/rules.sql:496-504`; `source/lawyer/mcp/test/practice-cloud.unit.test.mjs` |
| What reads `retainer_notice` | Only `open_tasks`, which reads `sent_at`. A notice without the new fields, migrated or old, stays valid. | `source/lawyer/mcp/src/tools/practice/reads.ts:216`; `scripts/migrate_practice_db.py:98` |
| A to-do with no `filing_ref` | Allowed. Its pointer is optional in the tool and the cloud. /task-prioritization requires it only for a filing, or a letter to the forum or another party. | `writes.ts` `upsert_task`; `cloud/items/rules.sql:190`; `task-prioritization/SKILL.md` "Add a to-do" |
| "render the mockup" in §8's paragraph | Not limited to a Writing, and a client letter has no mockup. It must be limited. | `letters.md` §8, §10 |
| A test pins the sent act | `test_no_database_write` forbids any `practice_data__` in §10's act, so the one new tool must be excepted there. | `.claude/skills/draft/tests/test_client_letter_sent_contract.py` |
| The tool reaches a /draft session | The staging turn's tool search does not list `practice_data__record_retainer_notice`, so it must be added. | `.claude/skills/draft/SKILL.md` "Rules for each step" |
| §9's open question | Answered: a letter requests replenishment if its own text does or the practitioner says so. No scrivener flag. | Maintainer's decision, 2026-11-03 |
