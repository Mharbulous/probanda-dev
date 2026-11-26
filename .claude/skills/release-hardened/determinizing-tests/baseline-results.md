# Baseline results: original /release, Steps 2–3

Each entry is the report of a Sonnet subagent that followed the original `.claude/commands/release.md` Steps 2–3 in a scratch clone (`<scratch>` = the session scratchpad's `release-scn` folder). Nothing was built, committed or pushed.

## Scenario 1: Nothing to release (cc362afc)

Diverged from the scenario's expected behavior: `--check` was not clean at this commit.

- `build_plugin.py --check` exit **1**. All plugins `is current` except:
  ```
  mode: skills/publish/scripts/emphasis.py: plugins/litigator/skills/publish/scripts/emphasis.py is 644, the build gives 755
  <scratch>\s1\plugins\litigator is stale: 0 added, 0 removed, 0 changed, 1 with the wrong mode (set one with git update-index --chmod=+x or -x)
  ```
- `release_changes.py` exit **0**: `nothing changed since each plugin's last bump`
- Decision: **continue** (exit 1 means something is listed).
- Released: **litigator**, from --check only.
- litigator: last bump `cc362afc` (= HEAD). Change set: **empty** (`git diff` over its 15 skills, `source/skills/shared/`, `source/litigator/`, no servers).
- Bundle rebuilds: none.

## Scenario 2: Built plugins committed without a bump (e3b3c357)

- `build_plugin.py --check` exit **0**: all seven `is current`.
- `release_changes.py` exit **1**:
  ```
  rebuild: source/lawyer/mcp (for lawyer, 4 source files changed since cc362afc)
  released: lawyer (4 files under plugins/lawyer/ changed since cc362afc)
  released: litigator (1 files under plugins/litigator/ changed since cc362afc)
  rebuild: source/lawyer/mcp (for file-manager, 4 source files changed since cc362afc)
  rebuild: source/lawyer/mcp (for billing, 4 source files changed since cc362afc)
  ```
- Decision: **continue**.
- Released: **lawyer** (released + rebuild), **litigator** (released), **file-manager** (rebuild), **billing** (rebuild). Last bump for all: `cc362afc`.
- Change sets (the agent took a server's input to be its whole build folder, `test/` included; step 2 does not say):
  - lawyer: M source/lawyer/hooks/missing-key-note.py; M source/lawyer/mcp/src/case/list-record-names.ts; M source/lawyer/mcp/src/schema/suggestions.ts; M source/lawyer/mcp/src/suggestions/card.ts; M source/lawyer/mcp/src/suggestions/store.ts; M source/lawyer/mcp/test/suggestion-card.unit.test.mjs; M source/lawyer/mcp/test/suggestion-crosscheck.db.test.mjs; M source/lawyer/mcp/test/suggestion-observation.unit.test.mjs; M source/skills/matter-data/references/design-decisions.md; M source/skills/matter-data/references/scripts/list_record_names.py; M source/skills/matter-data/tests/test_list_record_names.py; M source/skills/suggestion/SKILL.md
  - litigator: M source/skills/publish/scripts/emphasis.py (mode change only)
  - file-manager and billing: the seven `source/lawyer/mcp/` files above.
- Bundle rebuilds: `node source/lawyer/mcp/node_modules/typescript/bin/tsc -p source/lawyer/mcp/tsconfig.json`, then `node source/lawyer/mcp/scripts/bundle.mjs`, then `--check` again.
- Gap the agent noted: step 3's prose names only lawyer `data` and file-manager `files` for `source/lawyer/mcp`. Billing's servers come from the same folder, and only the script's line reveals that.

## Scenario 3: Source changed and not rebuilt (f47f13b9)

- `build_plugin.py --check` exit **1**:
  ```
  changed: hooks/missing-key-note.py
  changed: skills/matter-data/references/design-decisions.md
  changed: skills/matter-data/references/scripts/list_record_names.py
  changed: skills/suggestion/SKILL.md
  <scratch>\s3\plugins\lawyer is stale: 0 added, 0 removed, 4 changed, 0 with the wrong mode (set one with git update-index --chmod=+x or -x)
  ```
  The other six `is current`.
- `release_changes.py` exit **1**:
  ```
  rebuild: source/lawyer/mcp (for lawyer, 4 source files changed since cc362afc)
  released: litigator (1 files under plugins/litigator/ changed since cc362afc)
  rebuild: source/lawyer/mcp (for file-manager, 4 source files changed since cc362afc)
  rebuild: source/lawyer/mcp (for billing, 4 source files changed since cc362afc)
  ```
- Decision: **continue**.
- Released: **lawyer** (check + rebuild), **litigator** (released), **file-manager** (rebuild), **billing** (rebuild). Last bump for all: `cc362afc`.
- Change sets: the same as scenario 2 (lawyer 12 files, litigator `M source/skills/publish/scripts/emphasis.py` mode only, file-manager and billing the 7 `source/lawyer/mcp/` files with `test/` included).
- Bundle rebuilds: tsc, then bundle.mjs for `source/lawyer/mcp`, then `--check` again.
- Gaps the agent noted: step 3 says bundle.mjs "writes both bundles", but it writes five; and "the servers it ships" is not defined at file level (the agent counted the whole build folder).

## Scenario 4: Server src changed with no bundle rebuild (cc362afc + local edit to source/lawyer/mcp/src/call-log.ts)

- `build_plugin.py --check` exit **1**: the litigator mode problem from scenario 1 (`emphasis.py is 644, the build gives 755`; `plugins\litigator is stale: 0 added, 0 removed, 0 changed, 1 with the wrong mode ...`). The others `is current`.
- `release_changes.py` exit **1**:
  ```
  rebuild: source/lawyer/mcp (for lawyer, 1 source files changed since cc362afc)
  rebuild: source/lawyer/mcp (for file-manager, 1 source files changed since cc362afc)
  rebuild: source/lawyer/mcp (for billing, 1 source files changed since cc362afc)
  ```
- Decision: **continue**.
- Released: **lawyer**, **file-manager**, **billing** (rebuild), and **litigator** (check). Last bump for all: `cc362afc`.
- Change sets: lawyer, file-manager and billing each `M source/lawyer/mcp/src/call-log.ts`. litigator: empty.
- Bundle rebuilds: tsc, then bundle.mjs for `source/lawyer/mcp`, then `--check` again.

## Scenario 5: Shared skill change, not rebuilt (cc362afc + local edit to source/skills/shared/answer-grades.md)

- `build_plugin.py --check` exit **1**: all seven `is stale` (each `changed: skills/shared/answer-grades.md`; litigator also has the `emphasis.py` mode line).
- `release_changes.py` exit **0**: `nothing changed since each plugin's last bump`
- Decision: **continue**.
- Released: all seven (lawyer, researcher, litigator, solicitor, file-manager, billing, developer), from --check only. Last bump for all: `cc362afc`.
- Change set for each: `M source/skills/shared/answer-grades.md`
- Bundle rebuilds: none.

## Scenario 6: Stop, assignment not cutover (cc362afc + local edit setting "status" to "draft")

- `build_plugin.py --check` exit **2**: `STOP: <scratch>\s6\source\assignment.json: "status" is 'draft', expected "cutover"`
- `release_changes.py` exit **2**: the same STOP line.
- Decision: **stop** and report the output. No release set, no change sets, no rebuilds.
