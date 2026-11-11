# Build plan: the billing time-review redesign

Status: plan only, written 2026-11-10 against `main` at `6ec81a1e`. Nothing here is built. On approval this text is saved unchanged as `docs/Plans/2026-11-10_billing-redesign-build-plan.md`, checked with `python scripts/check_publishable.py --new-since origin/main`, committed and pushed. No source file changes with it.

The spec is `docs/Specs/2026-11-10_client-billing-time-review-redesign-spec.md`. This plan does not restate it. "Criterion 7" means the spec's success criterion 7. The stores plan is `docs/Plans/2026-11-10_data-store-restructure-phase-2.md` ("Phase 2").

## Context

The practitioner decided on 2026-11-10 to move billing from a long chat to a pipeline that stores an evidenced record of every block of time, which the practitioner audits on a fixed page. The spec says what to build and leaves the order to a plan. Without an order, pieces land as stray changes: a `/bill-client` to `/bill` rename was started alone and abandoned, and its leftover now fails two checks on `main`.

This plan orders the work into 15 slices (0, 1, 1b and 2 to 13). Each slice is released alone with `/release` and leaves `main` passing every check. Each is written so a Sonnet or Haiku session can run it from its instructions (spec Goal 8).

## What the survey found

Three facts differ from what the spec or the brief assumed. Each was checked in the code.

1. **`main` fails two checks today.** `source/skills/bill/` is a tracked, byte-identical copy of `source/skills/bill-client/` (14 files, committed in `6ec81a1e`, frontmatter still `name: "bill-client"`). No plugin owns it, so `python scripts/check_layering.py` and `python scripts/check_file_ops.py` stop with "skill folder ... has no plugin in source/assignment.json". `build_plugin.py --check` and `check_publishable.py --new-since origin/main` still pass. Slice 0 repairs this.
2. **Part 4 is mostly built.** Commit `62f7da28` landed after the spec's last edit. `source/lawyer/mcp/src/time-pipeline/review-date.ts` already gives one status per date shared by every matter, a claim that refuses a second claimant and lapses after 60 minutes, and a judged mark that replaces `judged-dates.jsonl`. Saves in the `bill` and `item` namespaces must name what they read: a save naming nothing is refused with `expectation_required`, and one naming an old version with `stale_write` (`time-pipeline/backend.ts:136-168`). Missing: the fingerprint, the clear status, compare mode, the cap of 10, and a guard on `delete` and `bulk_apply` in those two namespaces (`backend.ts:182-213`).
3. **The screenshot hook needs no loosening.** `source/billing/hooks/screenshot-reader-gate.py:40-43` only limits what the reader itself opens and fixes its model and effort. A Read by any other agent passes. "Only the reader views screenshots" is skill text (`source/skills/timecamping/SKILL.md:177-178`). So the day reviewer needs a skill-text change, which the spec already decided, and no enforcer is weakened.

### Gap list

| # | Criterion (short) | Today | Evidence | Slice |
|---|---|---|---|---|
| 1 | Open any invoice line's block, all from the database | Not built. Precursor: `defend_line.py` answers from an issued invoice's frozen copy | `source/skills/bill-client/tests/test_defensible_invoice.py:108` | 11 |
| 2 | Each block records how it was settled, and no unopened approval | Partly, in the legacy store only | `source/skills/timecamping-data/references/migrations.sql:155,172` | 8 |
| 3 | A fixture per flag case | Not built. The cases are skill text | `source/skills/timecamping/SKILL.md:194-205` | 5 |
| 4 | Page from a template, opened from a file card | Not built. Reusable: `source/lawyer/mcp/src/local-page/` (7 files), `source/skills/shared/html-pages.md` | searched "review page", "time-review": none | 7 |
| 5 | Date picker, matter filter, Previous, Next, Next flagged | Not built | same search | 7 |
| 6 | Approve, Correct, Write off save, TimeCamp read back | Not built. `update_entry` exists | `source/lawyer/mcp/src/timecamp/tools.ts:106` | 8 |
| 7 | Split, merge, unmerge, unsplit | Not built | searched `merged_into`, `split_from`, `unsplit`: none | 9 |
| 8 | A day is clear exactly when no flag remains | Not built. Status has three states | `review-date.ts:184-187` | 8 |
| 9 | No model views a screenshot for the page or a split | Not built. Only capture ids are saved | `timecamping/SKILL.md:180` | 9 (saved in 3, shown in 7) |
| 10 | Resume searches only new days and open leads | Not built. The list is Markdown, parsed by `tie_out.py` | `source/skills/triage-billing-dates/SKILL.md:86` | 4 |
| 11 | A date judged for one matter is not judged again | Built at claim level | `source/lawyer/mcp/test/timekeeping-concurrency.db.test.mjs:101-104` | 6 |
| 12 | Fewer tokens on one measured bill | Not built, no baseline | spec Open points | 13 (baseline in 1) |
| 13 | Up to 10 day reviews in parallel, no questions | Not built | `timecamping/SKILL.md:268-278` | 6 |
| 14 | Time to a reviewable page well below today's | Not built, no baseline | spec Open points | 13 (baseline in 1) |
| 15 | Two bills sharing dates lose and duplicate nothing | Partly. "No duplicate proposal" is skill text only | `timekeeping-concurrency.db.test.mjs:53` | 6 |
| 16 | A crashed run's claim expires | Built | `review-date.ts:26`, `review-date.db.test.mjs:96` | 6 (kept, claim length settled) |
| 17 | A TimeCamp change after judging comes back flagged | Not built | no fingerprint in the time-review code | 10 |
| 18 | A missing evidence row is detected, cause fixed | Not built. Cause "not established" | `docs/Plans/2026-11-04_bill-client-rerun-audit.md:46,74` | 4 |
| 19 | A full re-check flags differences, changes nothing | Not built | searched "compare mode": none | 12 |
| 20 | All but the judgment runs on Sonnet, Haiku or code | Not built. Only the reader is pinned | `source/billing/agents/screenshot-reader.md:4` | 13 |
| 21 | `/bill` replaces `/bill-client` | Not built. 63 references in 23 source files | `source/assignment.json:199` | 2 |

