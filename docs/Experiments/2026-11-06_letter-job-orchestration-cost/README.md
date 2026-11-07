# Letter job with phase steps: cost with and without the orchestration section

The same plan is run twice from commit `4f0251aa`, each run on its own branch, and the token-adjusted cost of each run is compared. The method copies `docs/Experiments/2026-11-06_cast-orchestration-cost/` on branch `exp/cast-orchestrated`.

| Variant | Plan file | Branch | Cost (USD) |
|---|---|---|---|
| Without orchestration | `plan-without-orchestration.md` | `exp/letter-unorchestrated` | **3.24** |
| With orchestration | `plan-with-orchestration.md` | `exp/letter-orchestrated` | **6.60** |

`plan-with-orchestration.md` is `plan-without-orchestration.md` plus an `## Orchestration` section drafted by the `context-engineering:context-architect` agent (advise mode). Its own sizing says to expect roughly break-even for a change this small.

This copy of the README is on `exp/letter-orchestrated`. The plan files and `session_cost.py` are on `exp/letter-unorchestrated`.

## How cost is measured

`session_cost.py` reads a session's transcript and every subagent transcript beside it, counts each API response once (by message id) and prices its tokens per model. It is the Cast experiment's script with two added options, `--since` and `--until`, that keep only transcript lines inside a UTC time window. The prices are the claude-api skill's table, cached 2026-10-06, per million tokens:

| Model | Input | Output | Cache read |
|---|---|---|---|
| claude-opus-5-5 | 4.00 | 20.00 | 0.20 |
| claude-sonnet-5-5 | 2.00 | 10.00 | 0.20 |
| claude-haiku-5-5 | 0.10 | 0.50 | 0.01 (assumed) |
| claude-fable-5-1 | 10.00 | 50.00 | 0.25 |

Cache writes use the standard multipliers on input: x1.25 for a 5-minute write and x2 for a 1-hour write. "Token-adjusted" means every token is weighted by its price.

## The run without orchestration (2026-11-06)

One session (Opus 5.5) did all the work itself, with no subagents. Priced from the moment execution started (04:38:33Z to 04:52:54Z UTC, 2026-11-07):

| Transcript | Model | Calls | Input | Output | Cache read | Cache write | USD |
|---|---|---|---|---|---|---|---|
| main | claude-opus-5-5 | 61 | 122 | 29,776 | 9,653,712 | 89,315 | 3.24 |
| **Total** | | | | | | | **3.24** |

Wall time: 14 min 21 s. Commit `dc44f841` on `exp/letter-unorchestrated`. Its departures, verification and gaps are recorded in that branch's README.

## The run with orchestration (2026-11-06)

A fresh Opus 5.5 session ran `plan-with-orchestration.md`. It created the worktree, dispatched two Sonnet workers in parallel (slice A: skill text and diagram, slice B: server code), then ran the gate, the build and the commit itself. The gate found one failure between the two slices, which went to a fresh Sonnet worker. A second fresh Sonnet worker diagnosed the golden test failure described below.

```
python session_cost.py ~/.claude/projects/<project>/<session-id>.jsonl
```

| Transcript | Model | Calls | Input | Output | Cache read | Cache write | USD |
|---|---|---|---|---|---|---|---|
| main | claude-opus-5-5 | 30 | 60 | 13,396 | 3,202,799 | 94,813 | 1.67 |
| Slice A: skill text and diagram | claude-sonnet-5-5 | 43 | 88 | 41,023 | 5,503,706 | 166,129 | 1.93 |
| Slice B: server code and tests | claude-sonnet-5-5 | 46 | 100 | 35,003 | 6,507,521 | 153,416 | 2.04 |
| Fix jobs-stock.md title count | claude-sonnet-5-5 | 13 | 28 | 3,242 | 917,808 | 82,275 | 0.42 |
| Diagnose golden board test failure | claude-sonnet-5-5 | 13 | 26 | 7,074 | 1,034,418 | 106,819 | 0.54 |
| **Total** | | | | | | | **6.60** |

Wall time: about 38 min (05:03:47Z to 05:42:22Z UTC, 2026-11-07), from the first message to pricing. The main session's few calls after pricing (this README, the push) are not counted.

**Result.** Orchestration cost about twice as much as the single session ($6.60 against $3.24) and took over twice as long. The orchestrator itself cost $1.67, about half the plain run. Each Sonnet slice cost about $2, more than the orchestrator: the large files were still re-read on every worker call, now in two contexts instead of one. The two gate-failure workers added $0.96.

**Why the extra work.** Slice A wrote a paragraph in `jobs-stock.md` that opens with a bold, backticked title. The test that matches `STOCK_TITLES` to that file's bold titles then counted 14 titles instead of 13. Neither worker could see the other's work, so the conflict surfaced only at the gate. The single session would have seen it at once.

### Commit

`14d68d42` on `exp/letter-orchestrated`: skill text, server code, tests, diagram and the rebuilt `plugins/litigator/`.

### Departures from the plan

The same three as the run without orchestration: no release, bump, push to `main` or `dist/` bundle; only test files changed in the last 24 hours ran (the hook); `prepare/SKILL.md:92` needed no edit.

### Verified (run by the orchestrator, not taken from worker reports)

- `npm run build` clean.
- `sent-write.db.test.mjs`: 53 pass, 0 fail (45 existing, 8 new).
- `forms-render-workboard.db.test.mjs`, whole file: 91 pass, 1 fail. The failure, "renders the Work Board's data", already exists at the base: commit `358b0348` (an ancestor of `4f0251aa`) added `lapses_at` and `category_after_lapse` to the board, and the golden `test/fixtures/work-board-data.json` was last changed in `dbdb52f6` (2026-10-29), before that commit. Checked with `git merge-base --is-ancestor` and `git log`. The plain run ran only its new case and so did not hit it.
- `test_migrate_engine.py`, whole file: 231 pass, 0 fail.
- `build_plugin.py`, then `--check`: all eight current. `check_plugin.py`: all checks passed. `check_layering.py`: 0 to fix. `check_file_ops.py`: 0 with no ruling. `check_publishable.py --new-since origin/main`: no new problems.

### Not verified

- `recipients-criterion`, `take-job`, `draft/tests` and `shared/scrivener/tests` (hook).
- That the golden failure appears when run at the base itself: the hook refused the run on the main checkout. The conclusion rests on the history above.
- The change in a live `/draft` session.

### Worker proposals (not decided)

1. Whether step ordinals stay contiguous when a † step is omitted.
2. Who ticks `Confirm delivery` when the delivery check runs in a session that does not hold the job (`set_step` returns `not_held`).
3. The opening delivery check keeps firing on a sent letter whose job stays open for steps 10 to 12.
4. `jobs-gate.md`'s Pre-send gate line still names only `Deliver` as the billing-anchor source.
5. The `no_billing_anchor` refusal text now says "a letter's job" instead of "a letter's Deliver job".
6. A cancelled or deferred step 8 or 9 is stamped done on a sent letter, as Deliver does.

## Branch cleanup note (2026-11-07)

The branches that held these runs were deleted. Their code was not merged: main ships neither letter-job variant, and the Cast of Characters was built differently on main. The two letter-job code commits (one job per letter with phase steps, orchestrated 14d68d42 and unorchestrated dc44f841) are gone with the branches. To revive the feature, rebuild it from the plans in this folder.
