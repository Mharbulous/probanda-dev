---
status: accepted
date: 2026-11-02
---

# Loose threads have their own store

A loose thread is work, or an idea for work, that was snipped: someone decided enough was done and left it. The test is whether it was cut off. Threads belong to the matter, so an agent working toward a Work Board should never see them unless it asks on purpose. This amends ADR 0010's note of 2026-10-29, which took them off the boards but left them in the `seeds` table of the drafting database, where any `drafting_data__query` still reached them.

## Decision

- **One store per matter.** Free-floating threads move to `loose_threads.db` beside the drafting database: the generic `kv_store` file of `kv/backend.ts`, one namespace, each value JSON. `kind` (idea, proposition, correspondence, argument, work_board) is the only type field, as Commandment 5 requires. No DDL line and no schema migration were added. Ids are kept, and a new id is one above the highest held.
- **A refusing boundary.** Only `loose_threads__capture` (write-only, returns the id alone), `__read` (triage, and the duplicate test, which returns matches only) and `__update` reach it. `drafting_data__execute` refuses a script writing `seeds`, naming those tools. A job's card still lists the threads that job wrote, and only those.
- **Work with a record or file stays put.** Shelved jobs, killed propositions and submissions, started or unrecorded memos, retired letters that did not go out and closed Work Boards are read where they stay and shown as read-only cards. Moving them would break what depends on them. A killed row is what stops the same point being proposed again.
- **One move, run once.** `open_session` and the three tools run it: a copy-aside of the database, every row copied, each id confirmed held, `seeds` emptied, a marker stamped. A kill at any point leaves a state the next run finishes. The emptied table stays, since dropping it means schema work on a legacy store.
- **A job from a thread is two writes.** Across two files they cannot be one transaction, so the job is written first and a failed consume is reported in the result as `thread_not_consumed`.
- **The page goes by kind.** Tabs All, Jobs, Ideas, Propositions, Legal Memos, Correspondence, Arguments, Work Boards. Ranked, Unranked, Deferred and Resolved become a status filter inside a tab, and ranking applies to ideas only. The Legal Research page's memo lane stays.

## Consequences

- `review_points.seed_id` references `seeds(id)`, and writes run with foreign keys on. The move's delete runs with them off for that one write, so each old link stays as the number it was, naming the same thread by its kept id. No code reads the column. A new link cannot be written there, since the reference has no row to find: a thread from a review point carries `ref` `review_points:<id>` instead. A later hop that rebuilds `review_points` must do so with foreign keys off, as the rebuild hops already do.
- A row an older copy of the plugin writes to `seeds` after the move is read by nothing. `open_session` reports it as `loose_threads_moved.stray`.
- A merge now repoints the absorbed board's threads in the survivor's proceeding to the survivor. A thread in another proceeding keeps its filing, since a filing id names a board in the thread's own proceeding.
- The store is a new local file per matter, but not a new legacy store under the Commandments' Exception: it encodes no rulebook, and no file holds it per kind.
