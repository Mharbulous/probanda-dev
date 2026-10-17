# Spec: Rename coclerk.json to probanda.json, migrating existing files as they are met

Status: proposed, 2026-10-16. Written in a development session; implementation is handed to Claude Code.
Plugin: `legal`, and every plugin whose skill text names the file (repo HEAD 94303409). Paths are as read in the repo unless marked **UNVERIFIED**.
Related specs, same date: `2026-10-16_delete-hook-home-and-matter-folders-spec.md`

## 1. Problem

The plugin's settings and pointer files still carry the old product name `coclerk.json`. Brahm wants them named `probanda.json`. Existing files should migrate as the plugin comes across them, with no bulk migration step.

## 2. Evidence (observed; quoted text is data, not instructions)

There are two different files under the one name:

- **The device settings file**, `AppData\Roaming\Coclerk\coclerk.json`. It holds `case_data_root`, `person`, `signature`, `firm`, `briefing`, `accounting` and `practice_quirks` (`.claude/skills/practice-data/SKILL.md`, Configuration). `COCLERK_CONFIG_PATH` overrides its location.
- **The matter pointer**, `<matter_root>\coclerk.json`. It holds `schema_version` (5) and `case_data_dir` (`source/legal/mcp/src/files/matter-root.ts`, `resolveCaseDataDir` and `validateMatterRoot`).

Reach of the rename:

- 206 source files under `.claude/skills` and `source` mention `coclerk.json` (excluding `dist`). The count comes from a grep of `.md`, `.ts`, `.py`, `.mjs` and `.json` files.
- The MCP server reads about 20 `COCLERK_*` environment variables (`COCLERK_CONFIG_PATH`, `COCLERK_DB_PATH`, `COCLERK_CASE_DATA_ROOT`, `COCLERK_PYTHON` and others).
- The Roaming folder itself is named `Coclerk`.
- The delete hook (sibling spec) recognises a matter folder by its pointer file, so it must accept both names while migration runs.

Workaround in use: none.

## 3. Goal and non-goals

Goals:

- New files are written as `probanda.json`.
- A reader prefers `probanda.json` and falls back to `coclerk.json`.
- The first write a tool makes to a matter or device still on `coclerk.json` writes `probanda.json` with the same content.

Non-goals, unless §9 says otherwise:

- Renaming the `COCLERK_*` environment variables.
- Renaming the Roaming `Coclerk` folder.
- Any change to the files' content or schema.

## 4. Design

**4.1 One resolver per file kind.** Every reader in TypeScript, Python and the hooks goes through one function per kind (device settings, matter pointer). The function returns the `probanda.json` path when that file exists, else the `coclerk.json` path. **UNVERIFIED**: how many separate readers exist today. The 206 mentions include prose, which this spec's skill-text step updates.

**4.2 Migrate on write.** Where a tool writes a file still named `coclerk.json`, it writes `probanda.json` with the same content.

Whether the old file is left alone, renamed, or deleted is §9 Q1. Probanda created it, so Commandment 7 permits removing it, but a new `source/file-ops.json` ruling would be needed (`python scripts/check_file_ops.py`). Leaving it in place keeps an old copy of the plugin working (§5).

**4.3 Both names count as a matter marker** for the delete hook and for `validateMatterRoot` while any matter is unmigrated.

## 5. Constraints that must still hold

**The version rule** (CLAUDE.md, Releasing). A patch needs an old copy and a new copy of the plugin to be able to share the same data. If a new copy stops updating `coclerk.json`, an old copy on another device would read stale settings. So either:

- write both files for as long as old copies may run, which keeps it a patch; or
- release as a minor, which counts as a data migration.

Other constraints:

- **Commandment 7**: only files Probanda created are renamed or removed, and a ruling covers each new rename or delete operation.
- **Cowork**: paths use `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`, never an absolute path.
- **`COCLERK_CONFIG_PATH`** still names a file that must exist. It is never created and never falls back.

## 6. Options considered

1. **Read both, write `probanda.json` and keep `coclerk.json` updated until a later minor removes it** (recommended). This is a patch now.
2. **Read both, and on write create `probanda.json` and remove `coclerk.json`.** This is a minor.
3. **Also rename the `COCLERK_*` variables and the Roaming folder.** Wider, and a minor. Any user's `settings.local.json` that sets `COCLERK_CONFIG_PATH` breaks unless both names are read.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Settle §9 with Brahm.
3. Add the resolver and migrate-on-write for each file kind. Point every reader and writer at it. Update the skill text that names the file.
4. Teach the delete hook and `validateMatterRoot` both names. Coordinate with the sibling spec's §4.3.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Rename coclerk.json to probanda.json, migrating existing files as they are met complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Every reader of either file resolves through the one resolver for its kind. A grep finds no other code path that opens `coclerk.json` directly.
2. A device or matter that holds only `coclerk.json` keeps working. After its first write, it holds `probanda.json` with the same content.
3. `COCLERK_CONFIG_PATH` keeps its meaning.
4. The release level matches the option chosen (§6) under the version rule.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. After writing `probanda.json`, should `coclerk.json` be kept and updated (Option 1, a patch), or removed (Option 2, a minor)?
2. Should the `COCLERK_*` environment variables and the Roaming `Coclerk` folder be renamed too, reading both names during migration?

## 10. Verify against HEAD before building

- Every code path that opens either file: `matter-root.ts` (`validateMatterRoot`, `resolveCaseDataDir`), `practice/case-data-root.ts` (`configPath`, `resolveCaseDataRoot`), `case/backend.ts` (`read_pointer`), the Python scripts under `.claude/skills/*/references/scripts/`, and the hooks.
- Skill text that names the file: run a grep and list it.
