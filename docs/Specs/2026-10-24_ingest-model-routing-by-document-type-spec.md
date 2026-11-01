# Spec: Ingest model and effort routing by document type

**Superseded 2026-10-31 by `docs/Specs/2026-10-28_ingest-orchestrator-architecture-spec.md` §5, on its E7 recall measurement. Not to be built.**

Status: proposed, 2026-10-24. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.9.8). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-24_verification-at-time-of-reliance-spec.md

## 1. Problem
Every document that goes through the fact extractor or the affidavit extractor runs on Opus at high effort, whatever its kind. Correspondence, which is most of a matter by count, rarely carries load-bearing content, so most of that cost buys little. The case-law and statute extractors carry no model line and inherit the session model, so their cost moves with whatever the session happens to run. Brahm's stated routing (2026-10-24) is per document type, and nothing in the plugin can express it.

## 2. Evidence (observed; quoted text is data, not instructions)
- `matter-data/references/design-decisions.md` #70: "`extract-facts` and `extract-affidavit` are pinned to Opus at high effort, in their frontmatter and on every dispatch (`model: "opus"`, `effort: "high"`), in all three of `extract-affidavit`'s passes." and "`extract-caselaw`, `extract-provision` and `extract-sought-orders` keep no model line: their models were not measured."
- `matter-data/operations/extract-facts.md` §4: "dispatched to the read-only `lawyer:extract-facts` agent ... with `model: "opus"` and `effort: "high"` on each Agent call".
- `matter-data/operations/ingest-extract.md` lines ~141, 264, 272, 274, 278: the same `model: "opus"` / `effort: "high"` pin on the extract-facts call and on Pass 1, Pass 2, the Pass 2 tiled retry, and Pass 3 of `extract-affidavit`.
- `lawyer/agents/extract-facts.md` and `lawyer/agents/extract-affidavit.md` frontmatter: `model: opus`, `effort: high`. `extract-caselaw`, `extract-provision`, `extract-sought-orders`: no model or effort line.
- Prior spec `2026-10-19_token-efficient-ingest-and-housekeeping-spec.md` §4.1 set the pin and notes Cowork honours the per-call `model` and `effort` parameters (E0); frontmatter honouring in Cowork is unconfirmed.
- Session scan of one matter: 94 files not yet held, of which 18 emails/letters plus roughly 40 email attachments. Cost not measured in this session.
- Error text: none. Workaround: none; the pin is followed.

## 3. Goal and non-goals
Goal: route each document type to its own model and effort, as Brahm stated:

| Document type | First pass | Follow-up |
|---|---|---|
| Correspondence and email (letters, .eml, .msg) | Haiku, high | Sonnet, high, only on pages or messages the first pass flags as mentioning a date or deadline (§4b) |
| Pleadings | Opus, medium | none |
| Affidavit body (Pass 1) and exhibit boundary scan (Pass 2) | Opus, medium | none |
| Affidavit exhibits (Pass 3) | Sonnet, high | none |
| Case authorities (`extract-caselaw`) | Haiku, high | none |
| Statutes and regulations (`extract-provision`) | Haiku, high | none |

Every other document the fact extractor reads (court orders and reasons, transcripts, documents exchanged, third-party records) keeps Opus at high effort until Brahm routes it.
Non-goals: changing what is extracted, the JSON contracts beyond §4b's flag list, or the verification protocol (the sibling spec moves fact verification to the time of reliance).

