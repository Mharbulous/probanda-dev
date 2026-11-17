# Migration plan: moving existing matters to the new drafting store

Companion to the recommendation of 2026-11-17 on the per-matter drafting database. Its Stage A is specified in `docs/Specs/2026-11-17_drafting-records-sync-safety-spec.md`, which is the source for that stage. Stage B waits for the drafting-data conversion design and joins it as that plan's migration section. This document covers only how existing matters get from today's `submission.sqlite` to what the recommendation proposes. Nothing here is built, and nothing here has been run against a real matter.

Paths are relative to the `probanda-dev` repo root. `src/` means `source/lawyer/mcp/src/`.

## What "the new schema" means here

The recommendation has two stages, and they need very different migrations.

- **Stage A, now:** the three fixes (no empty database over earlier work, no writes that are not work, a SQLite version check). **No table, column or file changes.** Existing matters need no conversion, only the first-run behaviour set out below.
- **Stage B, at the drafting-data conversion:** each matter's `submission.sqlite` (70 typed tables, version 81) becomes a converted store named `drafting.sqlite`. This is the real migration.

**Stage B's target schema does not exist yet.** `docs/Plans/2026-11-10_data-store-restructure-phase-2.md:44` says no conversion plan exists for this store. So this plan fixes everything that does not depend on the target's shape (inventory, freeze, backup, comparison, swap, the second computer, rollback) and lists what it needs from the conversion design. I assumed you meant both stages. If you meant a different schema, say which.

## Stage A: what happens to existing matters

No migration runs. Each behaviour below takes effect the first time an updated copy touches a matter.

| Fix | First contact with an existing matter | What could go wrong | Guard |
|---|---|---|---|
| Lost-write check (a per-computer write counter in `db_meta`, remembered in the computer's local folder) | The counter row is absent and the computer remembers nothing, so the first write starts it at 1. No refusal. | After a legitimate `split_merge`, or after restoring a `.bak-*` copy by hand, the file's counter is lower than the computer remembers, and the check refuses a good file. | `split_merge` carries each computer's highest counter into the merged file, as it already does for the revision (`split_merge.py:104-106, 160-161`, explorer's reading). A hand restore needs one explicit practitioner-confirmed call that resets this computer's memory for that matter. |
| No empty create over earlier work | A matter that never had a drafting database is created as today. A matter with `.bak-*` files, page records under `0. DRAFT`, or this computer's memory of it is refused. | A matter is refused although it truly has no database, because some other tool left files in `0. DRAFT`. | Before building: list exactly which files in `0. DRAFT` only a drafting session writes (`matter-pages-state.json` is one, `src/submission/matter-pages-state.ts`). Use only those as evidence. |
| Lapsed locks released at assignment, not at page write (amends ADR 0015 D4) | Rows are unchanged. A job that lapsed stays `wip` in the table until it is next assigned. The board already shows it as Ready. | A skill that reads `tickets.status` directly treats a lapsed job as held. | Grep the skills for direct reads of `status` and move each to the board's lapse test before the change ships. |
| SQLite version check | On a computer whose Python carries SQLite below 3.47.0, every drafting tool refuses with a message that says so. | None for the data. That computer could not read a version-59-or-later database before either (`migrations.sql:4170-4172`). | None needed. |

**Order for Stage A:** recover today's split matter first (`drafting_data__split_merge` on the two 819,200-byte copies, by `source/skills/drafting-data/references/sync-split.md`), then release. A patch version: old and new copies share the data safely.

## Stage B: the conversion migration

### What exists to migrate

Unknown until the inventory runs. I opened no matter. The inventory must report, for every matter on both computers:

- the path of its `submission.sqlite`, its size, SHA-256 and schema version (`db_meta.schema_version`, `src/submission/migrate.ts:120-126`);
- any `submission-*.sqlite` beside it (a split to resolve first);
- its `.bak-*` files, and whether `loose_threads.db` is beside it;
- any job held with a lock less than 60 minutes old.

### What makes this harder than the practice-db conversion

The practice-db migration (`docs/Plans/2026-10-14_practice-db-conversion.md:199-210`) is the pattern. Six things differ:

