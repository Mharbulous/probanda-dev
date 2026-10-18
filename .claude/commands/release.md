---
description: Release the Probanda plugins - rebuild what changed, choose each version by the rule in CLAUDE.md, check, commit and push to main.
---

# /release

A push to `main` is the release. This command decides each changed plugin's version by the version rule in the "Releasing" section of `CLAUDE.md`, builds, checks and pushes. Run every step in order. Each step has a check. If a check fails, stop and report its output, and never bump or push past it.

Run commands from the repo root. Call git as `git -C <repo root>`.

## 1. Start

`git pull --ff-only`. Check: the source changes being released are committed on `main`, and `git status` shows no uncommitted change under `.claude/skills/`, `source/` or `public/`.

## 2. What changed

`python scripts/build_plugin.py --check`.

- Exit 0: `plugins/` already matches the source. Report "nothing to release" and stop.
- Exit 1: it lists the plugin folders that differ. Those plugins are released.

For each such plugin P, its change set is everything since its last release: `git log -1 --format=%H -- source/P/plugin.json` gives the last bump, and `git diff <that commit>..HEAD` over P's inputs (its skills in `source/assignment.json`, `.claude/skills/shared/`, `source/P/`, and the servers it ships) gives the change.

## 3. Bundles

A server's bundle in `dist/` is committed, and the build copies it as it is. Rebuild a bundle when the change set touches its `src/` or `scripts/`, or `source/mcp-shared/`. Also rebuild the data bundle when `.claude/skills/drafting-data/references/scripts/migrate_engine.py` changed, because its schema version is baked in.

- Lawyer's `data` server and file-manager's `files` server come from one source. Run `node source/lawyer/mcp/node_modules/typescript/bin/tsc -p source/lawyer/mcp/tsconfig.json`, then `node source/lawyer/mcp/scripts/bundle.mjs`, which writes both bundles.
- Research's `commons` server: its local `tsc` as above, then its `scripts/bundle.mjs`. Research's `canlii` server: its `scripts/bundle.mjs`.

Call `tsc` and `bundle.mjs` with `node` directly: the package-install guard hook blocks `npm run`. Check: `tsc` exits 0, and `git status` shows the `dist/` file changed.

## 4. Classify

For each released plugin, read its change set and apply the version rule in `CLAUDE.md`. A break usually hides in one of these places:

- schema, migration or `migrate_*` files, or anything that changes how stored data is laid out;
- a tool's registration or input schema in a server's `src/`;
- `.mcp.json`, a hook's matcher, or `requires` in `plugin.json`;
- server code that opens, checks or refuses the user's data.

Write one line per plugin: `P: patch` or `P: minor`, then the reason. For a minor release, also write what each user must do and in what order.

A patch goes on to step 5. A minor release needs a freeze, so show the lines to Brahm and wait for his go-ahead before step 5.

## 5. Bump and build

Bump `version` in `source/P/plugin.json` for each released plugin: the last number for a patch, the middle number for a minor (resetting the last to 0). Never reach 1.0.0. Run `python scripts/build_plugin.py`. Check: `python scripts/build_plugin.py --check` exits 0.

## 6. Checks

- `python scripts/check_plugin.py` prints `ALL CHECKS PASSED`. It includes layering and bundle purity.
- `python scripts/check_publishable.py --new-since origin/main` reports no new problems.

## 7. Ship

Commit by explicit pathspec, never `git add -A`: the bumped `source/*/plugin.json`, any rebuilt `dist/` bundles, and `plugins/`. Subject: `<Plugin> <version>[, <Plugin> <version>]: <what changed>`. For a minor release, add a body line `Users must: <the action>`. Then `git pull --ff-only` and `git push`.

## 8. Report

Give the versions and the commit.

- Patch: each machine picks it up on its own, possibly hours later.
- Minor: give Brahm the rollout, in this order:
  1. Freeze: no use of the affected plugin on any machine.
  2. On each machine, "Check for updates" in claude.ai. The machine's copy under `~/.claude/plugins/synced/` must show the new version, with a `.last-complete-round` later than the push.
  3. The user's action, such as a migration.
  4. Unfreeze.