Parts span several slices. Part 1 is slices 3, 5, 7, 8 and 9. Part 2 is slices 4 and 10. Part 3 is slice 6. Part 4 is slices 6 (cap, guards) and 12 (compare mode), with the rest already built. The Rename is slice 2.

### The older billing specs

All were read in full. The redesign fully replaces none.

| Spec | Built? | Does the redesign replace it? |
|---|---|---|
| 2026-11-03_defensible-time-entries | Partly. Open: re-runs that create no duplicate proposals (`timecamping-data/SKILL.md:144`) | Partly. The page replaces the in-chat sort and vet. The evidence chain, `line_map.json`, the frozen copy, `defend_line.py` and the locks stay, and criterion 1 builds on them. Slice 6 closes the duplicate gap for the new path |
| 2026-11-03_bill-style-time-descriptions | Built (`vet-billable-time/tests/test_bill_style.py`) | Partly. The style text stays the one source and the day reviewer preloads it |
| 2026-11-03_billing-workbook-adjustments-and-chart-script | Built as narrowed | No. Its folder moves with the rename |
| 2026-11-03_record-client-bill-and-letter-sent | Built for bills. The letter part was superseded by ADR 0019 | No |
| 2026-11-03_trust-application-instruction | Built in `/issue-invoice` | No |
| 2026-11-03_retainer-top-up-follow-up | Built | No |
| 2026-11-03_firm-invoice-template-and-style-guide | Built | No |
| 2026-11-03_cso-submission-sheet-disbursements | Built | No |
| 2026-11-03_call-log-store | Built | No. The gather step uses it |
| 2026-11-03_call-log-any-provider | Not built | No. Out of scope here. Calls after about 2026-08-31 stay missing from the evidence |
| 2026-10-15_timecamp-api-connector | Built | No. The page relies on `update_entry` |
| 2026-10-15_timekeeper-plugin | Built, then replaced by `billing` | No |

The other 2026-11-03 specs (contacts, client letters, research, note-up) were read and owe nothing to this plan.

## Decisions this plan makes

### Where each store change lands

Every store change is built now, on `time_pipeline.db`, as records in its `item` namespace whose `kind` is a value. None waits for the timetracking-data conversion, and none adds a table or column to `timecamping.db`.

Why: `item` already holds `review_date:<date>` records this way, so the shape is proven and adds no schema DDL (the check `check_publishable.py` would refuse new DDL). `timecamping.db` is a legacy store under the Exception in `COMMANDMENTS.md`, and no revision may rely on that Exception more. Waiting for the conversion would block every slice behind a plan that does not exist yet.

| Store change (spec section) | Record kind in `item` | Slice |
|---|---|---|
| Screenshot readings and later answers (Part 1) | `capture_reading`, keyed by capture id | 3 |
| Candidate list, one row per date (Part 2) | `candidate_date`, keyed by matter and date | 4 |
| The assembled day's evidence rows (Part 3) | `day_evidence`, each row labelled with its source | 5 |
| Blocks with state, flag reasons, acts and links (Part 1) | `block` | 5 |
| Fingerprint of a judged day (Part 2) | a field on the existing `review_date` record | 10 |
| Clear status (Part 4) | not stored: derived from the day's blocks | 8 |
| Compare-mode result (Part 4) | `day_recheck` | 12 |