1. **Many files, not one.** One database per matter. A step that needed you present once now runs per matter, so every step must be scripted and resumable.
2. **Matters below version 81.** Each must first reach 81 through the existing engine. The hop to 43 stops with `counsel_not_reconciled` until you decide each counsel offer (`src/submission/migrate.ts:99-104, 147-165`). Those matters need your decisions before they can convert.
3. **Two computers and a sync tool.** A stale or older copy of the plugin on the second computer can recreate `submission.sqlite`. See "The second computer".
4. **Sent Writings are frozen.** Their layout, parties, recipients and signer are snapshots guarded by triggers. A converted sent Writing must render exactly as before.
5. **Other files point into this database by id.** `loose_threads.db` holds `filing_id`, `origin_job` and `charted_into` (`src/loose-threads/migrate.ts:44-46`). The page records and manifests under `0. DRAFT` hold ids too. Whether `practice.db` holds any is not checked.
6. **About 40 skill files embed SQL against the old tables** (phase-2 plan, line 45). They change in the same release as the store, or the skills break on every converted matter.

### Decisions the conversion design must make first

The migration cannot be written until these are settled:

- The target's shape, and whether its rules sit in Probanda's Cloud as the practice store's do. If they do, each matter is also seeded to the cloud, which needs a Probanda key on the computer that runs the migration. This computer holds none today.
- **Whether ids are kept.** Recommended: every row keeps its old integer id as a stable key, as the loose-threads move kept thread ids (`src/loose-threads/migrate.ts:8-11`). Then nothing outside the database needs rewriting. If ids change, the migration must write an old-to-new map and rewrite every reference in point 5 above.
- What happens to the rules engine's session state and the per-job claim rows, which are not worth carrying across.

### Procedure

A private script, run from the repo checkout and never shipped, as the practice-db migration was (`…practice-db-conversion.md:201`). The shipped plugin gets only a refusal: a matter still holding `submission.sqlite` and no `drafting.sqlite` is refused with a message naming the migration. The converter holds the old table list, which the Exception allows on your machines and which must not ship.

Each step names the check that fails if the step is wrong.

| # | Step | Check |
|---|---|---|
| 1 | **Inventory** both computers (the list above). | The two computers' lists agree on every path and SHA-256. A difference means sync is not finished, and nothing proceeds. |
| 2 | **Clear the blockers.** Resolve every split with `split_merge`. Bring every matter to version 81, with your counsel decisions where the engine stops. | The inventory, re-run, shows every matter at 81 with no `submission-*.sqlite` beside it. |
| 3 | **Freeze.** Both computers on the conversion release. Every session on every matter closed. One computer is the migrating computer. The other opens no matter until step 9. | Each computer's installed version is read from its plugin folder, with the time on `.last-complete-round`. No lock younger than 60 minutes in any matter. |
| 4 | **Snapshot before**, per matter, with the last legacy bundle: the session-entry listing, every Writing rendered (draft and sent), every job's card, the Work Board pages, the pre-filing check. | The snapshot script exits clean for every matter. A matter that fails to render before conversion is fixed or named as abandoned by you, never converted blind. |
| 5 | **Convert** in a local temp folder, never in the synced folder. Read every row, write the new store, rebuild every old row from it and compare field by field. | Zero round-trip differences. The count of items per kind equals the row count per table. `integrity_check` passes. |
| 6 | **Place and swap**, per matter, under the data lock: copy the new file in as `drafting.sqlite` with flush and rename (the `replace_live` discipline, `src/staged-store.ts:25-34`), then rename `submission.sqlite` to `submission-legacy.sqlite`. | Both files exist. The legacy file's SHA-256 equals the inventory's. An interruption before the rename leaves the original untouched. |
| 7 | **Snapshot after**, same script, new bundle, new file. | Equal to the before snapshot except differences listed in advance in the conversion plan. |
| 8 | **Wait for sync**, then inventory the second computer. | Its `drafting.sqlite` and `submission-legacy.sqlite` match the migrating computer's by SHA-256, and no `submission.sqlite` has reappeared. |
| 9 | **Live round trip** on each computer: one write and one read on a scratch matter, then on one real matter. | The write lands, the other computer reads it after sync, and no conflict copy appears. |
| 10 | **Retire the legacy files**, on your say-so, to the recycle bin: `submission-legacy.sqlite` and every `.bak-*`. They hold the old DDL, so the store cannot leave the Exception while they exist. | A search of every matter on both computers finds no file holding the old tables. Then you edit `COMMANDMENTS.md`. |

**Rollout order:** scratch copies of three real matters (one large, one with sent Writings, one below version 81), then one closed matter in place, then all matters in one sitting. Convert every matter, including closed ones. A matter left for "first use" keeps the converter and the old schema alive for years.

### The second computer

The name `submission-legacy.sqlite` is chosen on purpose. Any copy of the plugin from 0.31.4 on treats a file named `submission-*.sqlite` as a conflict copy and refuses to create or write (`src/submission/backend.ts:59-79`). So a second computer that is somehow still on an old copy refuses with a message naming that file, and does not create an empty `submission.sqlite`. A copy older than 0.31.4 has no such guard, which is why step 3 checks versions.

