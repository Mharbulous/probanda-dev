# Operation: merge-authorities

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3.

Merges two `law.authorities` rows that are the **same case or statute** entered twice — collapsing the duplicate onto a surviving canonical row and tombstoning the other. It is the **second** sanctioned writer of law-side rows (the first is `ingest-extract`; text corrections belong to [`amend-law.md`](amend-law.md)), scoped strictly to **human-approved duplicate merges**. See design-decisions.md decision #22.

**Architecture — script computes, agent perceives, human decides.** A deterministic stdlib script (`references/scripts/merge_authorities.py`) owns all detection, checks, election, field-merge computation, and SQL emission. This operation only: pulls the data, resolves the perception-only checks (B4/B6) by reading the documents, presents the proposal, and — on the human's approval — submits the emitted SQL. **No merge executes without the human's explicit per-pair approval.** The script never opens a database and never reads the clock; the merge date and operator are supplied by this operation at emit time.

## E1 requirement

The merge script runs **locally** (E1). In E2/Cowork, **halt** and report that authority deduplication is a local-session operation (`references/scripts.md` execution rules). Do not stage or run the script in a mediated/sandboxed filesystem.

## Scope — what it will not do

- **Never** merges trial/appeal or successive decisions in one litigation (they are separate rows by design, design-decisions.md #16). Hard stops **B1/B2/B3/B3b/B9 are non-overridable** — the script rejects such pairs and this operation relays the rejection; it does not second-guess them.
- **Never** merges an `oral_reasons` row, in either direction (**B9**, v8.5). An oral-reasons authority is a pointer to an unreported bench decision whose only identifier is a synthetic `Oral reasons, <court> <file number>, <judge>, <date>` citation carrying no style of cause. The citation-normalization rules that drive B1/B2 cannot tell two of them apart, and folding one into a reported decision would assert that a transcript-free pointer and a reported judgment are the same document. Upgrading an oral-reasons row when a transcript is later obtained is a separate flow, deliberately deferred (design-decisions.md #46) — it is not a merge.
- **Never** corrects law-side *text* — that is [`amend-law.md`](amend-law.md). Merge only backfills empty fields, unions citations, folds colliding edges, and re-points references.
- **Never** touches the pool or calls any `legal_commons__*` tool. Two *different* `cloud_authority_id`s are recorded in the surviving row's notes and flagged for a **separate human-initiated** commons merge (Decision 10; dormant while all cloud IDs are NULL).

## 1. Gather

Four `case_data__query` calls assemble the script's input JSON (extra columns are tolerated):

| Key | Query |
|---|---|
| `authorities` | full rows: `authority_id, title, citation, authority_type, jurisdiction, disposition, fact_pattern, loss_description, notes, file_path, file_hash, cloud_authority_id, last_verified_at` from `law.authorities` |
| `concept_authorities` | `concept_id, authority_id, relationship, proposition, finding, factual_context, order_terms, obiter, pinpoint, excerpt, treatment, treated_by_authority_id, verified, notes` from `law.concept_authorities` |
| `legal_criteria` | `criterion_id, authority_id, treated_by_authority_id` from `law.legal_criteria` |
| `authority_treatments` | full rows from `law.authority_treatments` |

Assemble these into one `rows.json`.

## 2. Detect / check

Run the script's plan mode:

```
python3 references/scripts/merge_authorities.py --plan --input rows.json [--pair C_ID D_ID] [--format md]
```

Pass `--pair` when the user named the two rows; omit it to sweep the whole `law.authorities` set for candidates. **Relay every `rejected` pair and its reason** — those are the hard-stopped pairs the human should know were considered and set aside.

## 3. Perceive (agent) — resolve the `agent_required` checks

For each proposed pair, the plan leaves **B4** (decision date) and **B6** (document comparison) as `agent_required` — the script cannot read PDFs. For each pair:

1. Open **both** `file_path` documents with the native Read tool.
2. Compare judgment date, judge/panel, docket/registry number, court header, and approximate length (B4/B6). Check the two `disposition` texts for contradiction (B5, if the script flagged it).
3. **Any mismatch or doubt → treat the pair as escalated, not mergeable** — do not clear the check.

Only when a check is genuinely satisfied, set that check's `status` to `pass` in the proposal object. A pair is emit-eligible only once every check is `pass` and every field CONFLICT has a resolution.

## 4. Decide (human)

Present each proposal: per-field before/after, every CONFLICT, every edge fold, every treatment fold, the election result and its basis. Collect:

- a **resolution** for every field CONFLICT (which value survives), and
- **explicit approval** per pair (`decision = "merge"`), or a **not-duplicate** ruling (`decision = "not_duplicate"`).

**Only `N1`-rule pairs with all checks clean are proposed autonomously** (`autonomously_proposable = true`); everything else — N2/N3/STATUTE/HASH-only, or any escalated check — is presented as *"needs your judgment."* Write the human's decisions and resolutions into the proposal JSON.

## 5. Execute

Run emit mode with the approved proposal, the merge date, and the operator. The merge date is read, never typed: run `SELECT date('now','localtime') AS today` through `case_data__query` and pass the value unchanged (`../shared/conventions.md` §10).

```
python3 references/scripts/merge_authorities.py --emit-sql --proposal approved.json --merge-date <ISO date> --operator "<name>"
```

The script **refuses** (exit 2, `REFUSED: …`) if any check is failed/`agent_required`, any CONFLICT is unresolved, or no decision is approved — surface that verbatim and go back to the human; never hand-edit the proposal to force emission. Submit the emitted SQL via `case_data__execute` with `matter_root` (conventions §2.3). The emitted script is self-guarding: an `_assert` table aborts the whole transaction if D was already merged, C is gone, a B3/B3b link reappeared, or any post-condition fails. **Any failure surfaces verbatim** — never retried with hand-modified SQL. `case_data__execute` regenerates `evidence.sql` automatically on success.

A **not-duplicate** decision emits a tiny script instead: it appends `[NOT-DUPLICATE-OF:#<other-id>]` to **both** rows' notes, so the pair is suppressed from future detection.

## 6. Report

Per merge: pair ids / titles / citations, match rule + checks, election basis (and any override), backfills and conflict resolutions, edge/treatment migration and fold counts, the edges left at `verified = 2` (they land in `@query_05b`, the lawyer's queue), the tombstone marker written on D, and any anomalies (dual `cloud_authority_id` flagged for a commons merge, bilingual translation-review notes). Rejected pairs get the `[NOT-DUPLICATE-OF:]` marker only if the human ruled them not-duplicates.

## Markers on `law.authorities.notes`

`[MERGED-INTO:#<C> <date> <operator>]` (tombstone) and `[NOT-DUPLICATE-OF:#<id>]` are a **new marker family** on `law.authorities.notes`. The conventions §5 prefix rule (a prefixed note forces `verified = 2`) does **not** apply here — `authorities` has no `verified` column. These markers are read by the script (to exclude tombstones and suppress not-duplicate pairs) and by ingest (tombstone redirect, `shared/extraction-protocol.md`).
