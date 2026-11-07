# Letter job with phase steps: cost with and without the orchestration section

The same plan is run twice from commit `4f0251aa`, each run on its own branch, and the token-adjusted cost of each run is compared. The method copies `docs/Experiments/2026-11-06_cast-orchestration-cost/` on branch `exp/cast-orchestrated`.

| Variant | Plan file | Branch | Cost (USD) |
|---|---|---|---|
| Without orchestration | `plan-without-orchestration.md` | `exp/letter-unorchestrated` | **3.24** |
| With orchestration | `plan-with-orchestration.md` | `exp/letter-orchestrated` | not run yet |

`plan-with-orchestration.md` is `plan-without-orchestration.md` plus an `## Orchestration` section drafted by the `context-engineering:context-architect` agent (advise mode). Its own sizing says to expect roughly break-even for a change this small.

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

One session (Opus 5.5) did all the work itself, with no subagents. The same session had first planned the experiment, so the run is priced from the moment execution started:

```
python session_cost.py ~/.claude/projects/<project>/<session-id>.jsonl --since 2026-11-07T04:38:33Z --until 2026-11-07T04:52:54Z
```

| Transcript | Model | Calls | Input | Output | Cache read | Cache write | USD |
|---|---|---|---|---|---|---|---|
| main | claude-opus-5-5 | 61 | 122 | 29,776 | 9,653,712 | 89,315 | 3.24 |
| **Total** | | | | | | | **3.24** |

Wall time: 14 min 21 s (04:38:33Z to 04:52:54Z), from creating the worktree to the commit. The planning before it cost $0.92 (11 calls) and is not counted. Pricing and preparing the other variant came after the window and are not counted either.

**Bias to note.** This run's context already held the planning conversation, so every call re-read it from cache. A fresh session, as the orchestrated variant will use, starts with less. The bias favours the orchestrated variant slightly.

### Commit

`dc44f841` on `exp/letter-unorchestrated`: skill text, server code, tests, diagram and the rebuilt `plugins/litigator/`.

### Departures from the plan (both variants must make them, or the costs do not compare)

1. No `/release`, no version bump, no push to `main`, no `dist/` bundle. The built `plugins/` folders are committed on the branch.
2. A hook lets a session run only test files changed in the last 24 hours, named by path, with no shell redirect such as `2>&1` on the runner line. So the plan's Verification step 1 ran the two changed node test files only, and step 2 ran the one changed Python test file only. `recipients-criterion`, `take-job`, `draft/tests` and `shared/scrivener/tests` did not run.
3. `prepare/SKILL.md:92` needed no edit: it points to §3b for every stock job's text, so the new title is covered.

### Verified

- `npm run build` (templates, resolver, `tsc`) clean.
- `sent-write.db.test.mjs`: 49 pass, 0 fail (45 existing, 4 new).
- `forms-render-workboard.db.test.mjs`, the new case only (`--test-name-pattern`): 1 pass.
- `test_migrate_engine.py -k LetterStockJobIdioms`: 4 pass.
- `build_plugin.py`, then `--check`: all eight plugins current. `check_plugin.py`: all checks passed. `check_layering.py`: 0 to fix. `check_file_ops.py`: 0 with no ruling. `check_publishable.py --new-since origin/main`: no new problems.

### Not verified

- The rest of `forms-render-workboard.db.test.mjs` and `test_migrate_engine.py`, and the unchanged suites above. The nightly CI covers them.
- The change in a live `/draft` session.

## Running the variant with orchestration

1. `git -C "$HOME/Git/probanda-dev" worktree add -b exp/letter-orchestrated "$HOME/Git/probanda-dev-letter-orch" 4f0251aa`.
2. Link `source/lawyer/mcp/node_modules` from the main checkout: `New-Item -ItemType Junction -Path <worktree>\source\lawyer\mcp\node_modules -Target <main checkout>\source\lawyer\mcp\node_modules` (PowerShell).
3. Start a fresh Claude Code session (Opus 5.5) in that folder. Give it the absolute path of `plan-with-orchestration.md` in this folder and the departures above, and tell it to work on the branch only.
4. When it finishes, run `session_cost.py` on that session's transcript (no window needed in a fresh session) and fill in the table at the top.
