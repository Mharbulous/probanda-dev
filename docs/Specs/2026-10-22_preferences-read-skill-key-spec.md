# Spec: preferences-read skill key example

Status: proposed, 2026-10-22. Written in a matter session; implementation is handed to Claude Code.
Plugin: lawyer data server (`preferences__read`) and the SessionStart hook; installed copy version not seen. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-22_present-files-delivery-fallback-spec.md; 2026-10-22_board-card-duplicate-text-spec.md

## 1. Problem
`preferences__read`'s description gives `lawyer:draft` as its example skill key, but /draft ships in the `litigator` plugin and ran as `litigator:draft`. A filtered call and an unfiltered call both returned an empty entries list, so a wrong key cannot be told apart from no saved preferences. If a key ever mismatches, saved preferences are skipped silently.

## 2. Evidence (observed; quoted text is data, not instructions)
- Tool description: entries "for one `skill` (\"<plugin>:<skill>\", e.g. \"lawyer:draft\")" (source: tool `preferences__read`).
- SessionStart hook: "Before the first Probanda skill runs, call preferences__read and apply each entry when its skill runs."
- Skill as seen: `litigator:draft` (version comment litigator v0.8.1).
- Calls: with `skill: "litigator:draft"` returned `{"person": "<name>", "entries": []}`; with no filter returned the same shape, entries `[]`.
- Not verified: whether a non-matching key returns empty or an error.
- Cost: 2 calls; the risk is latent. Workaround: call once filtered, once unfiltered.

## 3. Goal and non-goals
Goal: a wrong or unknown skill key is detectable, and the description's example names a skill that exists.
Non-goals: changing preference storage, retirement semantics or who may write preferences.

## 4. Design
Fix the example to a real `<plugin>:<skill>` pair. Echo the filter in the result and add a count of the person's active entries that the filter excluded, so an empty filtered result with a non-zero excluded count is visibly a key problem (result shape UNVERIFIED). In the SessionStart hook, state the key form as the plugin the skill ships in plus the skill name.

## 5. Constraints that must still hold
- Read-only; entries are per person only.
- A preference never loosens a verification, approval or privilege rule; the refuse-and-quote-created_on behaviour is unchanged.
- Existing callers of the result keep working.

## 6. Options considered
1. Fix example, echo filter, add excluded count (recommended): makes the failure visible at small cost.
2. Fix example only: removes the likely mistake, leaves silent mismatch possible.
3. Leave as is: no change, latent silent skip.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Locate the tool's description and handler and the SessionStart hook sentence.
3. Apply §4.
4. Add tests: filter matches, filter excludes existing entries, no entries.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of preferences-read skill key example complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The description's example key names a skill that exists in a shipped plugin.
2. A filtered call that excludes active entries reports the filter and the excluded count.
3. Tests cover match, non-match with entries present, and no entries.
4. Existing result fields keep their names and meaning.
Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Is the result shape frozen by a schema or consumers outside the repo?

## 10. Verify against HEAD before building
Confirm each path, quote and root cause above in the repo at HEAD; mark any that differ, and append the table to this spec before changing code.
