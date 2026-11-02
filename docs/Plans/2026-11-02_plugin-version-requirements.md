# Plugin version requirements replace freezes

Status: approved by Brahm on 2026-11-02. Layers 1 to 3 are confirmed against the Step 0 results before they are built.

## Goal
`/release` tells Brahm to freeze a plugin on every machine for a minor release (`.claude/commands/release.md:46` and `:66-70`). Nobody can check that a freeze is being followed, and public users won't follow one. Each released plugin must carry its version requirements instead, and stay frozen until they are met. A blocked user sees a plain explanation.

## What Claude's plugin system already does
`plugin.json` `dependencies` entries can carry a version range (https://code.claude.com/docs/en/plugin-dependencies). If an installed plugin is outside the range, the plugin that declared it stays disabled at load, and `claude plugin list` shows `Requires "x@market" ~2.1.0, installed 3.0.0`. Probanda already declares dependencies, but by name only, such as `"lawyer"` in `source/litigator/plugin.json:12`, so any version passes.

## Step 0: Test Cowork before building anything
The docs describe this for Claude Code and do not say Cowork enforces it. Create a private repo, `Mharbulous/plugin-dependency-test`, holding a marketplace with two invented plugins, `base` and `needs-base`. `needs-base` declares `{"name":"base","version":"^0.2.0"}`. Only Brahm can add a marketplace to his claude.ai account and open Cowork. Each stage records whether `needs-base`'s skill and hook load, in both Claude Code and Cowork:
1. `base` 0.2.0: requirement met.
2. `base` 0.3.0: requirement broken. `needs-base` should go disabled.
3. `needs-base` released with `^0.3.0`: should work again.
4. A bare-name entry and one naming a marketplace, because the docs only describe the second for claude.ai-synced plugins.
5. Whether a `base` hook can see `needs-base`'s version and its disabled state from inside Cowork.

## Layer 1: The requirement in every release (always built)
- **Range rule:** `^<dependency's current version>`. Below 1.0, a caret stays within one minor version, so `^0.11.3` means 0.11.3 up to, but not including, 0.12.0. This matches `CLAUDE.md:13-14`, where a minor version means an old and new copy can't safely share data.
- **Both directions are covered:** new litigator with old lawyer disables litigator, and old litigator with new lawyer also disables litigator. Lawyer has no dependencies, so it keeps running. Confirm that in `source/assignment.json`.
- **A script writes the ranges:** new `scripts/stamp_dependencies.py`, called in `release.md` step 5, writes each released plugin's ranges into `source/<plugin>/plugin.json`. Names still come from `requires` in `source/assignment.json`.
- **Checks that refuse a bad release:** extend `check_dependencies` (`scripts/check_plugin_sources.py:198`), which today compares names only and would fail on range entries. `check_plugin.py` must fail when:
  - An entry has no range.
  - An entry doesn't accept the dependency's current version. This forces a minor lawyer release to re-release every plugin needing it in the same commit, because otherwise a dependent would be disabled with no working version to update to.
- **Rollout:** the first release with ranges is a minor release, because the version rule counts a raised requirement as minor. `public/` gets the ranges only through Brahm's normal approval and publish step.

## Layer 2: The data server refuses what it can't safely handle
A running session keeps the versions it loaded, so Layer 1 can't stop a session already open during an update. The database check does: `bundle_outdated` already refuses a database newer than the installed server (`source/lawyer/mcp/src/submission/`). Audit every tool in the lawyer `data` server that writes, list any that skip the check, and add it.

## Layer 3: The plain explanation
A disabled plugin can't run its own hook, so it can't explain itself. Lawyer stays running, so a lawyer `SessionStart` hook supplies the facts, labelled as data, and asks the model to do nothing (context-engineering rule 19): which plugin is frozen, that its version doesn't match another plugin's, that this protects their data, and that it stays frozen until both are up to date, with how to update. It depends on Step 0 item 5. If the hook can't see other plugins in Cowork, tell Brahm and work out another way.

## If Cowork doesn't enforce the requirement
Only then build the standard check Brahm suggested. A `PreToolUse` hook shipped in each plugin blocks that plugin's tools and says why. The hook blocks directly, so it is allowed under rule 19. It is not built before the test, because it would duplicate what the platform does.

## Replace the freeze wording
- `release.md:46`: a minor release still needs Brahm's go-ahead, but no freeze.
- `release.md:66-70`: replace with the user's action, such as a migration. The ranges do the rest.
- `CLAUDE.md` release section, and a search of the repo for any other freeze instruction.
- A freeze is never again given as a safeguard to Brahm or users. Add this to `release.md`, so future sessions follow it.

## Verification
- Step 0 results, stage by stage.
- `check_plugin.py` fails on: a name-only entry, a range that excludes the current version, and a minor bump with a dependent left behind. Use invented manifests.
- In Claude Code and Cowork, install an old litigator with a new lawyer on a test account or test marketplace, and confirm litigator is disabled and the explanation appears.
- The audit's list of write tools, each with its refusal test.

## Risks
- **Brief lockouts:** a machine's sync can lag by hours, and a plugin stays disabled until it catches up. This is the intended trade, safety over availability, but users will see it.
- **Harmless updates can freeze too:** because a release stamps the dependency's current version, a plugin can require a lawyer patch it didn't strictly need.
- **Git tags:** the docs say a range resolves against tags, and a relative-path plugin without a matching tag falls back to the marketplace's current copy, checked at load. Probanda has no tags, and this plan doesn't add any, because the load check is what is needed. Step 0 confirms this.
- **Claude Code version:** ranges need v2.1.110 or later. Older copies are not covered.
