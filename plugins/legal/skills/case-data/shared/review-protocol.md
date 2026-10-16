# Review Protocol

Backend-free human-review semantics. Review is the lawyer's stage of the verification pipeline: the point where a human confirms, corrects, rejects, or removes rows the AI verifier could not settle. This file speaks only in terms of **sources**, **facts**, **positions**, fields, and states — no SQL, no table-qualified writes, no engine specifics.

Cross-cutting definitions (the `verified` enum, notes prefixes, citation format, bitemporal mechanics, the `human_reviewed` flag) live in [`conventions.md`](conventions.md) — referenced here, not restated.

## The lawyer's queue is `verified = 2` only

The human review queue holds rows at `verified = 2` — rows the AI verifier escalated for human judgment. It does **not** include `verified = 0` rows: those belong to the AI verifier and are its backlog, not the lawyer's. Presenting freshly extracted (`verified = 0`) rows to the lawyer would drown the human queue in work the automated verifier should handle first. The lawyer sees only what genuinely needs a human.

## Per-row display

Present each queued row with:

- its **entity type** (fact, position, source, …) and **id**;
- a **summary** of the row's content;
- its **`verified`** value;
- its **notes** (including any machine-detectable prefix — see [`conventions.md`](conventions.md));
- its **locator**;
- its **computed citation** (per the citation format in [`conventions.md`](conventions.md));
- the **position value** where the row is a position.

## Actions and their exact effects

For each row the lawyer chooses one of:

- **Confirm** → set `verified = 1`, set `human_reviewed = 1`, and clear `pending_reverification = 0` atomically on facts and positions. The `human_reviewed` flag is what distinguishes a lawyer-confirmed row from a merely AI-verified one; review is the only stage that sets it.
- **Correct** → apply the fix, then set the same flags as Confirm (`verified = 1`, `human_reviewed = 1`, `pending_reverification = 0`). Facts are corrected **in place**; positions are corrected via **bitemporal supersession** (the successor row carries the confirmed flags) per the mechanics in [`conventions.md`](conventions.md).
- **Reject** → set `verified = -1` and clear `pending_reverification = 0` atomically (excluded from the working views, retained for the record).
- **Delete** → **hard delete** the row. Prefer **Reject** over Delete whenever audit history matters — a rejected row preserves the trail of what was extracted and why it was excluded, while a deleted row leaves no trace. Reserve Delete for rows that should never have existed.

## Batch confirm

A batch confirm may run **only after** reporting the counts to be confirmed **by entity type** and **receiving the lawyer's acknowledgement**. Do not confirm a batch silently: the lawyer must see how many facts, positions, and sources a single acknowledgement would sweep to `verified = 1` / `human_reviewed = 1` before it happens.
