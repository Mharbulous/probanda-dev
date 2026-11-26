---
name: release
description: Release the Probanda plugins - rebuild what changed, choose each version by the rule in CLAUDE.md, check, commit and push to main.
---

# /release

A push to `main` is the release. This command decides each changed plugin's version by the version rule in the "Releasing" section of `CLAUDE.md`, builds, checks and pushes. Run every step in order. Each step has a check. If a check fails, stop and report its output, and never bump or push past it.

Run commands from the repo root. Call git as `git -C <repo root>`.

## 1. Start

`git pull --ff-only`. Check: the source changes being released are committed on `main`, and `git status` shows no uncommitted change under `source/` or `public/`.

## 2. What changed

Run: `python .claude/skills/release/scripts/release_set.py`

It runs `build_plugin.py --check` and `release_changes.py`, merges them, and prints the release set: one `released: P (last bump <hash>; from <sources>)` block per plugin with its change set (`git diff --name-status` over P's inputs since its last bump), and one `rebuild: <folder>` block per bundle to rebuild, with its `run:` commands.

- Exit 0 prints `nothing to release`: stop, unless Brahm has expressly asked for the first release with ranges (step 5).
- Exit 1: continue with the plugins it lists. A plugin whose block says `(no change to its inputs since the bump)` is listed by `--check` alone, for example for a file mode.
- Exit 2: stop and report its output.

## 3. Bundles

A server's bundle in `dist/` is committed, and the build copies it as it is. For each `rebuild:` block, run its `run:` lines in order from the repo root. Call `tsc` and `bundle.mjs` with `node` directly: the package-install guard hook blocks `npm run`. Check: `tsc` exits 0, and `git status` shows the `dist/` file changed. Then run `python scripts/build_plugin.py --check`, and trust it only after that.

## 4. Classify

For each released plugin, read its change set and apply the version rule in `CLAUDE.md`. A break usually hides in one of these places:

- schema, migration or `migrate_*` files, or anything that changes how stored data is laid out;
- a tool's registration or input schema in a server's `src/`;
- `.mcp.json`, a hook's matcher, or `requires` in `plugin.json`;
- server code that opens, checks or refuses the user's data.

Write one line per plugin: `P: patch` or `P: minor`, then the reason. For a minor release, also write what each user must do and in what order.

A patch goes on to step 5. A minor release needs a freeze, so show the lines to Brahm and wait for his go-ahead before step 5. In `/implement-queue`, nobody can answer: a **Minor go-ahead** on the issue (that command's step 4) is his go-ahead for the plugins it covers, and without one the run hands the issue back.

## 5. Bump and build

Bump `version` in `source/P/plugin.json` for each released plugin: the last number for a patch, the middle number for a minor (resetting the last to 0). Never reach 1.0.0. Then run `python scripts/stamp_dependencies.py <each released plugin>`, which writes each one's version ranges. Exit 1 names each plugin `left behind`, whose range no longer accepts a dependency's new version: it is released too, as a minor, so without Brahm's go-ahead for it stop here, and with it bump it and run the script again with it added, until it exits 0. Only when Brahm has expressly asked for the first release with ranges, add `--first-ranges`, which also lists every plugin still on bare names as left behind. Run `python scripts/build_plugin.py`. Check: `python scripts/build_plugin.py --check` exits 0.

## 6. Checks

- `python scripts/check_plugin.py` prints `ALL CHECKS PASSED`. It includes layering and bundle purity.
- `python scripts/check_publishable.py --new-since origin/main` reports no new problems.

## 7. Ship

Commit by explicit pathspec, never `git add -A`: the bumped `source/*/plugin.json`, any rebuilt `dist/` bundles, `plugins/`, and `scripts/check_plugin_baselines/dependency_ranges_pending.json` if the first release with ranges changed or removed it. Subject: `<Plugin> <version>[, <Plugin> <version>]: <what changed>`. For a minor release, add a body line `Users must: <the action>`. Then `git pull --ff-only` and `git push`.

## 8. Report

Give the versions and the commit.

- Patch: each machine picks it up on its own, possibly hours later.
- Minor: give Brahm the rollout, in this order:
  1. Freeze: no use of the affected plugin on any machine.
  2. On each machine, "Check for updates" in claude.ai. The machine's copy under `~/.claude/plugins/synced/` must show the new version, with a `.last-complete-round` later than the push.
  3. The user's action, such as a migration.
  4. Unfreeze.
