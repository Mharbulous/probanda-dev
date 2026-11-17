# Spec: The drafting records survive a two-computer sync

Status: approved, 2026-11-17. Brahm approved both decisions in §9 as recommended (D1 and D2) on 2026-11-17.
Plugin: `lawyer` (the data server and the `drafting-data` skill). Paths are relative to the repo root. `src/` means `source/lawyer/mcp/src/`.
Source: the recommendation of 2026-11-17 on the per-matter drafting database, steps 1 to 3 of "What I would build now". No rename, no split into two files and no cloud work belongs in this spec.

## 1. Problem

A matter's drafting records (`submission.sqlite`) sit in a folder that a file-sync service keeps in step between two computers. On 2026-11-17 the file split into conflict copies, and an empty database then stood in for the real one. Three faults made that possible or likely:

1. Session entry creates an empty database whenever the plain file name is missing, with no check for signs of earlier work (`src/submission/open-session.ts:380`). The conflict-copy guard added that day (`refuseSyncSplit`, `src/submission/backend.ts:59-79`) catches only copies already visible and named `submission-<computer>.sqlite`.
2. Writes that change nothing still replace the whole file, and so look to the sync tool like new work. `staged_write` replaces the live file whenever `mutate` reports a commit (`src/staged-store.ts:58-60`), and `do_write_all` and `do_execute` report a commit whenever nothing failed (`src/submission/backend.ts`, `do_execute` and `do_write_all`). A lapsed lock's release is written at session entry (`open-session.ts:420`) and before every board-page write (`src/dispatch.ts:509`), which is the worst case: a computer whose copy is behind sees the other computer's held job as an hour idle and writes on its stale copy.
3. The schema needs SQLite 3.47.0 or later (`RAISE()` with `||` in `guard_filing_facts_attached_del`, `source/skills/drafting-data/references/schema.sql:1094-1103`, noted at `migrations.sql:4170-4172`). An older library reports "malformed database schema", which reads as corruption. Nothing checks the version.

## 2. Goal and non-goals

Goal: a computer never puts an empty or stale drafting database in place of earlier work without the practitioner's yes; a write that changes nothing leaves the file alone; an old SQLite is refused with a message that says so.

Non-goals: ending sync forks (only arbitration outside the sync tool does that); renaming `submission.sqlite`; splitting it; moving job claims anywhere; any schema change.

## 3. Design

### 3.1 Never create over earlier work

Session entry (`openSession`) and `drafting_data__migrate` (`submissionDataMigrate`) create a database only when the plain file is missing **and** none of these signs of earlier work is present:

- a `submission.sqlite.bak-*` file beside it (`backups()` in `open-session.ts` already lists them);
- a page in the matter's draft folder that this generator wrote (the marker test `generatorWrote` in `src/submission/matter-page-files.ts`);
- this computer's write record for that database (§3.2).

Otherwise both refuse, before anything is created, written or swept into TRASH, with a new code `earlier_work_missing` that names each sign found and says what to do: wait for the sync to finish, look for the file in the sync service's version history for the folder or in the `.bak-*` copy, and merge copies by `source/skills/drafting-data/references/sync-split.md`. How the practitioner overrides the refusal is decision D2 (§9).

### 3.2 Lost-write check

Each computer keeps, for each drafting database it writes, a record in its own host-local folder (`hostLocalPath(dbPath, ...)`, `src/submission/lock.ts:45`): a random writer id minted on first write and the count of writes it has made. Every committed write that changes a row also sets `db_meta` key `writes:<writer id>` to the new count, in the same staged transaction, and the host-local record is updated after the live file is replaced.

Before every write, and at session entry, the server compares. If the live file's `writes:<writer id>` is lower than this computer remembers, or absent while the computer remembers a count, this computer's own writes are missing: the file was replaced by a copy that lacks them. Refuse with a new code `lost_writes`, naming the count missing, before anything is written. The override is decision D2.

No schema change: `db_meta` is a key-value table, and it carries no revision triggers (`job-activity.ts:8-9`), so the revision does not move. An older copy of the plugin ignores the row.

### 3.3 The conflict-copy pattern

