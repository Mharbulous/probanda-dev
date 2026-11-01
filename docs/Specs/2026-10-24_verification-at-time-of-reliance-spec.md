# Spec: Fact verification at the time of reliance

Status: proposed, 2026-10-24. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.9.8) and `litigator` (version not read this session). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-24_ingest-model-routing-by-document-type-spec.md

## 1. Problem
Fact verification is tied to ingestion, not to use. An extracted fact can look right in isolation and still distort its source's meaning; that distortion usually shows only when the fact is used in a sentence. With cheaper first-pass extractors (sibling spec), verifying every row at ingest would cost too much, and verifying none leaves relied-on facts unchecked. Brahm's design (2026-10-24): verify each fact only when a draft relies on it, using the draft paragraph as the test of whether the fact, as stored and as used, faithfully carries the source.

## 2. Evidence (observed; quoted text is data, not instructions)
- `matter-data/operations/ingest-verify.md`: "This operation re-verifies a source or case-law authority that already has extracted rows. It is reached either from `../operations/ingest.md` when the gate finds a hash match, or from the targeted corrected-row backlog." and "The unattended folder scan (`ingest-unattended.md`) does not verify a `complete` source, so it never reaches one."
- `matter-data/shared/conventions.md` §4: "`0` | unverified — a fresh extraction, awaiting the AI verifier".
- `lawyer:verify-source` agent description: "Compares one source document's already-extracted facts ... against the document itself, adversarially, in a session isolated from the extractor ... one instance per source document."
- `lawyer:scrivener` agent description: "returns the text with a source line for each fact it used and any open items."
- `litigator:source-tracer` agent description: "Checks every factual assertion in one outgoing letter, email, memo or reply against its primary source, adversarially, in a session isolated from the drafter, and returns one strict JSON verdict per assertion ... Dispatched by /draft ... one instance per text."
- Harness: the Agent tool's `fork` copies the calling session's whole context; there is no way to snapshot a subagent mid-context and fork it. `matter-data` design decision #70 already forbids forking extractors.
- Cost: not measured this session.
- Error text: none. Workaround: none; facts sit at `verified = 0` until a re-presented ingest or the backlog reaches them.

## 3. Goal and non-goals
Goal: when the scrivener drafts a paragraph that relies on case data, every case-data fact the paragraph actually relies on is checked against its original source, with the paragraph as context, whichever model extracted it. The outcome is saved so a fact's extraction is checked once, while each new use is still checked.
Non-goals: verifying facts the scrivener read but did not use; replacing `verify-source` for its existing callers; changing `/draft`'s layout, review or saving.