What stays in `timecamping.db` until the conversion: the seven source tables, the fetch log and the gate query, which `/build-timeline` writes today and the gather step keeps using unchanged. The new path stops writing `proposals` and `determinations` at slice 11. The conversion, under its own plan, then has less to move.

Commandment 5 check on these shapes: a kind is a value, never a namespace or table. A merge or split link is one entry in a `links` list whose `role` is a value (`merged_into`, `split_from`), not a field per role. Evidence is a list of rows each labelled with its source, not a field per source. Flag reasons are values in a list. Question 6 asks the practitioner to confirm this reading.

### The rename goes first among the build slices

Slice 2, right after the repair and the baseline.

- **What it gives.** Criterion 21. Every later slice writes its new skill text, agent, tools and tests against one name. Done last, every file added in slices 3 to 12 would be edited a second time.
- **What it costs.** One mechanical change to 23 source files. Seven references break a test or check if missed (listed in slice 2). Typing `/billing:bill-client` stops working, so it is a minor bump. A bill under way keeps files in a working folder named `bill-client`.
- **The tested reason.** The references were counted by search and the checks were run. The closed list of breaking references is small and touches no file that slices 3 to 12 change in conflicting ways, so going first risks no rework. The abandoned attempt shows the cost of the alternative: a half rename fails `check_layering.py` today. Going with the page (slices 7 to 11) would mix a mechanical change into the largest diffs.
- **The bill under way.** Bill-record rows store paths relative to the matter folder, so a resumed bill keeps the working folder its record names. Only a new bill uses `bill\`. No file is moved, so no ruling in `source/file-ops.json` is needed.

### Open points

| Open point | Whose | Resolution or recommendation |
|---|---|---|
| Sequencing with Phase 2 | this plan | Decided above: build on `time_pipeline.db` now |
| The page in Cowork | practitioner | Recommend: the page is PC-only, and in Cowork `/bill` stops where it stops today (Step 6.2) and says why. Question 3 |
| How the page gets images | this plan | The page's local listener serves each image on request, decrypted for that request, and writes no new decrypted copy. Slice 7 starts with a spike on `source/skills/timecamping/reference/SyncoPaidCaptures.md`. If the listener cannot decrypt, fall back to the PNGs already kept in the `syncopaid-screens` folder |
| Table changes against Commandment 5 | practitioner confirms | Shapes above. Question 6 |
| How page records reach the tie-out | this plan | A script exports the blocks to the `vetted.json` shape that `tie_out.py` reads today, as `review_date__export` already does for judged dates. `tie_out.py` and `render_invoice.py` keep their inputs |
| Presumption counts across parallel days | this plan, unless the practitioner objects | Each day reviewer gets the approved presumptions as they stood when the run began and offers none. After all days are judged, a script counts confirmations in date order from the stored blocks, and offers appear as their own list after the review |
| Claim length | practitioner | Recommend keeping 60 minutes: it is built, tested and renewed during work. Question 4 |
| The baseline for criteria 12 and 14 | practitioner | Slice 1. Question 1 |

## Every slice ends the same way

Run these, in this order, and fix what fails before releasing. Model: Haiku runs them and reports each exit code.

1. `npm --prefix source/lawyer/mcp run build`, then `run bundle`, only when MCP source changed.
2. `python scripts/build_plugin.py`, then `python scripts/build_plugin.py --check`. On `WinError 5`, re-run until `--check` is clean.
3. `python scripts/check_plugin.py`, `python scripts/check_layering.py`, `python scripts/check_file_ops.py`, `python scripts/check_public_tree.py`.
4. `python scripts/check_publishable.py --new-since origin/main`.
5. `python -m pytest -q` on each touched skill's `tests/`, on `source/billing/tests` and on `scripts/tests`.
6. The MCP tests with `APPDATA` set to a scratch directory, when MCP source changed.
7. `/release`, which bumps each plugin whose built folder changed.

Stop and ask the practitioner before: adding or changing a ruling in `source/layering.json` or `source/exception-rulings.json`, running anything against real client data, weakening any hook or gate, or proposing a change to `COMMANDMENTS.md`. Nothing in this plan goes into `public/`.

## The slices

### Slice 0: repair `main`

- **Changes.** Remove the tracked copy `source/skills/bill/` (14 files). It is not built into any plugin, so no built folder changes.
- **Tests.** `check_layering.py` and `check_file_ops.py` exit 0. `build_plugin.py --check` reports all eight plugins current.
- **Bump.** None.
- **Practitioner.** Nothing. Skip this slice if the practitioner has already removed the folder.
- **Model.** Haiku.

### Slice 1: measure one real bill the current way

- **Changes.** One maintainer script, `scripts/measure_bill_run.py`, with a test under `scripts/tests/`. Given the paths of a run's session transcripts, it prints numbers only: tokens in and out for the main session and each subagent, the count of subagents, the count of questions asked of the practitioner, and the minutes from the first message to a named marker. It reads no client content and is not shipped in any plugin.
- **The run.** The practitioner runs one real bill with the released build, from `/bill-client` to "ready for signature". The marker for criterion 14 is the moment every candidate date is judged and the first line is ready to vet, which is today's equivalent of a reviewable page. Before the run, back up `time_pipeline.db` and `timecamping.db` so slice 13 can replay the same matter and period.
- **The record.** A "Baseline" section added to this plan: the numbers, the count of candidate dates and the build versions. No matter name, client name or path.
- **Tests.** The script's unit test on a synthetic transcript.
- **Bump.** None.
- **Practitioner.** Answers question 1, then runs the bill. This slice touches real client data, so it starts only on the practitioner's word.
- **Run under way.** The practitioner started the baseline run on 2026-11-10 with `/billing:bill-client` (billing 0.3.0), the session running on Sonnet 5.5. The matter is the practitioner's choice and is recorded outside this repository. The first part ran in Cowork, refreshed the candidate list (55 dates: 23 Strong, 8 Medium, 24 Weak) and stopped at Step 6.2, before any date was judged, as Cowork does today. Both stores were then copied, byte for byte, into a `baseline-2026-11-10` folder beside them, after the list was refreshed and before any date was judged or any TimeCamp entry corrected. Slice 13 replays from that copy. The measured run is the continuation in a Code-tab session on the PC. Its earlier judgments were redone, not reused, so both runs do the same work. A full run proved too costly in the practitioner's attention, so on 2026-11-10 the practitioner limited the baseline to a sample of two dates, judged and then stopped. The matter and the two dates are in a note in the copy's folder, not here. Slice 13 replays exactly those two dates, and both runs are compared per date. Slice 13 runs its orchestrator on Sonnet 5.5 too, so the model is the same in both measurements.
- **Model.** Sonnet writes the script. Haiku runs it.

### Slice 1b: find the last invoice from the practice records, not file names

Decided by the practitioner on 2026-11-10 (question 7). `/bill-client` Step 2 stops the bill and asks the practitioner to run `/housekeeping`, a `file-manager` skill, so that Step 3 can find the last invoice by sorting file names. The practice records already hold every invoice `/issue-invoice` issued, and Step 5 already distrusts file names. So the bill finds the last invoice from the records first, `billing` stops naming `file-manager`, and one stop that needs the practitioner goes.

- **Changes.**
  - `source/skills/bill-client/SKILL.md` Steps 2 to 5 and their rows in the step table. Keep the step numbers, so bill-record rows and the resume rule ("Steps 2 to 5") still match. The new order: look up the matter's last invoice with the `practice-data` skill's `invoice-data` operation, and read that PDF as Step 4 does. Only when the records hold no invoice for the matter, or the folder holds a signed invoice newer than the latest recorded one, list the invoice files in `2. SOLICITOR CLIENT`, read the newest as Step 4 does, verify and record it as Step 5 does. When it still cannot tell which file is the last signed invoice, ask the practitioner that one question. Remove every mention of `/housekeeping`, the housekeeping-log lookup and `file-manager` from the skill.
  - Delete the ruling at `source/layering.json:63` (`source/skills/bill-client/SKILL.md` → `housekeeping`). The practitioner approved this deletion on 2026-11-10. Add or change no other ruling.
- **Files.** `source/skills/bill-client/SKILL.md`, `source/layering.json`, a test in `source/skills/bill-client/tests/`, and any other file under `source/skills/bill-client/` that names the old Step 2.
- **Tests.** A new test that fails if any file under `source/skills/bill-client/` names `housekeeping` or `file-manager`. `check_layering.py` exits 0 with one fewer ruling and no stale ruling. The skill's existing tests pass. The standard checks.
- **Bump.** `billing` patch: a bill under way resumes as before, and no tool or input changes.
- **Practitioner.** Nothing more.
- **Model.** Sonnet.

### Slice 2: rename `/bill-client` to `/bill`

- **Changes, all in one commit.**
  - Move the folder `source/skills/bill-client/` to `source/skills/bill/` and set `name: "bill"` in its `SKILL.md`.
  - `source/assignment.json:199` and `source/billing/roster.json:3`.
  - The references that break a check or test: `source/skills/issue-invoice/SKILL.md:19` (the path to `freeze_invoice.py`), `source/skills/time-pipeline-data/SKILL.md:113` with the regex in `tests/test_bill_record_wiring.py:15`, `test_bill_record_wiring.py` (its `text("bill-client")` reads), `test_defensible_invoice.py:25` and `scripts/check_plugin_baselines/skill_source_baseline.json:20`. The ruling that named this skill in `source/layering.json` is gone after slice 1b, so the rename touches no ruling. Run `check_layering.py` first: if any ruling still names `source/skills/bill-client/`, stop and ask the practitioner.
  - Prose in the other shipped files: `issue-invoice`, `timecamping` (`SKILL.md` and `VISION.md`), `triage-billing-dates`, `vet-billable-time`, `time-pipeline-data`, `source/billing/README.md`, the two files under the skill's `references/`, and the comment at `source/lawyer/mcp/src/tools/practice/reads.ts:116`.
  - One new sentence in the skill: a resumed bill keeps the working folder its record names.
  - The diagrams: `docs/diagrams/Built/Client billing.html`, `Client billing process.md`, both `Progressive-Context-Tree.html` files, `Destinations/Client_billing.html` and `Destinations/Data-Pool-Map.html`, each with its commit tag updated. Older plans and specs keep the old name, because they record history.
  - `CLAUDE.md` if it names the skill.
- **Tests.** A new test in `source/skills/bill/tests/` that fails if any file under `source/skills/` or `source/billing/` holds the text `bill-client`, apart from the one working-folder sentence. The 103 existing tests of the skill pass from the new folder. The standard checks.
- **Bump.** `billing` minor, 0.3.0 to 0.4.0, because a command the practitioner types stops working. `lawyer` patch only if the comment change alters its bundle.
- **Practitioner.** After release, types `/billing:bill`. Slice 1b lands first.
- **Model.** Haiku for the search and replace, Sonnet for the new test and the diagrams.

### Slice 3: save the screenshot readings

- **Changes.** `/timecamping` Step 5 and `/triage-billing-dates` Phase 2 save each capture's reading, as the reader reported it, in a `capture_reading` record keyed by capture id, through the existing `time_pipeline__set` with `expect_absent`. A later answer about a capture is appended to the same record with `expect_sha256`. Before dispatching the reader, the skill looks up the record and skips a capture already read. `time-pipeline-data/SKILL.md` lists the kind. No new tool.
- **Files.** `source/skills/timecamping/SKILL.md`, `source/skills/triage-billing-dates/SKILL.md`, `source/skills/time-pipeline-data/SKILL.md`, `source/billing/agents/screenshot-reader.md` only if its report format needs a stable shape.
- **Tests.** A database test in `source/lawyer/mcp/test/`: a reading saved twice is refused the second time, and an appended answer keeps the first reading. A wiring test in `source/skills/timecamping/tests/` that Step 5 names the save and the lookup.
- **Bump.** `billing` patch.
- **Practitioner.** Nothing.
- **Model.** Sonnet.

### Slice 4: the candidate list lives in the store and grows

- **Changes.**
  - `/triage-billing-dates` saves one `candidate_date` record per date: strength, Lawyer or Staff, flags, when found, and the keys of its evidence rows. It also saves, per matter, the last covered date and the leads left open.
  - A script generates the `Candidate dates` file in `BILLING` from those records. A second script writes the export `tie_out.py` reads, so no run parses the Markdown.
  - A resume searches every source for days after the last covered date, plus each open lead for the whole period, and runs the activity scan on the new days only.
  - The lost-save detector: the skill's last step counts the evidence rows each listed date cites. A date with a missing row is searched again alone, and the practitioner is told.
  - The 2026-11-04 loss. Its cause cannot be recovered, because no log of that run exists. The slice closes each cause the audit left open: the save names its tool, key and row shape in the skill itself, not three skills away, and the detector above reports a save that did not land.
  - `/bill` "The status" and its resume rule: Steps 6 to 9 no longer rebuild the list. The wording rule stays.
- **Files.** `source/skills/triage-billing-dates/` (skill, two new scripts, tests), `source/skills/vet-billable-time/scripts/tie_out.py` and `tests/test_tie_out.py`, `source/skills/bill/SKILL.md`, `source/skills/time-pipeline-data/SKILL.md`.
- **Tests.** Script tests: the generated file matches a fixture, a resume plan for a fixture list names only the new days and open leads, and a list with one missing evidence row reports that date. `test_tie_out.py` reads the export.
- **Bump.** `billing` patch. A bill under way has no records yet, so its first resume searches the whole period once, as today.
- **Practitioner.** Answers question 5 before the slice is called done.
- **Model.** Sonnet.

### Slice 5: block records and the flag rules

- **Changes.** A new tool family on `billing`'s `timekeeping` server, over `time_pipeline.db`:
  - a save for a day's `day_evidence` rows (the gather step's output),
  - a stage tool that takes one day's blocks from a reviewer and refuses a day another holder has claimed, and refuses a day whose `day_evidence` record is not saved with every source through the gate, so no block is ever judged on part of the evidence,
  - a read of one day.
  - Each staged block states the basis of its matter and of its description as values from a fixed list drawn from the spec's "What is flagged". Code, not the model, sets the block flagged or auto-assigned from those values. A reviewer cannot stage an unflagged block that states a doubt.
- **Files.** New `source/lawyer/mcp/src/time-review/` (records, flag rules, tools), `src/schema/`, `timekeeping-dispatch.ts`, tests in `source/lawyer/mcp/test/`, `source/skills/time-pipeline-data/SKILL.md`.
- **Tests.** One fixture per flag case in the spec, each producing a flag, and one where the evidence names the matter producing none (criterion 3). A second stage of a judged day is refused. A stage for a day with no saved evidence, or with a source short of the gate, is refused. The bundle contract test lists the new tools.
- **Bump.** `billing` patch: new tools, nothing uses them yet.
- **Practitioner.** Answers questions 2 and 6 before the slice starts, because a tool family name is permanent.
- **Model.** Sonnet. The fixed list of basis values is written into this slice's ticket before the build, by the planner, from `timecamping/SKILL.md:194-205` and `vet-billable-time/SKILL.md` Steps 5 and 6.

### Slice 6: gather, pick, read and judge in parallel

- **Changes.**
  - A gather script that orders the candidate dates and drives `/build-timeline` one date at a time through the seven-source gate, then saves the day's evidence rows.
  - A screenshot-pick script: for each stretch, the first, a middle and the last capture, and each capture where the window title changes.
  - A new agent `billing:day-reviewer`, on Opus 5.5 at high effort. Its body is its procedure only. It preloads `/timecamping`'s inference reference and presumptions and the bill-style text through `skills:`. It holds the day read, the stage tool and `Read`, and no TimeCamp tool. It returns one status line and an `end:` line.
  - `/timecamping`'s candidate-list section gains a parallel mode: claim each date, dispatch at most 10 reviewers at once, strongest first, renew claims, and mark a date judged when its blocks are staged. A date another bill holds is skipped and picked up when judged.
  - The skill-text rule on who views screenshots changes to: the reader first, and the day reviewer only after the reader's answers leave doubt. No hook changes.
  - `delete` and `bulk_apply` in the `bill` and `item` namespaces must name what they read.
  - The parallel mode is not yet called by `/bill`. That switch is slice 11.
- **Files.** `source/billing/agents/day-reviewer.md`, `source/assignment.json`, `source/billing/roster.json`, `source/skills/timecamping/` (skill, two scripts, tests), `source/lawyer/mcp/src/time-pipeline/backend.ts` and its tests.
- **Tests.** Script tests for the order and the pick. A database test: two bills sharing dates stage each date once and no block is duplicated (criteria 11 and 15). The existing claim-expiry tests stay (criterion 16). A test that a `delete` naming nothing is refused in `bill`. A recorded run on fixture days, not client data, showing 10 at once and no question asked (criterion 13).
- **Bump.** `billing` patch if the guard on `delete` and `bulk_apply` breaks no shipped caller. Minor if any shipped skill calls them unguarded in those namespaces, which the slice checks first.
- **Practitioner.** Nothing.
- **Model.** Sonnet builds. The agent's body is drafted with the prompt-engineering rules and reviewed once by a stronger model, because it is the one judgment prompt in the pipeline.

Slice 6 built: billing 0.4.4, commit cc58f7ed.

### Slice 7: the review page, read-only

- **Changes.** A fixed HTML template under `source/skills/timecamping/`, filled by the `timekeeping` server from the store and served by the local-page listener, as `/housekeeping`'s approval page is. Cards show matter, description, times, state and evidence rows, with the screenshot slideshow and each saved reading. Navigation: date picker, matter filter, Previous, Next, Next flagged. Two tools: serve the page and return its file card, and wait for a click. No action buttons yet.
- **Files.** `source/lawyer/mcp/src/time-review/page.ts` and the template, reuse of `source/lawyer/mcp/src/local-page/`, `bundle.mjs` if the template must be bundled, `source/skills/timecamping/SKILL.md`, `source/skills/shared/html-pages.md` only by reference.
- **Tests.** The page built from a fixture day matches a stored snapshot. A test that Next flagged honours the matter filter. A test that the build calls no model and reads no image file (criteria 4 and 5).
- **Bump.** `billing` patch.
- **Practitioner.** Answers question 3. After release, can open a judged day's page to look.
- **Model.** Sonnet. The practitioner sees a mock-up of one card before the template is fixed.

Slice 7 built: billing 0.4.5, commit 9687aa7c.

### Slice 8: Approve, Correct and Write off

- **Changes.** The three buttons write through the listener to the block: the act, who, when and, for a write-off, the reason. A block records an approval only from a click on that block. The waiting session then writes a changed matter or description to TimeCamp with `update_entry`, re-reads the entry, and saves "saved to TimeCamp" or the error to the block. A staff entry's TimeCamp note is left alone. A day reads as clear when it is judged and no block on it is flagged.
- **First step.** Read the approval gate (`source/skills/shared/tests/test_approval_gate.py:366` names `update_entry`). If the gate would refuse a write made on a click, stop and ask the practitioner, naming what would no longer be enforced.
- **Files.** `source/lawyer/mcp/src/time-review/`, the template, `source/skills/timecamping/SKILL.md` (the wait loop), tests.
- **Tests.** Each act saves and is shown. An approval of one block leaves another flagged. A failed read-back shows on the card. A day with one flagged block is not clear (criteria 2, 6 and 8).
- **Bump.** `billing` patch.
- **Practitioner.** Nothing, unless the gate question arises.
- **Model.** Sonnet. The wait loop itself runs on Sonnet.

Slice 8 built: billing 0.4.6, commit 82298b21.

### Slice 9: split, merge and their undo

- **Changes.** Split at a chosen screenshot makes two new flagged blocks. The waiting session redrafts both from the stored evidence and readings. Merge joins descriptions with "; " by script and makes one new block. Originals are kept and linked by a `links` entry. Unmerge and unsplit restore the originals, flagged, and are refused once the time is on an issued invoice. TimeCamp is not touched.
- **Tests.** Merge output for a fixture. Undo returns records equal to the originals. Undo after issue is refused. A test that the split path dispatches no reader and opens no image (criteria 7 and 9).
- **Bump.** `billing` patch.
- **Model.** Sonnet.

Slice 9 built: billing 0.4.7, commit 69667e4b.

### Slice 10: the fingerprint

- **Changes.** When a day is judged, its `review_date` record saves a fingerprint of the day's TimeCamp entries (id, start, end, task, note). On resume, the session passes each judged day's current entries to a compare tool. A changed, added or removed entry returns its block to flagged, or adds a flagged block, and the day is no longer clear. Other blocks keep their approvals.
- **Tests.** One changed entry among five flags one block and keeps four approvals (criterion 17).
- **Bump.** `billing` patch.
- **Model.** Sonnet.

Slice 10 built: billing 0.4.8, commit 718ca5e7.

### Slice 11: `/bill` runs on the pipeline

- **Changes.** `/bill` Step 6 calls gather, pick, read, judge and the page in place of the in-chat day review and line vetting. Only flagged blocks need action before the draft. A script exports the blocks to the shape `tie_out.py` reads, and `line_map.json` gains each line's block id, so an invoice line opens its block on the page. A date judged in chat before this slice has no blocks, so the orchestrator has it judged once more to build them. The in-chat `/timecamping` review remains for work outside a bill and reads the same know-how. Redraw `docs/diagrams/Built/Client billing.html` and `Client billing process.md`.
- **Files.** `source/skills/bill/SKILL.md`, `source/skills/vet-billable-time/` (skill, export script, `tie_out.py`, tests), `source/skills/practice-data/scripts/defend_line.py`, the diagrams.
- **Tests.** The export of a fixture day passes `tie_out.py final`. A line of a fixture invoice resolves to its block (criterion 1). The standard checks.
- **Bump.** `billing` minor, because the bill's review moves from chat to the page.
- **Practitioner.** After release, runs the next bill through the page.
- **Model.** Sonnet.

Slice 11 built: billing 0.5.0, commit b6c39e3c.

### Slice 12: re-check on request

- **Changes.** For one date or a whole bill, a fresh day reviewer judges in compare mode. Its result is saved as a `day_recheck` record. Where it differs from the stored block, the block is flagged. No stored judgment is overwritten.
- **Tests.** A fixture with one differing block flags one block and leaves every stored record's hash unchanged (criterion 19).
- **Bump.** `billing` patch.
- **Model.** Sonnet.

### Slice 13: measure again and prove the cheap-model run

- **Changes.** None to source. Replay the slice 1 matter and period on the new build with `scripts/measure_bill_run.py`, as a replay on restored copies of the two stores with TimeCamp writes off (question 1, decided 2026-11-10). Record the numbers beside the baseline. The run uses Sonnet and Haiku for every step but the day reviewer, and the record states whether a stronger model stepped in.
- **Tests.** Criterion 12: fewer tokens than the baseline. Criterion 14: fewer minutes to a reviewable page. Criterion 20: the recorded run completes on those models.
- **Bump.** None.
- **Practitioner.** Runs the review on the page. This slice touches real client data, so it starts only on the practitioner's word.
- **Model.** Sonnet orchestrates.

## Baseline

Measured on 2026-11-10 by `python scripts/measure_bill_run.py`, from the measured run's main transcript and its one subagent transcript (slice 1, "Run under way"). Build: billing 0.3.0, run with `/billing:bill-client`. Sample: 2 dates, judged and then stopped. Slice 13 replays the same 2 dates and compares per date.

| Measure | Main session | Subagent | Total |
|---|---|---|---|
| Messages | 67 | 7 | 74 |
| Tokens in | 21,322,289 | 1,040,525 | 22,362,814 |
| of which fresh input | 134 | 14 | 148 |
| of which cache writes | 707,075 | 198,975 | 906,050 |
| of which cache reads | 20,615,080 | 841,536 | 21,456,616 |
| Tokens out | 109,332 | 13,148 | 122,480 |

By model, across the run: Sonnet 5.5 took 21,656,743 tokens in and 119,315 out. Opus 5.5 answered part of the main session, with 706,071 tokens in and 3,165 out. The subagent ran on Sonnet 5.5 only. Slice 13 reports the same split, for criterion 20.

- Subagents: 1 (one `Agent` call in the main session).
- Questions asked of the practitioner: 1 (one `AskUserQuestion`, no `wrap_up` with a question). A question asked in plain text is not counted.
- Messages the practitioner typed: 10.
- Minutes from the first message to the last: 110.8. This spans the whole session, not the slice 1 marker (every date judged), which the script does not detect. Slice 13 measures the same span.

## Deferred

- **Screenshot choice at capture time.** The spec places it in the SyncoPaid repo. Slice 6's script is the interim.
- **The timetracking-data conversion.** Phase 2 step 4, under its own plan. This plan leaves it less to move.
- **Call logs from any provider.** Its own spec, not built.
- **The 2026-11-03 specs' own changes.** Out of scope.

## Verification of this plan

Verified by running or reading: `check_layering.py` fails on `main` with the message quoted above. `build_plugin.py --check` reports all eight plugins current. `check_publishable.py --new-since origin/main` reports no new problems. `git ls-files source/skills/bill` lists 14 tracked files. The spec, Phase 2, the re-run audit, `Client billing process.md`, `source/billing/plugin.json` and `timecamping/SKILL.md` lines 160 to 284 were read in full by the planning session. The remaining file and line citations come from three read-only research passes and were not re-read line by line. No test was run.

Assumed, to be checked in the slice named: that the listener can decrypt a capture on request (slice 7), that the approval gate allows a write on a click (slice 8), and that no shipped skill calls `delete` or `bulk_apply` unguarded in `bill` or `item` (slice 6).

## Questions for the practitioner

Each is asked alone, with a worked example of every option and a "do nothing" option, before the slice that needs it.

1. **Baseline (slice 1).** Which matter and period is measured, and may the second measurement be a replay on restored copies of the two stores with TimeCamp writes off? Recommended: yes, a replay, because the real bill cannot be held unissued for the length of the build. **Decided 2026-11-10: a replay.** The matter and period are still to be named.
2. **Tool family name (slice 5).** The new tools on the `timekeeping` server need a permanent family name. Recommended: `time_review__`. **Decided 2026-11-11: `time_review__`.**
3. **Cowork (slice 7).** Recommended: the page is PC-only and `/bill` stops in Cowork where it stops today. **Decided 2026-11-11: PC-only, and `/bill` in Cowork stops and says why.** Also decided: slice 7 builds its card template from the spec without a mock-up first, and the practitioner reviews the real page after release.
4. **Claim length (slice 6).** Recommended: keep the built 60 minutes, not the spec's example of 2 hours. **Decided 2026-11-11: keep 60 minutes.**
5. **Criterion 18 (slice 4).** The cause of the 2026-11-04 loss cannot be found, because no log exists. Is closing every open cause, plus a detector, accepted as meeting it? **Held on 2026-11-11, pending a check on the practitioner's other computer.** The practitioner's theory: the run happened on another computer, whose copy of `time_pipeline.db` never synced, or was overwritten by this computer's copy. On this computer the store holds evidence rows saved on 2026-11-06 and 2026-11-07 only. If the other computer's store holds that run's rows, the cause is two computers writing one SQLite file in a synced folder, and a slice that prevents that overwrite goes in before slice 5. If not, the question is asked again as written.
6. **Commandment 5 (slice 5).** Confirm the record shapes under "Where each store change lands". **Decided 2026-11-11: confirmed.**
7. **`source/layering.json` (slice 2).** Approve changing the existing ruling's path from `source/skills/bill-client/SKILL.md` to `source/skills/bill/SKILL.md`, with its content unchanged. **Decided 2026-11-10: neither.** The skill's only use of `file-manager` was finding the last invoice by file name, so slice 1b finds it from the practice records instead and deletes the ruling, which the practitioner approved.
