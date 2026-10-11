Read when: composing a job write that sets `filing_id`, a `ticket_blocks` or `ticket_conflicts` edge or `seeds.charted_into`, or when `execute` returns a CHECK or foreign-key refusal on a job table.
Any §N not in this file: find it in SKILL.md, "Job and scrutiny operations".

## 11. Integrity the schema's CHECKs cannot hold

Not enforceable by a table constraint — hold these by discipline when composing a write:

- A job's `filing_id`, when set, must belong to its own `proceeding_id`.
- A `ticket_blocks` or `ticket_conflicts` edge should join two jobs of the same proceeding.
- A `ticket_blocks` edge whose **blocked** side is another job needs that job `queued` with `rejected_at` and `deleted_at` NULL. The edge changes what it waits on, and a completed, superseded, shelved or deleted job has nothing left to wait for. The schema refuses no such row, so §3a's write proves it instead. §3f is the one exception: its edges' blocked side is the holder's own `wip` job, and the same script releases it to `queued`.
- `seeds.charted_into` should point at a job in the same proceeding as the loose thread.
- A loose thread is never a blocker — `ticket_blocks` only ever references `tickets.id` on both sides; a loose thread has no scope, no plan, nothing to block on.
- A `ticket_blocks` edge that points outside the job's own proceeding renders as an unresolved blocker (ADR 0018): the renderer only loads this proceeding's jobs, so it cannot see the other job's status, and the blocked job stays under "Blocked" and is never offered as ready. A `superseded_by` pointer outside the proceeding renders the pointer with no status. Either is a composition mistake to correct, never a way to share work across proceedings: no job moves between proceedings or belongs to two.
- A job or loose thread of a proceeding with no Writing (ADR 0018) has `filing_id` NULL. It renders on that proceeding's own Job Board (`drafting_forms__render` with `proceeding_id`) until the proceeding has a Writing, then on every Writing's board like any proceeding-scoped row.

## 12. What the schema already refuses, loudly

- Deleting a Writing that still has jobs referencing it fails on the foreign key (`tickets.filing_id REFERENCES filings(id)`) — every `PRAGMA foreign_keys` is `ON` for every `execute` (`backend.ts`). This is about deletion only: retiring a Writing (§9a) deletes nothing and leaves every job row in place, superseded. There is no "orphaned job" state to handle either way, because the database will not create one.
- A `wip` job with no `locked_by`, a `superseded_by` pointer on a job that is not `superseded` (the reverse is now allowed — a retirement supersedes with no superseding job, §9a), a `completed` job with no `completed_at`, a `work` job with no `billing_anchor`, a job that blocks or conflicts with itself, and a non-canonical `ticket_conflicts` row (`a_id >= b_id`) are all refused by CHECK before they reach the file. A refusal here is a composition bug, not a data problem to work around.
