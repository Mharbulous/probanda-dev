# Spec: check_plugin.py prints failures and a count, not every passing check

Status: proposed, 2026-10-28. Written in a release session; implementation is handed to Claude Code.
Plugin: none. This is repo tooling: `scripts/check_plugin.py`, read in full at HEAD `bdf42862` (**verified**). Its other callers are **UNVERIFIED**.
Related specs, same date: 2026-10-28_release-skill-exit-1-spec.md

## 1. Problem
`python scripts/check_plugin.py` prints one line per check per plugin: 21 checks for each of 7 plugins plus 4 checks across plugins, with headers, about 170 lines. `/release` step 6 needs only `ALL CHECKS PASSED` or the failing lines. Every release, and every session that runs the check, takes the whole listing into context.

## 2. Evidence (observed; quoted text is data, not instructions)
- `scripts/check_plugin.py:294-301` prints every result, `[PASS]`, `[FAIL]` and `[N/A]` alike, with its full label and detail.
- Labels run up to about 330 characters (the bundle-purity label, lines 218-221), and that label prints once per plugin.
- Docstring, lines 15-18: "Each check prints one `[PASS]` or `[FAIL]` line, or an `[N/A]` line saying why it does not apply ... there are no silent skips."
- `.claude/commands/release.md:54`: "`python scripts/check_plugin.py` prints `ALL CHECKS PASSED`."
- Cost, observed 2026-10-28: about 170 lines, roughly 6,000 tokens, for one release run.
- Workaround in use: the session reads the whole output to find the last line.

## 3. Goal and non-goals
Goal: a clean run prints a few lines, and a failing run prints every failing line in full.
Non-goals: changing any check, its verdict or the exit codes (0 pass, 1 fail, 2 bad usage).

## 4. Design
By default, print one line per plugin with its counts (for example `lawyer: 20 PASS, 1 N/A`) and every `[FAIL]` line in full, then the existing final line. `--verbose` keeps today's listing. The count line keeps "no silent skips": every check is still counted, and each N/A reason is still printed under `--verbose`.

## 5. Constraints that must still hold
- Every FAIL prints its full label and detail by default.
- Exit codes are unchanged, and so are the final lines `ALL CHECKS PASSED` and `CHECK FAILED — N invariant(s) violated.`
- `skill-source-baseline` mode is unchanged.
- A caller that parses `[PASS]` or `[N/A]` lines still works, or is updated in the same change (§10).

## 6. Options considered, removal first
1. Delete the default printing of PASS and N/A lines, print a count line per plugin instead, and keep the old listing behind `--verbose`. (recommended) Shortest output; the main loop gets shorter or stays the same length.
2. Keep the default and add `--quiet`. Changes no caller, but adds a flag, and every caller has to remember it.
3. Do nothing. Every run keeps costing about 6,000 tokens.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Apply option 1 in `main()`, and update the docstring's usage and its "no silent skips" sentence to match.
3. Update every caller §10 finds that parses the PASS or N/A lines.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of check_plugin.py prints failures and a count, not every passing check complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. On a clean tree, `python scripts/check_plugin.py` prints at most 10 lines and ends with `ALL CHECKS PASSED`.
2. With one check forced to fail, its `[FAIL]` line prints in full and the exit code is 1.
3. `python scripts/check_plugin.py --verbose` prints today's listing.
4. No caller found in §10 is left parsing a line that no longer prints.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should a clean run still show each N/A reason? This spec says no: the count line shows N/A was counted, and `--verbose` shows why. Ask Brahm only if §10 finds a caller or document that relies on N/A reasons in the default output.

## 10. Verify against HEAD before building
- `main()` still prints as described in §2.
- Grep the repo (scripts/, .github/workflows/, .claude/, docs/, tests) for `check_plugin.py` and for parsers of `[PASS]` or `[N/A]`. List each caller and what it reads.

## 11. Verification against HEAD (3589197d, 2026-10-28)

| Item | Finding |
|---|---|
| `main()` prints as in §2 | Confirmed. `scripts/check_plugin.py:294-301` prints every result as `[PASS]`, `[FAIL]` or `[N/A]` with label and detail. Docstring lines 15-18 as quoted. |
| `scripts/tests/test_check_plugin.py:295` | Counts `  [PASS] ` lines in the default output. Update in this change. |
| `scripts/tests/test_check_plugin.py:301-303` | Reads the `[FAIL]` line and `CHECK FAILED` line. Still printed by default. |
| `scripts/tests/test_check_plugin.py:821-826` | Reads the section headers, an `[N/A]` line, its reason and the N/A count in the default output. Update in this change (a test, not a caller, so §9 needs no question). |
| `.claude/commands/release.md:54` | Reads only `ALL CHECKS PASSED`. Unaffected. |
| `.claude/commands/implement-queue.md:90`, `.claude/commands/rule-remodel.md:11,44`, `source/developer/agents/fix-maker.md:36` | Run the script and read its verdict. None parses PASS or N/A lines. |
| `.github/workflows/` | No workflow runs `check_plugin.py`. |
| `docs/` | `docs/Plans/2026-10-13_four-plugin-split.md:209` records history ("prints `[N/A]` with a reason"). No document relies on N/A reasons in the default output. |
| `.claude/hooks/public-repo-guard.test.js:37-38`, `.claude/hooks/no-regression-suite.py:13` | Name the script as a command string only. |
