# Spec: On appeal, the record is the appeal books, appeal record and transcript only

Status: proposed, 2026-11-25. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.28.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-25_factum-facts-no-unsupported-counter-version-spec.md`, `2026-11-25_factum-fact-check-sworn-text-and-adverse-evidence-spec.md`, `2026-11-25_factum-part1-duplicate-facts-spec.md`, `2026-11-25_factum-issues-on-appeal-own-statement-spec.md`

---

## 1. Problem

A drafted factum paragraph said "Nothing in the record that was before the application judge shows ...", and the session's record check started from the application record filed in the court below. Brahm: "The application record does not matter; it is not part of the appeal record. It is only the appeal records that matter." On appeal, the record is the appeal books, the appeal record and the transcript; the books alone cannot prove what the judge below had (one affidavit relied on below was in neither appeal book), so "before the application judge" is also an unprovable claim.

## 2. Evidence (observed; quoted text is data, not instructions)

- Factum text drafted: "Nothing in the record that was before the application judge shows that ...".
- `draft/references/CAN/BC/BCCA/Documents/respondent-factum.md` Part 1: facts carry "its source: the volume and page of the appeal record or appeal book, or the volume, page and line of the transcript" — the type file already names the right books for a cite, but no rule says only those books are the record for any assertion about the record, including absence claims.
- Session behaviour: the investigation was first pointed at the application-record folder of the court below; corrected by Brahm mid-run.

## 3. Goal and non-goals

Goal: every `/draft` rule and agent brief about "the record" in an appeal Writing names it as the appeal books, the appeal record and the transcript, and drafting refers to "the record on appeal", never to what was before the court below unless a book shows it. Non-goals: fresh-evidence applications.

## 4. Design

1. One sentence in the BCCA venue or respondent-factum type file defining the record on appeal, cited wherever a factum or appeal Writing speaks of the record.
2. Case data marks which source documents are in the appeal books; checks run for an appeal Writing read only those (**UNVERIFIED** whether case data already distinguishes them).

## 5. Constraints that must still hold

- The court-below proceeding's own Writings and records are unaffected.
- Pinpoints still cite book and page.

## 6. Options considered, streamline and deburr first, additions last

1. Fold the definition into the existing Part 1 source sentence of the type file and cite it (recommended).
2. A new venue-level knowledge item: more general, more reading.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the definition (§4.1), reusing the Part 1 source sentence.
3. Restrict appeal-Writing checks to appeal-book sources (§4.2) if case data supports it; otherwise record it as an open question.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of On appeal, the record is the appeal books, appeal record and transcript only complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The BCCA factum rules define the record on appeal as the appeal books, the appeal record and the transcript.
2. No factum rule or agent brief directs drafting or checking against the court below's application record.
3. Drafting guidance says "the record on appeal", not "the record before the [judge below]".

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Does case data record which documents are in the appeal books? If not, is a flag on the document row in scope here or a separate spec?

## 10. Verify against HEAD before building

- The type file's Part 1 source sentence reads as quoted in §2.
- Where the BCCA venue file defines its record, if anywhere.