Two more protections belong in the new bundle:

- Its conflict guard watches `drafting-*.sqlite`, and its merge output is `drafting-merged.sqlite`.
- If `submission.sqlite` reappears beside `drafting.sqlite`, the bundle refuses and reports it. That file is either an old copy's empty create or the other computer's unsynced writes arriving late, and only you can tell which. This is the loose-threads `stray` report (`src/loose-threads/migrate.ts:29-32, 74`) made into a refusal, because here the stray may hold real work.

### Rollback

- **Before step 6:** nothing has changed. Delete the temp folder.
- **After step 6, before step 10:** per matter, under the lock, on one computer with the other frozen: remove `drafting.sqlite` and rename `submission-legacy.sqlite` back. Work done in the new store since the swap is lost unless a reverse converter exists. Commandment 8 and the phase-2 plan (line 83) ask for a tested way back, so the build includes a reverse converter proved on the fixture, or you accept that rollback is offered only until the first real write and say so.
- **After step 10:** no rollback. This is the one-way door, which is why step 10 is yours alone and comes last.

### What could make this fail

Written as if the migration had already failed, with what prevents each failure.

| Failure | Prevention |
|---|---|
| The second computer was asleep with unsent changes. It wakes after the swap and uploads its old `submission.sqlite`. | Step 1's hash comparison proves sync before anything moves. The reappearing-file refusal catches it afterwards. |
| The sync tool uploads a half-written new file. | The new file is built in a local temp folder and arrives by one rename (step 6). |
| A sent Writing renders differently after conversion, and nobody notices until it is needed in court. | Steps 4 and 7 render every sent Writing before and after and compare. Zero differences is the pass mark. |
| A matter converts with rows silently dropped, because a table was missed. | Step 5's field-by-field rebuild and per-table counts. The fixture fills every one of the 70 tables. |
| A job held by a live session is converted under it. | Step 3 refuses any lock under 60 minutes old. Older locks carry over as Ready, with their lapse recorded. |
| A matter stuck at version 42 is skipped and forgotten. | Step 2's re-run inventory must show every matter at 81. A skipped matter is named as abandoned by you in writing, or it blocks the run. |
| The migration is killed halfway through 60 matters. | Each matter is its own unit. The script re-runs from the inventory and skips a matter whose `drafting.sqlite` already passed step 7. It refuses a file that is already converted. |
| An old copy of the plugin, synced hours late, opens a matter. | Step 3's version check, and the `submission-legacy.sqlite` name. |
| The cloud is unreachable midway, if the target seeds to the cloud. | Seeding happens before the swap. A matter that is not seeded is not swapped. |
| The sync service's own version history still holds old copies after step 10. | Out of the script's reach. Note it when the store leaves the Exception. Yours to decide whether it matters. |
| A legacy `.bak-*` is restored by hand a year later. | Step 10 removes them. The new bundle refuses a legacy file by name. |

### Effort

Rough days, on top of the conversion's own build:

- inventory and hash script, with the two-computer comparison: 1
- snapshot script covering every read path: 2 to 3
- converter with the round-trip comparison: 5 to 8, depending on the target's shape
- reverse converter, if you want rollback after the first write: 3 to 4
- fixture filling all 70 tables, with sent Writings, a held job, a matter below 81 and a split: 2 to 3
- the rollout itself, with you present for steps 3 and 10: 1 to 2

About 11 to 17 days without the reverse converter, 14 to 21 with it.

## Decisions for you

1. **Private script with you present, or conversion on open by the shipped plugin.** Recommended: the private script. Conversion on open would ship the old table list and run unattended on a synced folder.
2. **All matters in one sitting, or each on first use.** Recommended: all in one sitting, closed matters included.
3. **A reverse converter, or rollback only until the first real write.** Recommended: build it. It is the only tested way back once work continues.
4. **How long the legacy files stay** before step 10. Recommended: until both computers have written and read every active matter, and at least 30 days.

## Not verified

- How many matters exist, their versions, and whether any are split. No matter was opened.
- Whether `practice.db` or any file outside `0. CASE DATA` and `0. DRAFT` refers to a drafting id.
- Which files under `0. DRAFT` only a drafting session writes.
- That old copies refuse on `submission-legacy.sqlite`. It follows from the guard's code (`src/submission/backend.ts:59-67`) and was not run.
- The `split_merge.py` behaviour cited above, which comes from an explorer's report.

## If you approve

This document moves into the repo as `docs/Plans/` beside the phase-2 plan, Stage A goes to a spec, and Stage B waits for the drafting-data conversion design, which it then joins as that plan's migration section.
