# Spec: Before stating a fact, check the sworn text, contradicting affidavits and adverse record evidence

Status: proposed, 2026-11-25. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.28.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-25_factum-facts-no-unsupported-counter-version-spec.md`, `2026-11-25_appeal-record-is-the-appeal-books-spec.md`, `2026-11-25_factum-part1-duplicate-facts-spec.md`, `2026-11-25_factum-issues-on-appeal-own-statement-spec.md`

---

## 1. Problem

A factum fact about a document was drawn from the exhibit alone (its signature page). Brahm: "have you checked whether the affidavit itself includes a sworn statement that evidences the fact? Have you checked whether any other affidavits deny that statement?" It had not. Nor had it searched the record for evidence cutting the other way. A later check found, in the same appeal books: a related contract clause requiring the document to be executed by the parties now said not to be parties to it; those persons' signatures on the related contract; two other agreements referring to the document as in force; a recital signed by the respondents' own counsel referring to the document; and a passage in the respondents' own pleading readable as inconsistent with the denial relied on. None was weighed before the fact was stated.

## 2. Evidence (observed; quoted text is data, not instructions)

- `drafting-data/references/filing-checklists.md` §12 Part 1: "Each fact's source is `facts.court_record` ... + `court_record_pinpoint`" — one source per fact; nothing requires the deposing paragraph to be read when the source is an exhibit, nor a search for contradicting or adverse evidence.
- Agent `litigator:source-tracer` (reliance mode) per its description: "checks one case-data fact ... from excerpts only: whether the stored fact is faithful to its source". Faithfulness to one source; no contrary-evidence search.
- `lawyer:extract-affidavit` extracts sworn body, exhibit boundaries and exhibits as separate passes, so the sworn paragraph and the exhibit are separate records — the link between them is available but not consulted when a fact is drafted from an exhibit (**UNVERIFIED**).
- Cost: one investigation agent (~200k tokens, 54 tool calls) to establish what one record check at drafting time would have.

## 3. Goal and non-goals

Goal: before a fact sourced to the record is drafted into a filing, (a) when its source is an exhibit, the sworn paragraph that exhibits it is read and its words control; (b) every other affidavit in the record is checked for a statement contradicting it; (c) the record is searched for evidence that cuts the other way, and what is found is reported to the practitioner with pinpoints before the fact is used. Non-goals: which books count as the record (sibling spec); the respond-to-the-gap rule (sibling spec).

## 4. Design

1. Extend the existing source-trace review (reliance mode) so a fact gets three checks, not one: sworn text for exhibit-sourced facts; contradicting affidavits; adverse record evidence. Output keeps its JSON verdict shape with an added list of adverse items (document, pinpoint, short quote).
2. `/draft` runs it on each Part 1 fact and on the facts-position prose before the mockup is presented, and the adverse items are shown on the mockup as a mockup-only marker under the fact (an existing marker if one fits; otherwise §9 Q1).

## 5. Constraints that must still hold

- The checker stays read-only, isolated from the drafter, and states no law.
- Mockup-only markers never reach the filed face.
- Excerpts-only economy where possible: full documents are read only for the search the check requires.

## 6. Options considered, streamline and deburr first, additions last

1. Widen the existing `source-tracer` reliance mode (recommended): one agent, one dispatch per fact or group, as now.
2. A new adverse-evidence agent: a second dispatch per fact; duplicates record reading.
3. A practitioner checklist line on the mockup only: shifts the work back to counsel.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Widen the reliance-mode contract and agent text (§4.1).
3. Wire `/draft` to run it on Part 1 facts and facts-position prose and render the adverse items (§4.2).
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Before stating a fact, check the sworn text, contradicting affidavits and adverse record evidence complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. For an exhibit-sourced fact, the check reads the deposing paragraph and reports its words.
2. The check reports any affidavit in the record contradicting the fact, with pinpoint.
3. The check reports record evidence cutting the other way, with pinpoints and short quotes, and `/draft` shows it before the fact is relied on.
4. The checker remains read-only and states no law.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Which marker carries adverse evidence on the mockup — an existing one, or a new symbol? Ask Brahm if a new symbol is needed.
2. Cost cap: run the adverse search per fact, or once per Part 1 with all facts? Default: once per group of facts sharing a source document.

## 10. Verify against HEAD before building

- The reliance-mode contract and §12 Part 1 read as quoted in §2.
- Whether case data already links an exhibit to the sworn paragraph that exhibits it.
- Whether any adverse-evidence search already exists elsewhere (e.g. `/apply-to-facts`, `marshal-facts`).
