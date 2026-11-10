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
| The law | `law.sqlite`: 5 tables (authorities, their treatments, concepts, criteria); `practice.db`, kinds `rule_overlay`, `calendar_day`, `calendar_year` | per matter; per practice | typed tables (legacy); generic items | the rule overlay and the court calendar sit in the practice store, which decision 4 keeps |
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
| Know-how | each skill's shipped `references/`; in the knowledge overlay `_practice\knowledge\`, the learned `venue.md` files, `venues.local.json`, `kinds.local.json` and `_hosts.json` | shipped; per practice | files | shares the knowledge overlay with institutional knowledge, so no part of it can be shared without sorting the overlay first |
| Institutional knowledge | in the knowledge overlay, the declared `Documents\<kind>.md` type files and the `corrected` sidecar rows; `_practice\quirks\quirks.json`; `_practice\preferences\<person>.json`; the description patterns in `time_pipeline.db`'s `tedraft` namespace | per practice; per practitioner | files; generic | spread across four stores, one of them shared with know-how |
| Timekeeping records | `timecamping.db` and `time_pipeline.db` (namespaces `timeline`, `timesort`, `evidence`) | per practitioner | 12 typed tables (legacy); generic | two stores for one pool |

What the table does not show:

- `main.sqlite` also holds data that no pool names: the matter's cast (`parties`, `witnesses`, `tribunal_members`, `participant_aliases` and their links to proceedings), the `matter_metadata` row, and `housekeeping_reviews`, the record of which files file-manager's review has seen. A split of `main.sqlite` (decision 6) has to place each of them.
- The practice board shows rows of kind `event` and `todo`, but `src/tools/practice/practice-board.ts` builds them from anchors, deadlines and tasks. They are not stored kinds.
- `time_pipeline.db`'s own header comment (`src/time-pipeline/backend.ts`) still names only `timeline`, `timesort` and `tedraft`. The `/time-pipeline-data` skill's namespace table is the full list: those three, plus `evidence` and `bill`.
- **`privileged.sqlite` is not read-isolated.** `matter_data__query` copies and attaches all three matter files on every read (`src/case/backend.ts`, `do_query`), so every holder of it (among them `research-agent`, `marshal-facts` and `migration-runner`) can read client instructions. The "three-file firewall" guards write integrity, not reading. Whether those agents should read privileged material is the developer's question; decision 6's per-pool tools are where the answer would be enforced.
- `suggestions\suggestions.json` beside `probanda.json` (`src/suggestions/store.ts`) holds every suggestion this device sent or held. It is Probanda's own records (Account Information), outside the client pools, and stays outside `0. CASE DATA`.

Two facts shape everything below:

- **Three stores are legacy.** `COMMANDMENTS.md`'s Exception covers matter-data, drafting-data and timetracking-data. Each keeps typed tables, which Commandment 5 forbids, until it is converted. `practice.db` was converted on 2026-10-15 to one generic table (`docs/Plans/2026-10-14_practice-db-conversion.md`). No conversion plan exists for the other three.
- **Skills embed SQL against the legacy stores.** About 100 files in the `matter-data` skill and about 40 in `drafting-data` hold raw SQL, and `legal-research`, `apply-to-facts`, `draft` and `work` call the generic `query` or `execute` tools. A converted store has no SQL to embed, so converting one means rewriting those files to typed tools. This is the largest cost in the phase.

## Decisions for the developer

Each of these is the developer's to make before anything is built for it. Ask them one at a time, each with a worked example of what every option would produce and a "do nothing" option. Record each answer in this file under the decision.

1. **Events.** Move anchors and deadlines out of `practice.db` into a store in each matter's `0. CASE DATA` folder, or leave them practice-wide with their link to a matter. A per-matter store matches the pool's scope. It also means the morning briefing must open every matter's store to list what is due, where today it reads one file.
   **Decided 2026-11-10: the gap stays.** Anchors and deadlines stay in `practice.db`, each linked to its matter, and past events stay in each matter's `ProceduralHistory.md`. The isolation a per-matter store would give is small for dates and labels, and the briefing and practice board keep their single read of one file. Order step 3 drops out.
2. **`practice.db`.** Split it into one file per pool (practice records, billing, trust accounting), or keep one file and treat the item's kind as the pool boundary. Separate files make the boundary physical. One file keeps a time entry's link to its matter inside one store.
   **Decided 2026-11-10: one file; the item's kind is the pool boundary.** Every practice write is one cloud write applied in one local transaction from one sync stream (`src/practice/store.ts`). A split would need that stream routed by kind and, for billing, a new server key in `billing`, which is a permanent name, while billing reads the client, matter and contacts on almost every call anyway. The billing tools stay in `lawyer`'s `data` server.