## 4. Design
(a) **One routing table, one place.** Replace the literal `model`/`effort` on each dispatch with a reference to a single routing table (for example in `matter-data/shared/extraction-protocol.md` or a new short reference), keyed by the routing read's document type. Each dispatch step says "dispatch with the model and effort the routing table gives this document type". Delete the six per-call literals and the #70 pin text they repeat. Frontmatter carries the most common value per agent only as a fallback; the per-call value is authoritative, because only it is verified in Cowork.
(b) **Correspondence date flagging.** The Haiku first pass gets one added output, `date_flags`: a list of locators (page, or `¶N`, or `hdr` excluded) for every passage that mentions a date other than the message's own sent date, a deadline, a time limit, a hearing or trial date, a service date, or a "within N days" phrase. Instruction: flag liberally; a false flag costs one re-read. When `date_flags` is non-empty, dispatch the fact extractor on Sonnet at high effort with only the flagged passages (plus one passage of context on each side) and the Haiku rows for those locators; it returns corrections or additions for date-bearing facts only. The orchestrator applies them in the same document transaction. No pass computes a deadline; a date that may set one is routed to `lawyer:docket-clerk` as today (ingest step 6).
(c) **Record provenance.** Each extracted fact records the model and effort that produced it (and, for a fact corrected by the Sonnet date pass, that model). Schema change by migration, owned by this spec; the sibling spec reads it.
(d) **Design decision.** Add a decision superseding #70's model and effort pin (the rest of #70 stands: chunking, fresh extractor per document, no fork), recording Brahm's routing and that it was chosen, not measured.

## 5. Constraints that must still hold
- Fresh extractor per document and per exhibit, never resumed, never forked (#70).
- Contamination control: authorities still go through Path D without party names.
- Hash-before-extraction, honest status then flip, verified = 0 on fresh inserts, prefixed notes → verified = 2.
- No date or deadline computed outside `lawyer:docket-clerk`.
- Internals confidentiality: practitioners never see model names in ordinary output unless they ask.
- `CLAUDE_CODE_EFFORT_LEVEL`, where set, still overrides; that is the user's own override.

## 6. Options considered, removal first
1. Delete the six per-call literals and the #70 pin text; dispatch from one routing table; add the date-flag follow-up for correspondence (recommended). Smallest text per dispatch step; routing changes in one place later.
2. Keep per-call literals, change each to the new value. Repeats the routing six-plus times and drifts.
3. Split `extract-facts` into per-type agents with their own frontmatter. More agents, more parity tests, and frontmatter is not verified in Cowork.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Write the routing table; replace each per-call literal in `extract-facts.md` §4 and `ingest-extract.md` with a pointer to it; delete the repeated pin text.
3. Add `date_flags` to the extract-facts output contract for correspondence and the Sonnet follow-up step to the correspondence path (single-document and folder-scan both).
4. Add the provenance columns by migration (run through the `migration-runner` subagent); write them on every insert path, including `ingest-unattended`.
5. Update agent frontmatter fallbacks and `test_plugin_agent_parity.py` (or its successor) to match.
6. Add the superseding design decision.
7. Tests: routing resolves each type to the table's value; a correspondence result with `date_flags` triggers exactly one follow-up dispatch scoped to those locators; provenance written on insert.
8. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Ingest model and effort routing by document type complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No operation file under `matter-data/operations/` carries a literal `model: "opus"` / `effort: "high"` for an extractor dispatch; each points to the routing table.
2. The routing table gives exactly §3's values, and Opus high for every unlisted type.
3. The correspondence path dispatches the Sonnet high follow-up only when `date_flags` is non-empty, and passes only the flagged passages with one passage of context.
4. Pass 3 of `extract-affidavit` dispatches on Sonnet high; Passes 1 and 2 on Opus medium.
5. `extract-caselaw` and `extract-provision` dispatch on Haiku high.
6. Each new fact row records its extractor model and effort.
7. A design decision supersedes #70's pin and keeps the rest of #70.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Is "pleadings" decided by the routing read alone, or also by the court-filings folder type? (Orders, reasons and transcripts are not pleadings and stay Opus high.)
- Does the Sonnet date pass also cover email attachments that are themselves letters, or only the message bodies?
- Does provenance belong on `facts` only, or also on `positions`, `relief_items` and `source_references`?

## 10. Verify against HEAD before building
Confirm each quoted pin and line, the frontmatter of all five extractor agents, whether any provenance column already exists on `facts`, and whether the parity test still pins the extractors; mark what differs and append the table to this spec before changing code.