## 4. Design
(a) **Data block.** The scrivener's existing per-fact source lines become a strict data block: one entry per case-data fact the paragraph relies on (not every fact it read), each with the fact id, the sentence or clause that uses it, and every source and locator the fact cites. The block is a small subset of case data, scoped to one paragraph.
(b) **Per-fact checks, parallel, fresh.** For each entry, dispatch a fresh, isolated verifier (never a fork: a fork would carry the drafter's reasoning and break the adversarial isolation). Every dispatch opens with the same fixed prefix, the verifier's instructions and then the paragraph, and ends with its own fact and sources, so prompt caching makes the shared prefix cheap after the first call. Dispatch the first verifier, then the rest in one wave, so the rest read the prefix from cache.
(c) **Excerpts, not documents.** Each verifier gets the passage at each of the fact's locators plus one passage of context on each side, not the whole source. A fact with five sources gets five excerpts; a fact with one gets one.
(d) **Group shared passages.** Facts whose locators fall in the same short passage of one source go to one verifier together; others go alone.
(e) **Two answers per fact.** (i) Is the stored fact a faithful extraction of its source? (ii) Does the paragraph use it faithfully? Answer (i) is written back: confirmed sets `verified = 1`; a needed correction follows the existing corrected-row path (`pending_reverification`); an unresolved finding sets `verified = 2`. Answer (ii) is returned to `/draft` with the paragraph and is never saved, because it depends on the paragraph. A fact already at `verified = 1` still gets check (ii) on every new use.
(f) **Model.** Verifier on Sonnet at high effort; any disagreement with the stored fact, or a low-confidence verdict, is re-checked once on Opus before it is written. Choice, not measured.
(g) **Where it lives.** Prefer extending `litigator:source-tracer` (already isolated, already per-assertion, already dispatched by `/draft`) to take the data block and run per-fact, with `matter-data` owning the write-back; build a new agent only if HEAD shows source-tracer cannot carry it. A manual trigger ("verify the facts this draft relies on") runs the same check on a paragraph and data block already in hand.

## 5. Constraints that must still hold
- Verifier isolation from the drafter and from the extractor.
- Only `matter-data` writes case data; the verifier is read-only and returns JSON.
- `verified` enum semantics (conventions §4) and the corrected-row quarantine; `human_reviewed` set only by the review operation.
- Bare rows (privileged-only facts) are never shown to a verifier as wording; privileged sources stay in their privileged path.
- Correspondence isolation: only the scrivener writes outgoing wording; the verifier proposes no wording.
- Internals confidentiality in what the practitioner sees.

## 6. Options considered, removal first
1. Extend source-tracer to run per fact from the scrivener's data block, with excerpts, shared-passage grouping and write-back of answer (i) (recommended). Reuses the isolated checker and the existing source lines; adds the write-back and fan-out.
2. Keep one verifier per paragraph. Fewer fixed overheads and each source read once, but less focus per fact; no per-fact parallelism.
3. New per-fact verifier agent beside source-tracer. Duplicates source-tracer's job and its isolation rules.
4. Verify every fact at ingest. Rejected by Brahm: cost scales with extraction, not use.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Define the data block contract in the scrivener's output and make `/draft` pass it on.
3. Extend source-tracer (or, per §4g, a new agent) to take the paragraph, one entry (or one shared-passage group) and its excerpts; return answers (i) and (ii) as strict JSON.
4. Add the fan-out to `/draft`: excerpt resolution from each fact's locator, grouping, prefix-first dispatch, Sonnet high with one Opus re-check on disagreement.
5. Add a `matter-data` operation that applies answer (i): confirm, correct via the corrected-row path, or route to `verified = 2`.
6. Add the manual trigger.
7. Tests: a paragraph with N relied-on facts dispatches N verifiers minus shared-passage merges; each receives excerpts, not whole files; answer (i) updates `verified`; answer (ii) is not persisted; no fork is used.
8. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Fact verification at the time of reliance complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The scrivener's output carries a data block listing only the case-data facts the paragraph relies on, each with fact id, using clause, and every source and locator.
2. `/draft` dispatches one fresh verifier per fact or shared-passage group, never a fork, each opening with the same instructions-then-paragraph prefix.
3. Each verifier receives locator excerpts with one passage of context, not whole sources.
4. Answer (i) is written back through `matter-data` using the existing `verified` and corrected-row rules; answer (ii) is returned and not stored.
5. Verifiers run on Sonnet high; a disagreement is re-checked once on Opus before any write.
6. A fact already verified still gets the use check on each new paragraph.
7. A manual trigger runs the same check on a supplied paragraph and data block.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should a failed use check (ii) block the paragraph from being shown, or show it with the finding?
- Does the check also cover facts the paragraph states from outside case data (dictation, the practitioner's own knowledge), or only case-data facts?
- Should the data block show each fact's extractor model and effort to the practitioner, or only to the verifier?

## 10. Verify against HEAD before building
Confirm source-tracer's actual inputs, outputs and dispatch point in `/draft`; the scrivener's source-line format; whether each fact stores a locator precise enough to excerpt from; whether `ingest-verify.md`'s apply rules can be reused for answer (i); and the sibling spec's provenance column. Mark what differs and append the table to this spec before changing code.

## 11. Verification against HEAD (2026-10-31)

Read at HEAD `a1093b29`. Every path above is now checked against the repo.

| Item | Spec assumed | HEAD has | Differs? |
|---|---|---|---|
| source-tracer inputs | takes a data block | `source/litigator/agents/source-tracer.md` §3: `kind`, `audience`, `matter_root`, `text` (the whole outgoing text), `sources` (locators only), `accepted` | Yes: one whole text, no per-fact entries, no excerpts |
| source-tracer outputs | answers (i) and (ii) per fact | §5: one JSON object, `assertions[]` with `verdict` (`verified`, `attribute`, `trace_needed`, `cut`, `accepted`), `habit`, `sources_read`, `evidence`, `proposed_text`, `reason`; plus `unanswered[]`, `unread_sources[]`. It reads each source whole itself and proposes replacement text | Yes: no answer (i), no write-back. Its `proposed_text` is replacement wording, which the per-fact check must not give |
| source-tracer model | Sonnet high | frontmatter `model: opus`, read-only tools (`Read`, `Glob`, `Grep`, `matter_data__query`, mail reads) | Yes. A dispatch can override model and effort; `.claude/skills/ingest-orchestrator/SKILL.md` already starts agents with a given `model` and `effort` |
| Dispatch point in `/draft` | dispatched by `/draft` | `.claude/skills/draft/references/source-trace.md` §2, once per text, from the main session, before each letter, email or memo mockup, each `write_email` and the reply `.eml`; a gate by SKILL.md ban 20; routed by `references/procedure.md` atom `draft.ref.source-trace` | No |
| Scrivener source-line format | per-fact source lines | `source/lawyer/agents/scrivener.md` §7: `sources:` lines `- "<words of the text>" — <source locator, with pinpoint>`, one for each fact the text states. Its `facts` input (§2) carries source locators only. The contract lives in the agent file alone; `shared/scrivener/references/` holds wording guidance only | Yes: no fact id, and it lists every fact stated, case data or not |
| Scrivener scope | "a paragraph" | The scrivener writes correspondence only (letters, emails, covering notes, replies). Court filings are drafted in `/draft` itself (`shared/correspondence-isolation.md`) | Yes: the check reaches correspondence only |
| Locator precision | precise enough to excerpt | `main.facts` has one `source_id` + `source_locator`; further sources are `main.evidence_links` (`source_id`, `source_locator`, current where `valid_to IS NULL`). Forms (`matter-data/shared/conventions.md` §6): `para. 14`, `para. 14(a)`, `p42-L3-L18`, `p3`, `¶14` (rendered docx or email body), `hdr` | Mostly no. `source_locator` is nullable, so some facts cannot be excerpted. `¶N` needs a fresh `render_document.py` rendering. `p3` is a whole page |
| Reuse of `ingest-verify.md`'s apply rules | reusable for answer (i) | The rules live in `matter-data/shared/verification-protocol.md` ("Apply rules — exact"), which `ingest-verify.md` Step 3 applies: confirm → `verified = 1`, never `human_reviewed`; correction to a non-human-reviewed fact → in place at `(0, 1)`; correction to a human-reviewed fact → `verified = 2` with an idempotent note. A `(0, 1)` row is picked up by `@query_05d_pending_reverification` and `ingest-verify.md`'s corrected-row backlog mode, unchanged | No, with one limit: a whole-source pass stamps `sources.last_verified_at`, which attests a whole re-read. An excerpt check must not stamp it |
| Fact states the check meets | `verified` 0 or 1 | Pending rows `(0, 1)` and bare rows are excluded from drafting reads (conventions §4, §7), so they never reach a letter. A fact at `verified = 2` is in the lawyer's queue | Partly: `verified = 2` was not covered. It gets the use check only, as `1` does |
| Privileged facts | never shown as wording | A Fact known only from a privileged source is a bare row (`description = ''`, design decision #67), and `main.facts.source_id` references `main.sources` only | No |
| Sibling spec's provenance column | per-fact extractor model and effort | No such column: no match for `extractor_model`, `extracted_by`, `extraction_model` or `extractor_effort` outside `plugins/`. The sibling spec is superseded (commit `a1093b29`) | Yes: nothing may depend on one, and the data block carries no model or effort fields |
| Layering | — | source-tracer ships in `litigator`, matter-data in `lawyer`. The new matter-data operation must name nothing in `litigator` | Constraint, not a difference |

Decisions on §9, made 2026-10-31: a failed use check never blocks the paragraph, which is shown with the finding beside it; the check covers case-data facts only; extractor model and effort are never shown.