Widen `syncSplitCopies` (TypeScript) and `split_copies` (Python helper), which must stay identical, to also match the names other sync tools and Windows give copies: `submission (1).sqlite`, `submission - Copy.sqlite` and `submission (conflicted copy ...).sqlite` (Dropbox). The `.bak-*` files and the staging sibling `coclerk_submission_replace_*` are never copies. List each pattern with its source in the comment above the constant.

### 3.4 Replace the live file only when a row changed

`do_write`, `do_write_all` and `do_execute` return `committed = False` when the transaction changed no row (`con.total_changes == 0` after `COMMIT`), so `staged_write` leaves the live file untouched. The result still says `ok: true`, with `changes: 0`. `touchJob` then records nothing and replaces nothing when its guard matches no row. Migrations are untouched.

### 3.5 No lapse release on read paths (needs decision D1)

Remove the release of other sessions' lapsed locks at session entry (`open-session.ts:420`) and before a board-page write (`dispatch.ts:509`). A lapsed lock is then written as released only by the `assign_job` that takes the job, which already matches a lapsed lock without `takeover` and records the lapse (`src/submission/forms/assign-job.ts:113`). Boards already read a lapsed job as Ready (`ticket-category.ts` `lockLapsed`).

This amends ADR 0015 D4 ("Every tool that writes a board page first releases each lapsed lock but the caller's") and reverses the consequence ruled on 2026-11-06 that a reader of `tickets` sees a lapsed job as `queued` from the first page write. Before it ships, every skill query that reads `tickets.status = 'wip'` as "held" must use the lapse test instead, or be confirmed harmless. The known ones are in `source/skills/drafting-data/references/`: `jobs-closeout.md` (lines 11, 23, 26, 260, 278, 294: a lapsed lock would block closing a filing), `filing-checklists.md` (374, 377), `paragraph-revision.md` (62, 124), plus the rest of the 8 skill files that hold `'wip'`. A shared SQL fragment for "held and not lapsed" belongs beside `lapsedClause` and in the skill prose that states it once.

### 3.6 Last activity at most every 15 minutes

`touchStatements` writes only when the job's stored last activity is 15 minutes or more behind now. The guard is SQL in the statement itself, so a touch inside the window changes no row and, by §3.4, replaces nothing. 15 is a named constant beside `LAPSE_AFTER_MINUTES`, and must stay well under it (a held job then reads at most 15 minutes staler than it is, against a 60-minute lapse). The session-active stamp in `db_meta` follows the same rule.

### 3.7 SQLite version

Every Python entry point that opens a drafting database refuses below SQLite 3.47.0 with code `sqlite_too_old` and a message naming the version found, the version needed and that the matter's file is not damaged: the backend helper and query sidecar (`src/submission/backend.ts`), the migrate driver (`src/submission/migrate.ts`, `migrate_engine.py`) and `split_merge.py`. One check, defined once where the helpers can share it.

## 4. Constraints that must still hold

- The conflict-copy guard refuses as it does today, before anything is created, written or swept.
- A job held under 60 minutes stays held. ADR 0015 D1, D3 and D5 and CoClerk ADRs 0004, 0009 and 0037 stand.
- A write that changes a row behaves exactly as today, its replace atomic.
- Old and new copies of the plugin can share a matter's data (a patch under the version rule in `CLAUDE.md`).
- Every refusal states the outcome in the practitioner's words, with no internals beyond what they need to act (`skills/shared/internals-confidentiality.md`).
- Nothing outside `file-manager` moves or deletes a file Probanda did not create (Commandment 7). The host-local record is Probanda's own file.

## 5. Options considered

- Rename the file, split it into jobs and Writings, or move claims to a per-computer file: rejected in the recommendation. Claims in Probanda's Cloud: deferred to the drafting-data conversion plan.
- A file-size test for "empty database": rejected, a size says nothing about whose work is in it. The lost-write check tests that directly.
- A heartbeat or sweep: rejected in ADR 0015 and not needed here.

## 6. Implementation plan

Each step lands as its own commit on `main` once its tests pass.

1. §3.7 SQLite version check, with its test.
2. §3.4 and §3.6: skip the replace on no change, and the 15-minute touch window.
3. §3.3 the wider copy pattern.
4. §3.1 and §3.2: earlier-work refusal and the lost-write check, with the override D2 decides.
5. §3.5, only after D1 is approved: remove the two release calls, move every skill read of held jobs to the lapse test, and amend ADR 0015 with a dated note naming what changed and the practitioner's ruling.

