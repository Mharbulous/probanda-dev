# Cast of Characters: cost with and without the orchestration section

The same plan is run twice from commit `081c773f`, each run on its own branch, and the token-adjusted cost of each run is compared.

| Variant | Plan file | Branch | Cost (USD) |
|---|---|---|---|
| With orchestration | `plan-with-orchestration.md` | `exp/cast-orchestrated` | **28.39** |
| Without orchestration | `plan-without-orchestration.md` | `exp/cast-unorchestrated` | not run yet |

## How cost is measured

`session_cost.py` reads a session's transcript and every subagent transcript beside it, counts each API response once (by message id) and prices its tokens per model. The prices are the claude-api skill's table, cached 2026-10-06, per million tokens:

| Model | Input | Output | Cache read |
|---|---|---|---|
| claude-opus-5-5 | 4.00 | 20.00 | 0.20 |
| claude-sonnet-5-5 | 2.00 | 10.00 | 0.20 |
| claude-haiku-5-5 | 0.10 | 0.50 | 0.01 (assumed) |
| claude-fable-5-1 | 10.00 | 50.00 | 0.25 |

Cache writes are not in the table, so they use the standard multipliers on input: ×1.25 for a 5-minute write and ×2 for a 1-hour write. "Token-adjusted" means every token is weighted by its price, so a cache read counts at a twentieth of an Opus input token.

Run it on a session's main transcript:

```
python session_cost.py ~/.claude/projects/<project>/<session-id>.jsonl
```

## The orchestrated run (2026-11-06)

Measured at 2026-11-07T04:00Z. One session (Opus 5.5) orchestrated five coding workers. The planning conversation that wrote the plans is not counted, and the same holds for both variants.

| Transcript | Model | API calls | Output tokens | Cache read | USD | Wall time |
|---|---|---|---|---|---|---|
| Orchestrator | opus-5-5 | 50 | 41,277 | 8,053,790 | 4.08 | |
| A: store | sonnet-5-5 | 84 | 70,004 | 16,752,442 | 4.64 | 35 min |
| B: script | sonnet-5-5 | 45 | 52,653 | 6,631,050 | 2.31 | 12 min |
| C: join and T512 | opus-5-5 | 39 | 70,735 | 6,343,156 | 3.81 | 13 min |
| D1: page | sonnet-5-5 | 56 | 87,085 | 11,012,101 | 3.74 | 12 min |
| D2: wiring | sonnet-5-5 | 138 | 118,626 | 38,522,925 | 9.80 | 32 min |
| **Total** | | 412 | 440,380 | 87,315,464 | **28.39** | about 2 h 10 min |

The orchestrator holds 14% of the cost. D2 is the largest single item: it touched 13 files and needed 201 tool calls.

### Commits

`44086a6b` B, `3c00e695` A, `e11cbed0` C, `c5fdddc9` D1, `dc512463` D2, `6dfbc986` built plugins and spec status.

### Departures from the plan (both variants must make them, or the costs do not compare)

1. No live deploy of `rules.sql` and no `check_items.mjs` against the live project, because the branch may never merge.
2. No `/release` and no push to `main`, because a release ships to the maintainer's machines. The built `plugins/` folders are committed on the branch instead, without version bumps.
3. A hook allows a session to run only test files changed in the last 24 hours, named by path. Whole suites run only in the nightly CI. So the plan's Step 6 run list ran as: each changed test file, `tsc`, build and bundle, `build_plugin` and `--check`, `check_plugin`, `check_layering`, `check_file_ops` and `check_publishable --new-since origin/main`. One full-suite baseline did run before the hook was found, and showed 18 tests already failing on `081c773f`.
4. The browser check (Step 5) was not done, because the Chrome tools disconnected during the run.

### Verified

- Each slice's test files, run by the orchestrator: contacts 20/20, cast script 19/19, cast-data 10/10, T512 db 2/2, page script 10/10, view-pages 14/14, matter-pages 46 pass with 2 baseline failures, pages-preview 4/4, gate 21 (550 subtests).
- `tsc` clean. The final build, bundle, plugin build and the four repository checks all pass.

### Not verified

- The scratch-schema cloud tests: the machine has no `supabase` CLI.
- Test files the hook would not run because they did not change, notably `tool-list.unit.test.mjs`, which pairs tools with their schemas and may be affected by the new render tool. The nightly CI covers them.
- The page in a real browser, with and without JavaScript.

## Running the variant without orchestration

1. `git worktree add -b exp/cast-unorchestrated <folder> 081c773f`.
2. Link `source/lawyer/mcp/node_modules` from the main checkout (`mklink /J`).
3. Start a fresh Claude Code session (Opus 5.5) in that folder. Give it `plan-without-orchestration.md` and the four departures above, and tell it to work on the branch only.
4. When it finishes, run `session_cost.py` on that session's transcript and fill in the table at the top.
