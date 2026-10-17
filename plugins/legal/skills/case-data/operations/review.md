# Operation: review

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

Read [`../shared/review-protocol.md`](../shared/review-protocol.md) for the exact action semantics (Confirm/Correct/Reject/Delete and their effects on `verified`/`human_reviewed`) and the per-row display contract — this file references that protocol rather than restating it.

## 1. Run the needs-human backlog query

Run named query `05b` (`@query_05b_verification_needs_human` in [`../references/queries.sql`](../references/queries.sql)) — the lawyer's queue, `verified = 2` across `facts`, `sources`, `positions`, `evidence_links`, `issues`, and (v7.1) law-side `concept_authorities` edges.

## 2. Group and present

Group the returned rows **by table**. For each row, present the fields required by [`../shared/review-protocol.md`](../shared/review-protocol.md): entity type, id, summary, `verified` value, notes, locator, and the computed citation (per [`../shared/conventions.md`](../shared/conventions.md) citation format). Rows from `positions` additionally display the row's **position value** (`claim | admit | deny | not_admit | no_position`), `position_basis`, and any verbatim `qualification`.

## 3. Collect a decision per row

For each presented row, collect one of **Confirm / Correct / Reject / Delete** from the lawyer, per the exact effects defined in [`../shared/review-protocol.md`](../shared/review-protocol.md).

## 4. Apply

- **Facts**: corrected **in place**.
- **Positions**: corrected **bitemporally** — close the current row (`valid_to = date('now','localtime')`) and insert a successor with `valid_from = date('now','localtime')`, `prior_id` = the closed row's id.
- On Confirm or Correct, the successor/updated row gets **`verified = 1`, `human_reviewed = 1`, `pending_reverification = 0`**. Review is the only operation that sets `human_reviewed = 1`; every human disposition clears a stale quarantine marker atomically.
- **Law-side edges** (`concept_authorities`, v7.1): identified by **`(concept_id, authority_id)`** — query 05b reports `concept_id` as `row_id` and carries the `authority_id` in the summary. Corrected **in place**. Confirm/Correct set `verified = 1`; **no `human_reviewed`** — that column does not exist law-side (decision #18). An edge at `verified = 1` may have been set here (lawyer-confirmed) or by the edge verifier (`verify-law.md`), and nothing distinguishes them — which is why the **blanket no-overwrite rule** applies: no autonomous path changes a `verified = 1` edge, it escalates to `2` instead (design-decisions.md #20).

  This operation is also the **escape hatch for the push hold-back gate**: a concept whose edges sit at `verified = 2` is held back from the push queue, and clearing those edges here makes it pushable. That is the sanctioned route — there is no "push anyway" (`push-state.md`, Sub-op A).
- On Reject: `verified = -1`; facts and positions also get `pending_reverification = 0`. On Delete: hard delete the row (prefer Reject when audit history matters, per the review protocol). Rejecting an edge excludes it from the push payload and the push-source hash, so the concept will read `diverged` — that is correct: a rejection is a content change the pool must learn about.

All writes for one review session run in a single `case_data__execute` call (§2.3).

## 5. Preserve the privilege firewall for `fact_provenance`

`fact_provenance` rows live in `privileged.sqlite`. Query 05b does not surface `fact_provenance` rows directly (it covers `facts`/`sources`/`positions`/`evidence_links`/`issues` in `main`), but if a review action on a `facts` row would otherwise cause its linked `fact_provenance.source_note` content to be copied, summarized, or otherwise moved into `main`, do not do it. Review must never move privileged content into the main database — it may confirm/correct/reject/delete the main-side row, but the privileged row's content stays in `privileged.sqlite`, referenced only by the trigger-enforced FK, never duplicated across the firewall.

## 6. Batch confirm requires acknowledgement

A batch confirm (applying Confirm to more than one row in one action) is only permitted after reporting the counts to be confirmed **by entity type** and receiving the lawyer's explicit acknowledgement of that count. Never batch-confirm silently.

A Confirm here is also recorded as the lawyer's own adjudication: facts and positions get `human_reviewed = 1`, so automated corrections stop auto-applying (design-decisions.md #18), and a law-side edge at `verified = 1` is never autonomously changed again (design-decisions.md #20). Confirm when the matter context is in front of you — the deliverable, the pleading, the judgment the row cites. In a cold session clearing a queue, prefer leaving rows at `2`: a deferral costs one later look; a cold confirm stands as judgment that was never exercised ([live-issue test](../../shared/live-issue-test.md)).

## 7. Dump and report

`case_data__execute` regenerates `evidence.sql` automatically on success (§2.3) — no separate dump call. Report every INSERT/UPDATE performed (confirms, corrections, rejections, deletes — by entity type).

## 8. Track backlog growth across sessions

Before applying this session's decisions, record the pre-session backlog size (row count from query 05b, by table). After applying decisions, compare against the backlog size from the **previous** review session (if known — e.g. from a prior dump's review-queue count, or a value the calling context supplies) and surface the trend: is the `verified = 2` backlog growing, shrinking, or flat, and by how much, broken down by table. Report this trend alongside the per-run counts so a growing backlog is visible across sessions, not just within one.
