# Spec: Respondent's factum Part 1 states the same facts twice

Status: proposed, 2026-11-25. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.28.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-25_factum-facts-no-unsupported-counter-version-spec.md`, `2026-11-25_factum-fact-check-sworn-text-and-adverse-evidence-spec.md`, `2026-11-25_appeal-record-is-the-appeal-books-spec.md`, `2026-11-25_factum-issues-on-appeal-own-statement-spec.md`

---

## 1. Problem

Part 1 printed the same facts twice: once in the respondents' position on the appellants' facts (the facts-position prose) and again as a separately sourced fact a few paragraphs later. Under a 30-page limit that wastes words, and it doubles the risk: an error in one copy (here, "refers to them only as") sits beside a correct copy, and fixing one leaves the other. The same session found Part 2 and Part 3 duplicating each other (sibling spec), and Part 3 repeating its own sentences in consecutive paragraphs.

## 2. Evidence (observed; quoted text is data, not instructions)

- `drafting-data/references/filing-checklists.md` §12 Part 1: "First the respondents' position ... `filing_prose` `slot='facts_position'` (numbered paragraphs, from 1). Then any other facts: `facts` + `filing_facts(document='form', part='part2', ordinal)`." Two stores feed one Part, with no link between a position paragraph and the fact it relies on.
- Observed: Part 1 para 2 (position prose) and para 7 (a fact) cover the same document, parties, signature blocks and pleading denial; 5 of para 2's 5 claims reappear in para 7.

## 3. Goal and non-goals

Goal: a fact appears once in Part 1. The position on the other side's paragraph cites the fact paragraph that answers it ("see para. N"), or the fact is stated in the position and not again. Non-goals: Part 2/Part 3 duplication (sibling spec).

## 4. Design

1. A mockup-only duplicate marker on Part 1 when a position paragraph and a fact paragraph overlap substantially (threshold §9 Q1), counted by the open-items criterion.
2. Drafting rule: position prose cross-references the fact paragraph instead of restating it.

## 5. Constraints that must still hold

- Practitioner-dictated prose is never rewritten without approval.
- The filed face carries no marker.

## 6. Options considered, streamline and deburr first, additions last

1. Drafting rule plus a mockup duplicate marker (recommended).
2. Rule only: no backstop.
3. Store the position's facts as fact rows only: larger data change.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the cross-reference rule to the type file's Part 1 bullet (shared with `2026-11-25_factum-facts-no-unsupported-counter-version-spec.md`, which owns that bullet's wording; add one clause).
3. Add the duplicate marker in the factum renderer (§4.1).
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Respondent's factum Part 1 states the same facts twice complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The Part 1 rule tells the drafter to cross-reference, not restate, a fact paragraph.
2. A mockup render of a factum with overlapping position and fact paragraphs shows a duplicate marker on both, and none on the filed face.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Overlap threshold for the marker (shared sentences? shared source pinpoint?). Default: same source pinpoint plus shared key terms.

## 10. Verify against HEAD before building

- §12 Part 1 reads as quoted in §2.
- Whether any duplicate-text marker already exists for other kinds.