3. **Trust accounting.** Give it a ledger of dated entries with a sub-ledger per client, as a regulated trust account is kept, or keep the three balance fields on the matter item. Today no record shows how a balance was reached.
   **Decided 2026-11-10: the gap stays.** The regulated ledger is the firm's trust accounting system (UNITY® Accounting), and Probanda keeps only each matter's current balances, imported from its Trust Listing export by `retainer-tracking`, whose vision puts the transaction history out of scope. A second ledger in Probanda could disagree with the books of record. A dated snapshot per import was offered and declined: no skill needs a balance history today.
4. **Court calendar days and the rule overlay.** Move them from `practice.db` to the knowledge overlay, where the other know-how lives, or leave them.
   **Decided 2026-11-10: they are the law, and they stay in `practice.db`.** Neither is know-how: the rule overlay records a court-rule change and the calendar is a court's published sitting days, so the framework now lists both under the law. In `practice.db` a year's calendar is replaced in one transaction, and a rule change keeps the cloud's contract check and the refusal of client matter codes, both of which the knowledge overlay's files lack. In the same decision the developer split the old know-how pool in two: know-how (true for any firm in the venue, and transferable) and institutional knowledge (true for this firm only, and Client Information). The table's two rows show where each sits today. Nothing moves now. Sorting the knowledge overlay between them is a precondition for ever sharing know-how.
5. **Timekeeping.** Merge `timecamping.db` and the three timekeeping namespaces of `time_pipeline.db` into one store when timetracking-data is converted, or keep two.
   **Decided 2026-11-10: merge.** The timetracking-data conversion moves `timecamping.db`'s data into `time_pipeline.db` as namespaces, `time-pipeline-data` becomes the pool's one gatekeeper and absorbs `timecamping-data`'s list, and the `timecamping_data__*` tools are retired (a minor bump). The conversion rewrites every read and write of `timecamping.db` anyway, so the merge adds only the gatekeeper merge and the retirement, and it ends `timecamping-data` writing two stores.
6. **`main.sqlite`.** Split evidence, the court record and work product into separate files when matter-data is converted, or keep one file for the matter's non-privileged data. They share many links (a fact to its source, a criterion to its facts).
   **Decided 2026-11-10: split at the plugin boundary, with per-pool tools.** The principle: a pool's seam is enforced by the tools a reader is granted, so every pool gets its own typed tools at conversion, and a separate file is needed only where a plugin boundary runs through the data, because a plugin owns a pool only when its own server serves it, and two servers do not write one file. Within one plugin, per-pool tools in one file are enough. For `main.sqlite`, evidence stays in `lawyer`'s file and server, and the pools the map gives `litigator` (work product, and the court record if `litigator` owns it) move to a `litigator`-owned file served by a new `litigator` server, whose key is a permanent name. The gain is ownership: `litigator` releases, migrates and uninstalls its own data. The cost accepted: a link across the boundary (a criterion or position to a fact) is a reference by id, checked on read, since two servers share no transaction. Still to settle in the matter-data conversion plan: who owns the court record (the map places `e-file` there, and `matter-data`'s ingest may also write positions and sought orders), and where the cast, `matter_metadata` and `housekeeping_reviews` go (the last is file-manager's run record). The same reasoning applies to drafts, served today by `lawyer`'s `drafting_data__*` tools; the drafting-data conversion plan applies it.
7. **Correspondence with others.** Give it a store, or leave it in the mailbox.

## Order

Work one store per release, cheapest and most reversible first:

1. Move the `bill` and `tedraft` namespaces to the billing pool's store. Both are generic already, so this is a copy and a change of tool family, with no conversion.
2. Whatever decisions 2, 3 and 4 settle for `practice.db`. It is generic already, so a split is a move of items by kind.
3. ~~Events, if decision 1 moves them.~~ Dropped: decision 1 keeps them in `practice.db`.
4. The three legacy conversions, smallest first: timetracking-data (12 tables, SQL in one skill), then drafting-data, then matter-data. Each needs its own plan on the pattern of the practice-db conversion, and each leaves the Exception when it complies. Decisions 5 and 6 were settled on 2026-11-10 and bind those plans. Before the matter-data plan is written, settle who owns the court record (decision 6).

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
