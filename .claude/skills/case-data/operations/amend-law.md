# Operation: amend-law

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

Corrects **law-side text** — an authority's `fact_pattern` /
`loss_description` / `disposition` / `citation`, an authority edge's
`proposition` / `finding` / `factual_context` / `obiter` / `order_terms` /
`pinpoint` / `excerpt`, or a
criterion's `criterion_description` / `authority_proposition` /
`burden_of_proof`. Before this operation existed, law-side text was effectively
**write-once at ingest**. A verifier or lint could find a defect and have nowhere
to put the fix.

This operation is the **only** sanctioned path that *corrects* law-side text. It never touches the pool. One scoped exception carved out by design-decisions.md decision #22: a **human-approved duplicate merge** ([`merge-authorities.md`](merge-authorities.md)) may backfill empty fields and fold colliding edges when collapsing two rows for the same case/statute — it never corrects populated text, which stays here.

## Scope — what it will not do

- **Never** modifies `relationship`, `treatment`, `treated_by_authority_id`, `criterion_order`, `requirement_type`, `concept_id`, `determined_by_concept_id`, or any PK column. Treatment semantics are decision #16's; structure is ingest's.
- **Never** inserts or deletes rows (ingest and [`review.md`](review.md) own those). To retire a wrong edge, reject it (`verified = -1`) — the row is retained.
- **Never** writes `cloud_principle_id` / `pushed_at` / `pushed_source_hash` ([`push-state.md`](push-state.md) owns those). It only **reports** the derived push-state consequence.
- **Never** writes the pool or calls any `legal_commons__*` tool.
- **Never** sets `human_reviewed` — that column is facts/positions only (decision #18), and does not exist law-side.

## 1. Input

A **batch** of amendment records, applied in one transaction:

```json
{
  "target": {"kind": "edge", "concept_id": 108, "authority_id": 39},
  "field": "proposition",
  "current_text": "<the exact full current value>",
  "new_text": "<the replacement>",
  "reason": "<why — mandatory, non-empty>",
  "authorization": {"mode": "practitioner", "reference": "<citable adjudication>"},
  "source_anchor": {"quote": "<passage from the judgment>", "locator": "para. 14"}
}
```

`target.kind` is `authority` (key `authority_id`), `edge` (key
`(concept_id, authority_id)`), or `criterion` (key `criterion_id`).

**Field allowlist** — reject any other field, loudly:

| kind | allowed fields |
|---|---|
| `authority` | `fact_pattern`, `loss_description`, `disposition`, `citation` |
| `edge` | `proposition`, `finding`, `factual_context`, `obiter`, `order_terms`, `pinpoint`, `excerpt` (v8.5) |
| `criterion` | `criterion_description`, `authority_proposition`, `burden_of_proof` |

## 2. Authorization modes — what an autonomous run may do

| mode | may change text? | edge `verified` becomes | note written |
|---|---|---|---|
| `practitioner` — a recorded human adjudication exists (in-session HITL, or delegated with a citable record) | yes | `1` | `CORRECTED <ISO date> (<field>): <reason> [auth: <reference>]` |
| `verifier` — a source-anchored finding from a **session-isolated** verifier | yes, **only if** the target edge is `verified = 0` **and** the anchor check (§3.4) passes | `0` — re-enters the pipeline, mirroring the in-place-correction rule in [`../shared/verification-protocol.md`](../shared/verification-protocol.md) | `CORRECTED <ISO date> (<field>): <reason> [verifier: <reference>; anchor: <locator>]` |
| `none` — autonomous and unadjudicated (e.g. a raw lint hit) | **no, never** | `2` — escalate to the human queue | `PROPOSED CORRECTION (<field>): "<old>" → "<new>" — <reason>` |

`<ISO date>` is `date('now','localtime')` in the writing statement, never typed (`../shared/conventions.md` §10).

Authority rows carry no `verified` column. A validated authority amendment changes
the text and appends the same dated provenance form to `authorities.notes`; it does
not fabricate an edge-verification state. In `none` mode an authority proposal is
reported for practitioner review without changing text.

**A `verified = 1` edge is never overwritten by `verifier` or `none` mode** — it is escalated to `2` with a proposed-correction note. This is the **blanket no-overwrite rule** (design-decisions.md #20): it holds regardless of *who* set the `1`. Edges carry no `human_reviewed`, so a `1` may record a lawyer's own adjudication and nothing distinguishes it from the edge verifier's — silently overwriting it is what decision #18 forbids for facts. The rule was kept, rather than adding `human_reviewed` law-side, when the edge verifier landed (handover 124).

The `none`-mode note is **idempotent**: if an identical proposed correction is already present, change nothing (per the verification protocol's idempotency rule).

## 3. Validate — all records, before any write

1. Validate via `case_data__query` calls per [`../shared/conventions.md`](../shared/conventions.md) §2.3 (target existence, `current_text` match, anchor resolution) — no writes yet.
2. **Target exists.** Missing → hard fail the batch.
3. **`current_text` matches the stored value byte-exactly** (NFC-normalized).
   For nullable fields, JSON null matches SQL `NULL`; null never matches an empty
   string. Mismatch → **hard fail the whole batch** and report both values. This is
   the mis-target / concurrent-edit guard: concurrent sessions share the matter
   tree, and a stale `current_text` means the caller is reasoning about a row that
   has since changed.
4. **Anchor check** (mandatory for `verifier`, recommended otherwise). Resolve the authority's source document: try `law.authorities.file_path`, accept only if its sha256 equals `law.authorities.file_hash`; on path miss or hash mismatch, fall back to a **hash search** over the matter tree (paths go stale when files are renamed post-ingest; `file_hash` is the durable identity). Unresolvable → refuse that record with `SOURCE_UNRESOLVABLE`; do not write.
5. **Null and non-empty rules.** `new_text = null` is allowed only for the nullable
   allowlisted fields `loss_description`, `order_terms`, `obiter`,
   `factual_context`, `pinpoint`, and `excerpt`. These are the complete **nullable allowlisted fields**;
   reject null for every other field. The existing non-empty rule remains for
   `proposition`, `finding`, and `criterion_description`. Blanking a load-bearing
   field is a delete in disguise — refuse it; use `review.md` Reject
   (`verified = -1`) instead.

Any record failing validation → **roll back the entire batch**. Records are applied together or not at all.

## 4. Apply — one transaction

Update the field, set `verified` per §2 (edges only), and append the provenance note
to the corrected row (`authorities.notes` for authorities,
`concept_authorities.notes` for edges, `legal_criteria.notes` for criteria).
Criteria carry no `verified` column — their edits are already visible as divergence
when a hash-covered field changes. All validated records apply in a single
`case_data__execute` call (one `sql_script`) —
a failure rolls back every record in the batch, matching §3's all-or-nothing rule.

## 5. Report, then dump

Report per record: target identity, authority title + citation, relationship where
applicable, field, old → new (including null), reason, anchor quote + locator, the
source-resolution result (path used, hash match, or hash-fallback path), and the
push-state consequence where a hash-covered concept field changed:

> concept `<N>` will read `diverged` until re-pushed or re-stamped.

In an interactive run, display this block **before** writing and take the practitioner's sign-off. In an autonomous run, emit the identical block into the report. A standing "don't ask" instruction does not waive this sign-off.

`case_data__execute` regenerates `evidence.sql` and copies the binaries back automatically on success (§2.3) — no separate dump step. Report every `UPDATE` (table, key, field, old → new).
