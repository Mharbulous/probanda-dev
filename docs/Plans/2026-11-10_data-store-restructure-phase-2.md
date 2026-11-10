# Phase 2: restructure the local stores to match the data pools

Status: planning. Nothing here is built. Run this in its own session, after Phase 1 (`docs/Plans/2026-11-10_plugin-reorganization-phase-1.md`) has landed.

The pools, their scopes and the rules for them are in `docs/Plans/2026-11-10_data-pool-framework.md`. This plan does not restate them.

## Goal

Each data pool has one store and one gatekeeper skill, and a store's scope matches its pool's scope: a per-matter pool is stored per matter, a practice pool per practice. Rule 5 of the framework gives the reason: pools are kept apart by stores, so a tool that may read one pool cannot read another by accident.

The session is done when every row of the table below reads "none" in its gap column, or the developer has decided that the gap stays and the decision is recorded here.

## Where each pool is stored today

Surveyed on 2026-11-10 at commit `b37348d7`, and checked against the data server's source and the legacy schemas at commit `9f553b7c`, after Phase 1 landed. Paths under `src/` are under `source/lawyer/mcp/src/`.

| Pool | Store today | Scope of the store | Shape | Gap |
|---|---|---|---|---|
| The law | `law.sqlite`: 5 tables (authorities, their treatments, concepts, criteria) | per matter | typed tables (legacy) | none in placement |
| Privileged communications | `privileged.sqlite`: 3 tables (privileged sources, fact provenance, client instructions) | per matter | typed tables (legacy) | none in placement |
| Evidence | `main.sqlite` (sources, facts, admissions, evidence links, source references) | per matter | typed tables (legacy) | shares a file with the court record and work product |
| Court record | `main.sqlite` (proceedings, parties of record, positions, relief, sought orders) | per matter | typed tables (legacy) | shares a file with evidence |
| Work product | `main.sqlite` (issues, causes of action, criteria applied to facts) | per matter | typed tables (legacy) | shares a file with evidence |
| Drafts | `submission.sqlite`; and `loose_threads.db` beside it (`src/loose-threads/`, ADR 0018) | per matter | 70 typed tables (legacy); generic | `submission.sqlite` also holds the rules engine's session state (`src/files/rules-position.ts` writes the position to the matter's drafting database) |
| Correspondence with others | none: the mailbox only | | | no store, by design so far |
| Events | `ProceduralHistory.md` in the matter folder (past events, `src/case/procedural-history.ts`); `practice.db`, kinds `anchor`, `anchor_source`, `deadline` | per matter; per practice | one file; generic items | split across two stores, and the deadlines sit in a practice-wide store |
| Practice records | `practice.db`, kinds `client`, `matter`, `matter_role`, `contact`, `affiliation`, `task`, `signal` | per practice | generic items | shares a file with four other pools |
| Billing | `practice.db`, kinds `time_entry`, `invoice`, `invoice_line`, `payment`, `rate`, `adjustment`; and `time_pipeline.db`, namespaces `bill` and `tedraft` | per practice; per practitioner | generic | split across two stores, one of them the timekeeping store |
| Trust accounting | `practice.db`: fields `regular_trust`, `term_trust`, `last_trust_date` on each `matter` item, and kind `retainer_notice` | per practice | generic | no ledger: balances are fields on a practice record |
| Know-how | `practice.db` kinds `calendar_day`, `calendar_year`, `rule_overlay`; the knowledge overlay folder `_practice\knowledge\`; each skill's shipped `references/` | per practice | generic items and files | court calendar days and the rule overlay sit in the practice store |
| Timekeeping records | `timecamping.db` and `time_pipeline.db` (namespaces `timeline`, `timesort`, `evidence`) | per practitioner | 12 typed tables (legacy); generic | two stores for one pool |

What the table does not show:

- `main.sqlite` also holds data that no pool names: the matter's cast (`parties`, `witnesses`, `tribunal_members`, `participant_aliases` and their links to proceedings), the `matter_metadata` row, and `housekeeping_reviews`, the record of which files file-manager's review has seen. A split of `main.sqlite` (decision 6) has to place each of them.
- The practice board shows rows of kind `event` and `todo`, but `src/tools/practice/practice-board.ts` builds them from anchors, deadlines and tasks. They are not stored kinds.
- `time_pipeline.db`'s own header comment (`src/time-pipeline/backend.ts`) still names only `timeline`, `timesort` and `tedraft`. The `/time-pipeline-data` skill's namespace table is the full list: those three, plus `evidence` and `bill`.
- Three more stores are generic files that the framework places in no pool. `_practice\quirks\quirks.json` (`src/quirks/tools.ts`) holds practice quirks: rules and facts about how this practice works, which read as know-how. `_practice\preferences\<person>.json` (`src/preferences/tools.ts`) holds each person's preferences. `suggestions\suggestions.json` beside `probanda.json` (`src/suggestions/store.ts`) holds every suggestion this device sent or held, which is Account Information and stays outside `0. CASE DATA`.

Two facts shape everything below:

- **Three stores are legacy.** `COMMANDMENTS.md`'s Exception covers matter-data, drafting-data and timetracking-data. Each keeps typed tables, which Commandment 5 forbids, until it is converted. `practice.db` was converted on 2026-10-15 to one generic table (`docs/Plans/2026-10-14_practice-db-conversion.md`). No conversion plan exists for the other three.
- **Skills embed SQL against the legacy stores.** About 100 files in the `matter-data` skill and about 40 in `drafting-data` hold raw SQL, and `legal-research`, `apply-to-facts`, `draft` and `work` call the generic `query` or `execute` tools. A converted store has no SQL to embed, so converting one means rewriting those files to typed tools. This is the largest cost in the phase.

## Decisions for the developer

Each of these is the developer's to make before anything is built for it. Ask them one at a time, each with a worked example of what every option would produce and a "do nothing" option. Record each answer in this file under the decision.

1. **Events.** Move anchors and deadlines out of `practice.db` into a store in each matter's `0. CASE DATA` folder, or leave them practice-wide with their link to a matter. A per-matter store matches the pool's scope. It also means the morning briefing must open every matter's store to list what is due, where today it reads one file.
2. **`practice.db`.** Split it into one file per pool (practice records, billing, trust accounting), or keep one file and treat the item's kind as the pool boundary. Separate files make the boundary physical. One file keeps a time entry's link to its matter inside one store.
3. **Trust accounting.** Give it a ledger of dated entries with a sub-ledger per client, as a regulated trust account is kept, or keep the three balance fields on the matter item. Today no record shows how a balance was reached.
4. **Court calendar days and the rule overlay.** Move them from `practice.db` to the knowledge overlay, where the other know-how lives, or leave them.
5. **Timekeeping.** Merge `timecamping.db` and the three timekeeping namespaces of `time_pipeline.db` into one store when timetracking-data is converted, or keep two.
6. **`main.sqlite`.** Split evidence, the court record and work product into separate files when matter-data is converted, or keep one file for the matter's non-privileged data. They share many links (a fact to its source, a criterion to its facts).
7. **Correspondence with others.** Give it a store, or leave it in the mailbox.

## Order

Work one store per release, cheapest and most reversible first:

1. Move the `bill` and `tedraft` namespaces to the billing pool's store. Both are generic already, so this is a copy and a change of tool family, with no conversion.
2. Whatever decisions 2, 3 and 4 settle for `practice.db`. It is generic already, so a split is a move of items by kind.
3. Events, if decision 1 moves them.
4. The three legacy conversions, smallest first: timetracking-data (12 tables, SQL in one skill), then drafting-data, then matter-data. Each needs its own plan on the pattern of the practice-db conversion, and each leaves the Exception when it complies. Decisions 5 and 6 are settled inside those plans.

Steps 1 to 3 do not wait for step 4.

## Constraints

- **No one-way doors (Commandment 8).** Every data move has a dry run that reports what would change, a backup taken before it runs, and a tested way back. The practice-db conversion is the pattern: it compared read snapshots before and after and found 0 differences before the old file was retired.
- **No new legacy store.** The Exception's list never grows, so any new store is generic from its first release: one table, no table or column per kind (Commandment 5).
- **Client Information stays on the user's machine (Commandment 3).** A rulebook that moves to the cloud sees only what the practice-db conversion already allows it to see.
- **No SQL or schema DDL is added to the repository.** `python scripts/check_publishable.py --new-since origin/main` must pass on every commit.
- **Version rule.** A store that an old copy of a plugin cannot read, or would damage, is a minor version bump (`CLAUDE.md`, "Releasing").
- **`matter_data__migrate` is called only by the `migration-runner` agent.**
- **Server keys and tool families are permanent names.** A new store gets a new tool family in the plugin that owns its pool after Phase 1. An existing family is not renamed.

## Out of scope

- Which plugin ships which skill: that is Phase 1.
- The design of the cloud rulebook beyond what the practice-db conversion set.
- Any edit to `COMMANDMENTS.md`: only a person edits it. When a store complies, tell the developer it can leave the Exception.

## Stop and ask

Stop and ask the developer before: building anything a decision above has not settled, running a migration against real data on any machine, and removing an old store file after a migration.

## Verification

- For each data move: the dry run's report, a read snapshot before and after with 0 differences, and a live write round trip on a scratch copy.
- `python -m pytest -q` on the changed skills' tests, and `npm --prefix source/lawyer/mcp test` with `APPDATA` set to a scratch directory.
- `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py` and `python scripts/check_publishable.py --new-since origin/main`.
- Redraw `docs/diagrams/Planned/Data-Pool-Map.html` when a pool's store changes.
