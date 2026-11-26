# Spec: Respondent's factum Part 2 frames the respondents' issues instead of printing Part 3's contentions

Status: proposed, 2026-11-25. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.28.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-25_factum-facts-no-unsupported-counter-version-spec.md`, `2026-11-25_factum-fact-check-sworn-text-and-adverse-evidence-spec.md`, `2026-11-25_appeal-record-is-the-appeal-books-spec.md`, `2026-11-25_factum-part1-duplicate-facts-spec.md`

---

## 1. Problem

Part 2 (Issues on Appeal) of the respondent's factum printed the same argument paragraphs as Part 3, so it argued rather than framed the issues, and it doubled 14 paragraphs of a 30-page factum. Brahm: "Part 2 is supposed to be framing the issues for appeal, not arguing", "not just accepting the issues as framed by the Appellant", and "the Respondents framing of issues should map to the Respondents Arguments." Probanda had nowhere to store a separate statement of issues, so it was written by hand in the Word copy, outside the drafting records; a later publish would restore the old Part 2. Brahm's further instructions on the hand-written version: "state the respondents position. Words are precious due to strict page limits. Do not waste words summarizing the Appellants issues on appeal", and "the Issues on Appeal section should not include paragraph references."

## 2. Evidence (observed; quoted text is data, not instructions)

- `drafting-data/references/filing-checklists.md` §12: "Part 2 — Issues on Appeal. One numbered paragraph per deployed submission's `contention`, in `filing_submissions` order." Part 3: "`submissions`/`filing_submissions(document='form')` ... rendered as in §10's Analysis." Same rows feed both Parts.
- `draft/references/CAN/BC/BCCA/Documents/respondent-factum.md`: "Part 2, the appellants' points in issue. Read the appellants' factum, transcribe each point verbatim, and confirm the transcription with the practitioner before writing. Each is an opposing argument, answered by a rebuttal." — frames Part 2 as the appellants' points, the opposite of the instruction.
- Observed: 14 Part 2 paragraphs were verbatim copies of Part 3 contentions; the accepted hand-written Part 2 was one lead-in sentence ("The respondents say the application judge made no error, and that the issues on this appeal are:") and six lettered questions, each mapping to a group of Part 3 paragraphs, with no paragraph references and no summary of the appellants' issues. Workaround: Word copy edited by hand, cross-references and List of Authorities paragraph numbers renumbered by hand (-13).

## 3. Goal and non-goals

Goal: Part 2 holds the respondents' own issues, each a short question with no argument and no authority, introduced by one sentence stating the respondents' position, with no summary of the appellants' issues and no paragraph references; each issue is linked in data to the Part 3 submissions it frames, so the mockup can show (mockup-only) which issue has no argument and which argument answers no issue. The appellants' points stay recorded as opposing arguments for the rebuttal tracking. Non-goals: Part 1 changes (sibling specs).

## 4. Design

1. A store for the respondents' issues (e.g. an ordered issues list on the filing, each issue linked to one or more submissions), or a `filing_prose` slot plus links — §9 Q1.
2. Renderer: Part 2 prints the lead-in sentence and the lettered issues only; Part 3 unchanged. Mockup-only: an issue with no linked submission, and a deployed submission linked to no issue.
3. Type file: replace the Part 2 bullet with the rule in §3, and drop the "transcribe each point verbatim" instruction from Part 2 (the opposing points stay where the rebuttal tracking needs them).

## 5. Constraints that must still hold

- The "Points not yet answered" rebuttal tracking stays available (mockup-only).
- Part 3 and the List of Authorities render as before.
- The filed face carries no mockup-only lines.

## 6. Options considered, streamline and deburr first, additions last

1. Issues stored with links to submissions; Part 2 renders from them (recommended): delivers mapping and stops the duplication.
2. A free-prose Part 2 slot: no mapping check.
3. Keep rendering contentions but truncate: still argues.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the issues store and migration (§4.1), with the gatekeeper docs.
3. Change the factum renderer and the emitter for Part 2 (§4.2).
4. Rewrite the type file's Part 2 bullet (§4.3).
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Respondent's factum Part 2 frames the respondents' issues instead of printing Part 3's contentions complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Part 2 renders only the lead-in and the respondents' issues; no Part 3 contention prints in Part 2.
2. No paragraph references and no summary of the appellants' issues appear in Part 2 by rule.
3. Each issue links to its Part 3 submissions, and the mockup flags an unlinked issue or submission.
4. The emitter's Part 2 matches the mockup's filed face.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Storage shape: issue rows linked to submissions, or a prose slot with links? Ask Brahm only if both are equally cheap.
2. Migration of existing factum Writings: leave Part 2 empty with a gap marker until issues are written (default), or seed from contentions?

## 10. Verify against HEAD before building

- §12 Part 2 and the type file's Part 2 bullet read as quoted in §2.
- Where the factum renderer and `emit_bcca_factum` build Part 2.
- Whether any issues table already exists (e.g. the stay-response "Issues" derived from positions).
