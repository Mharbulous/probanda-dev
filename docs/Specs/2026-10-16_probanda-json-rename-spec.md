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

- Every code path that opens either file: `matter-root.ts` (`validateMatterRoot`, `resolveCaseDataDir`), `practice/matter-data-root.ts` (`configPath`, `resolveCaseDataRoot`), `case/backend.ts` (`read_pointer`), the Python scripts under `.claude/skills/*/references/scripts/`, and the hooks.
- Skill text that names the file: run a grep and list it.

## 11. Verification against HEAD (b14334e, 2026-10-16)

Every code path that opens either file, confirmed by reading each file at HEAD. "Opens" means the code constructs the file name and reads, writes or existence-checks it; files that only mention the name in prose, comments or tool descriptions are listed separately.

### Device settings file (Roaming `Coclerk\coclerk.json`)

| Code path | Function | Opens | Verified |
|---|---|---|---|
| `source/legal/mcp/src/config-path.ts` | `configPath` | constructs the path (sole TS constructor); `COCLERK_CONFIG_PATH` override existence-checked | yes |
| `source/legal/mcp/src/practice/matter-data-root.ts` | `resolveCaseDataRoot` | reads, via `configPath` | yes |
| `source/legal/mcp/src/tools/practice/config.ts` | `config_status` reads; `config_set_root` writes (temp + rename); `redirectedCopies` scans `Packages\*\LocalCache\Roaming\Coclerk\coclerk.json` (report-only) | read + write | yes |
| `source/legal/mcp/src/tools/practice/firm-profile.ts` | `readConfig`/`readFirmProfile` read; `upsert_firm_profile` writes | read + write | yes |
| `source/legal/mcp/src/repo-root.ts` | `readConfigRepoRoot` | reads, via `configPath` | yes |
| `source/legal/mcp/src/page-api/token.ts` | port read via `configPath`; `page-api.secret` sits in `dirname(configPath())` (folder, not the file) | read | yes |
| `source/legal/mcp/src/sources/hosts.ts` | existence check via `configPath` (line 105) | read | yes |
| `.claude/skills/publish/subskills/publish-bcsc-form/scripts/steps/shared/firm.py` | own duplicate of the path rule | read | yes |
| `.claude/skills/publish/scripts/render_letterhead.py` | own duplicate of the path rule (lines 81-91) | read | yes |
| `.claude/skills/practice-data/hooks/inject-practice-quirks.py` | own duplicate of the path rule | read | yes |
| `.claude/skills/matter-data/references/scripts/check_pointers.py` | `_inspect_config` reads a `--config` path the caller supplies (no construction) | read | yes |

The spec's §10 names `configPath` under `practice/matter-data-root.ts`; at HEAD it lives in `src/config-path.ts` and `matter-data-root.ts` imports it.

### Matter pointer (`<matter_root>\coclerk.json`)

| Code path | Function | Opens | Verified |
|---|---|---|---|
| `source/legal/mcp/src/files/matter-root.ts` | `validateMatterRoot` (existsSync), `resolveCaseDataDir` (readFileSync) | read | yes |
| `source/legal/mcp/src/case/backend.ts` (embedded Python) | `read_pointer` reads (root, then legacy `9. AI\coclerk.json`); `resolve_pointer` writes the normalized pointer back | read + write | yes |
| `source/legal/mcp/src/housekeeping/preflight.ts` | pointerless check, existsSync | read | yes |
| `source/legal/mcp/src/file_ops/trash.ts` | `MARKER`: ancestor search for the matter root, and protected-name check | read | yes |
| `source/legal/mcp/src/file_ops/move.ts` | protected-name check (`srcSegments[0]`) | name check only | yes |
| `.claude/skills/matter-data/references/scripts/resolve_paths.py` | `resolve_pointer` reads (root, then legacy) and writes back | read + write | yes |
| `.claude/skills/matter-data/references/scripts/resolve_pointer.py` | CLI over `resolve_paths` (no direct open) | — | yes |
| `.claude/skills/matter-data/references/scripts/check_pointers.py` | globs `*/coclerk.json`, reads each | read | yes |
| `.claude/skills/matter-data/references/scripts/migrate_engine.py` | `read_pointer_bytes` reads; `make_backup` writes the backup copy (line 617); `restore` reads the backup and writes `pointer_path` (line 1062) | read + write | yes |
| `.claude/skills/publish/subskills/publish-bcsc-form/scripts/steps/shared/paths.py` | reads the pointer (lines 229-271) | read | yes |
| `.claude/skills/legal-memo-extractor/scripts/extract_memo_index.py` | `standard_output_dir` reads the pointer | read | yes |
| `.claude/skills/safe-file-deletion/hooks/redirect-delete-to-trash.py` | the delete hook's matter marker — owned by the sibling spec (`2026-10-16_delete-hook-home-and-matter-folders-spec.md`), which is teaching it both names | read | sibling |

The spec's §10 says "the Python scripts under `.claude/skills/*/references/scripts/`"; at HEAD the pointer-opening Python also lives under `.claude/skills/publish/**/scripts/` and `.claude/skills/legal-memo-extractor/scripts/`, listed above.

Skill text with executable file-name behaviour (not just prose): `matter-data/operations/initialize.md` (native Read/Write of the pointer, steps 1/4), `matter-data/shared/conventions.md` §2.1-§2.3 (pointer form and resolution contract), `matter-data/operations/pointer-health.md` (runs check_pointers), `probanda-setup/SKILL.md` (creates the device file via `config_set_root`).

### Skill text that names the file (grep, `.claude/skills/**/*.md`, HEAD)

assemble (4 SUBSKILL.md), build-timeline (SKILL.md + 3 reference files), calculate/references/bill-of-costs-workspace.md, matter-data (SKILL.md, shared/conventions.md, references/scripts.md, 24 operations/*.md), draft/references (4), drafting-data/SKILL.md, executive-assistant/SKILL.md, file-review-prep/SKILL.md, file-sorting/profiles/litigation-matter/profile.md, housekeeping/SKILL.md, invoice-tracking/SKILL.md, legal-memo-extractor/SKILL.md, matter-status-tracking/SKILL.md, polish-substance/SKILL.md, practice-data/SKILL.md, probanda-setup/SKILL.md, probanda-troubleshooting/SKILL.md, publish (8 SUBSKILL.md + 3 references), reflect/SKILL.md, retainer-tracking (SKILL.md, protocols/FirstImport.md), safe-file-deletion/SKILL.md (sibling's), shared (html-pages.md, knowledge-tree.md, legal-research.md, live-issue-test.md, workspace-output-rule.md), timecamping (SKILL.md, reference/SyncoPaidCaptures.md), timecamping-data/SKILL.md, time-pipeline-data/SKILL.md, time-sorting (SKILL.md, protocols/FirstSetup.md).

Also: `source/legal/mcp/src/schema-gen.ts` tool descriptions, comments in 20 further `mcp/src` files (no opens), and the `mcp/test/` and skill `tests/` fixtures (out of this spec's scope: no test changes).
