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

### Verification against HEAD (2026-11-26, at 5fb98e1e)

| Claim | At HEAD | Where |
|---|---|---|
| Paths in the installed copy | Exist in the repo source as `source/skills/drafting-data/references/filing-checklists.md`, `source/litigator/agents/source-tracer.md`, `source/skills/draft/references/reliance-check.md` and `source/skills/draft/references/source-trace.md` | repo tree |
| Reliance mode checks one case-data fact from excerpts only, for faithfulness to one source | Confirmed. It reads nothing but the excerpts it is given, never opens a source and never searches. Its entries are matter-data facts (`fact_id`) from the scrivener's `sources`, written back through `/matter-data` reliance-verify. It never runs on a factum | `source-tracer.md` §6; `reliance-check.md` §1; `matter-data/operations/reliance-verify.md` |
| §12 Part 1 gives one source per fact and asks for no sworn-paragraph read or contrary-evidence search | Confirmed in substance. Since 75d384c0 it points to the type file for which books are the record on appeal, and since 5fb98e1e the facts position is reviewed by `source-tracer` (`kind` `facts_position`) before the mockup. That review covers the position prose only, not the other Part 1 facts, and its search looks for a record contradicting the text, not for sworn text or evidence cutting the other way | `filing-checklists.md` §12; `source-trace.md` §1; `source-tracer.md` §4 step 5 |
| Part 1 facts are case-data facts | Not matter-data facts. A Part 1 fact is a drafting-data `facts` row (`postulate`, `court_record`, `court_record_pinpoint`), with no link to a matter-data `fact_id`, so reliance mode's entries cannot carry it | `drafting-data/references/schema.sql`; `filing-facts.ts` |
| Case data links an exhibit to the sworn paragraph that exhibits it | Only to the affidavit. In matter-data each exhibit source's `parent_source_id` is the affidavit body. `lawyer:extract-affidavit` Pass 1 returns each exhibit's `referencing_locator` (the paragraph), but the ingest journal keeps only letters and page ranges (`ingest-result.ts` `inventoryOf`), so the paragraph is not stored. In drafting-data `exhibited_by` is untracked. The checker finds the paragraph by reading the affidavit body for the exhibit's letter | `extract-affidavit.md` Pass 1; `ingest-extract.md` Path C Pass 3; `ingest-result.ts`; `terms-and-symbols.md` |
| An adverse-evidence search exists elsewhere | Not for one fact. `litigator:marshal-facts` sorts case-data facts as satisfying or contradicting a cited legal criterion and lists `adverse_facts`; it needs a cited test and reads case data, not the record. The nearest is `source-tracer`'s own step 5 contradicting-record search, which the `facts_position` kind already runs in the books | `marshal-facts.md`; `source-tracer.md` §4 step 5 |
| A mockup marker for record evidence against a fact | None fits as is. 👃 derives from a stored `statements_of_fact.doubt` and a court-record Part 1 fact usually has no statement; 🚩 is a hold printed on no page (`facts.adverse`); ↩️ is an unanswered opposing argument. Any marker the renderer prints must derive from stored data, and the factum's filed face is a purpose-built emitter that prints no marker | `symbol-table.ts`; `work-markers.md` §1c, §4; `render-bcca-stay-response.ts` `renderFactParagraphs`; `emit-bcca-factum.ts` header |