## 7. Implementation criteria

1. A database file whose SQLite reports 3.46 (simulated) is refused by query, execute, migrate and split-merge with `sqlite_too_old`, and is not modified.
2. `touch_job` for a job this session does not hold, and a `release_job` that matches no row, leave the live file's modification time and bytes unchanged.
3. Two `touch_job` calls 5 minutes apart change the file once. One 15 minutes later changes it again.
4. Session entry on a matter with `submission.sqlite` missing and a `submission.sqlite.bak-*` present refuses `earlier_work_missing` and creates nothing. Same with a generator-marked Work Board page in the draft folder, and with this computer's write record present. With none of the three, it creates as today.
5. `drafting_data__migrate` behaves as criterion 4.
6. A file replaced by an older copy of itself (taken before this computer's last write) is refused `lost_writes` at session entry and at the next write, and nothing is written.
7. `submission (1).sqlite` and `submission (conflicted copy 2026-11-17).sqlite` beside the plain file each trigger `sync_conflict_copies`; a `.bak-*` file does not.
8. After D1 only: a session entry with another session's lock 61 minutes idle writes nothing and the board shows the job Ready; `assign_job` takes it and records `lock_lapsed`; closing a filing whose only `wip` job has lapsed is not blocked.
9. Existing tests pass, including `open-session.db.test.mjs`, `job-activity.db.test.mjs`, `release-lapsed.db.test.mjs` (rewritten for D1 if approved), `split-merge.db.test.mjs` and `case-sync-split.db.test.mjs`.

Prior art for the tests: `source/lawyer/mcp/test/open-session.db.test.mjs` (the conflict-copy refusal at entry) and `release-lapsed.db.test.mjs` (lock idle times set by hand). Test at the tool seam (`open_session`, `drafting_data__*`) and assert on files on disk, not on internal calls.

Scope: edit the source the fix needs (`src/`, the `drafting-data` skill and its scripts, ADR 0015 after D1) and write and run the tests. Out of scope, because the orchestrating session runs them once after the work lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any bundle (`dist/`). Never build a `.plugin` archive.

## 8. Recovery of the 2026-11-17 matter

Not code. Merge the two 819,200-byte copies with `drafting_data__split_merge` by `sync-split.md`, keeping the empty 757,760-byte file out of the merge and out of the folder. This is done in a matter session, not by this spec's implementer.

## 9. Decisions for Brahm

Both approved as recommended by Brahm on 2026-11-17.

**D1. Amend ADR 0015 D4 (§3.5).** A lapsed lock is written as released only when the job is next assigned, no longer at session entry or before a page write. Effect: a computer behind on sync no longer writes on its stale copy just by opening a matter. Cost: anything reading `tickets.status` directly sees a lapsed job as `wip` until it is assigned, so every such read moves to the lapse test first. This reverses your ruling of 2026-11-06. Recommended: approve. Without it, steps 1 to 4 still ship.

**D2. How the practitioner overrides `earlier_work_missing` and `lost_writes` (§3.1, §3.2).** Recommended: one argument, `accept_current_file: true`, on `open_session` and `drafting_data__migrate`, passed only after the practitioner's yes to a plain question that names what is missing. It creates the database (or accepts the file as it is) and resets this computer's write record to match. The alternative, telling the practitioner to delete the host-local record by hand, is not available to them in Cowork.

## 10. Verified, and not

Read at HEAD `0e8f81ce` for this spec: `open-session.ts:315-435`, `backend.ts:1-140` and `240-330`, `staged-store.ts`, `job-activity.ts:1-170`, `lock.ts:1-70`, `migrate.ts:60-130`, `migrate_engine.py:455-500`, `matter-page-files.ts:1-40` and `95-145`, `matter-root.ts:10-25`, ADR 0015, the release call sites (`dispatch.ts:509`, `open-session.ts:420`) and the skill lines in §3.5.

Not verified: the device VM's SQLite version; the exact copy names Dropbox and Windows produce today (confirm against their documentation when writing the pattern comment); that `total_changes` counts trigger-made changes as the skip in §3.4 needs (it does in SQLite's documentation, but the implementer confirms with a test).
