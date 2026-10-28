# Spec: /release step 2 says what release_changes.py's exit 1 means

Status: proposed, 2026-10-28. Written in a release session; implementation is handed to Claude Code.
Plugin: none. This is repo tooling: `.claude/commands/release.md` and `scripts/release_changes.py`, both read at HEAD `bdf42862` (**verified**).
Related specs, same date: 2026-10-28_check-plugin-short-output-spec.md

## 1. Problem
`/release` step 2 tells the session how to read the exit codes of `build_plugin.py --check` and `scripts/release_changes.py`, but covers only 0 and 2. `release_changes.py` exits 1 whenever it lists anything, which is the normal case for every release. On the Lawyer 0.11.0 release the session had to infer that 1 meant "continue". A session that reads exit 1 as a failure stops the release.

## 2. Evidence (observed; quoted text is data, not instructions)
- `.claude/commands/release.md:21`: "Both exit 0: report \"nothing to release\" and stop. Either exits 2: stop and report its output."
- `scripts/release_changes.py:16`: "Exit codes: 0 nothing listed, 1 something listed, 2 a stop."
- `scripts/release_changes.py:66`: `return 1 if listed else 0`. Exit 2 comes from `plugin_layout.stop` (line 33).
- Observed run, 2026-10-28: exit 1 with `rebuild:` and `released: lawyer` lines. The session continued by inference.
- Workaround in use: the session reads the script's docstring and guesses.

## 3. Goal and non-goals
Goal: step 2 states every exit code of both commands and what the session does on each.
Non-goal: changing either script's exit codes or output.

## 4. Design
Replace line 21 with one line covering all three codes. `build_plugin.py --check`'s own exit 1 (a plugin is stale) is already handled by the step's last bullet; confirm that in §10 and say so in the line only if it is not.

## 5. Constraints that must still hold
- Step 2 still stops on exit 2 from either command and reports the output.
- Step 2 still stops with "nothing to release" when both exit 0.

## 6. Options considered, removal first
1. Rewrite line 21 as: "Both exit 0: report \"nothing to release\" and stop. Exit 1 means something is listed: continue. Either exits 2: stop and report its output." (recommended) Same line, one clause added, nothing else changes.
2. Change `release_changes.py` to exit 0 when it lists something. Removes the case, but breaks the script's documented contract and any test that pins it.
3. Do nothing. Each release keeps a guess in step 2.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Apply option 1 to `.claude/commands/release.md`.
3. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of /release step 2 says what release_changes.py's exit 1 means complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. `.claude/commands/release.md` step 2 names exit 0, 1 and 2 and the action for each.
2. No other line of `release.md` changed.
3. `scripts/release_changes.py` is unchanged.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
None.

## 10. Verify against HEAD before building
- `release.md` line 21 still reads as quoted in §2.
- `release_changes.py` still documents and returns exit 0, 1 and 2 as in §2.
- `build_plugin.py --check`'s exit code on a stale plugin, and whether step 2 already says what to do then.
