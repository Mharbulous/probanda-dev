# Playbook: provenance (facts learned from privileged sources)

**Fires when:** a fact was learned from — or is otherwise explained by — a privileged source (solicitor-client communication, privileged correspondence, privileged work product) and that discovery path needs to be recorded.

## Why provenance is not evidence

`privileged.fact_provenance` records **investigative provenance** — where and how the fact was learned, including when the source can never be produced. `main.evidence_links` records **admissible proof** — non-privileged material that can actually be put before the court. These are answering different questions and **must never be consolidated**. A privileged source can explain a fact's discovery without ever being able to prove it.

A fact that has a `fact_provenance` row but no `evidence_links` row is not an error — it is a **trial-prep gap**: something is true and known, but not yet provable. This gap is exactly what named query 10 (facts with privileged provenance only) surfaces. The gap closes only when an admissible `evidence_links` row is added for that fact (from a non-privileged source, or via `promotion.md` if the privileged source itself becomes producible).

## Steps

1. Resolve the pointer and read `shared/conventions.md` first.
2. Identify the fact (`main.facts.fact_id`) that was learned from the privileged source, and the privileged source (`privileged.privileged_sources.source_id`). When no non-privileged source states the fact, its `main.facts` row is a **bare row**: an ID and nothing else, and the privileged statement's wording goes into `source_note` below, never into `main` (`design-decisions.md` #67; `../../operations/bare-privileged-facts.md`).
3. Insert a row into `privileged.fact_provenance`:
   - `fact_id` = the `main.facts` id (cross-database trigger-FK enforces the target exists in `main.facts`).
   - `source_id` = the `privileged.privileged_sources` id.
   - `source_locator` = where in the privileged source the fact appears.
   - `source_note` = the Statement of Fact on a `STATEMENT: ` line when the fact is a bare row (record format: `../../operations/bare-privileged-facts.md` §2), then any explanatory note — this is also where a privileged informant's identity is recorded when `main.facts.informant` had to be NULLed out to protect privilege (see `shared/conventions.md` and the compound-document informant rule).
   - `verified` = 0 (or 2 if a prefixed note applies — `shared/conventions.md` §5).
4. **Never write to `main.evidence_links` from this playbook.** If the fact also happens to be provable by non-privileged material, that is a separate evidence-linking action, not part of recording provenance.
5. Run the dump (`shared/conventions.md` §8) after the mutation.
6. Report the inserted `fact_provenance` row and note whether the fact currently has any `main.evidence_links` row. If it does not, state plainly that this is a trial-prep gap (surfaced by named query 10) until admissible evidence is found.

## What this playbook does not do

- It does not decide whether a source is privileged in the first place — that judgment call happens at ingestion.
- It does not promote the source to producible — see `promotion.md` for that, which is a separate, later decision.
