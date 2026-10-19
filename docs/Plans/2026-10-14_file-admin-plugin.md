# Plan: split out a `file-admin` plugin

**Status (2026-10-14).** Approved by Brahm. Later the same day Brahm made the split a five-plugin split: this plan is now carried out inside phase 5 (the cutover) of `docs/Plans/2026-10-13_four-plugin-split.md`, which is the source for sequencing. Step 0 and step 5 below apply only if it were ever run on its own. Nothing is built yet.

## Context

Some practitioners want Probanda without letting it rename, move or delete their files. Today those capabilities sit in `practice` (after cutover) and on the shared `data` server, so there is no single switch. Goal: disabling the `file-admin` plugin removes every such tool, skill and agent, while `practice`, `research`, `litigator` and `solicitor` keep working.

Decided by Brahm on 2026-10-14:
- **Sequencing.** Built in the cutover commit (phase 5, step 0, of `docs/Plans/2026-10-13_four-plugin-split.md`), on the `cutover` branch in worktree `../probanda-cutover`. All paths below are cutover paths (`source/practice/...`).
- **Scope.** Only the brief's list moves: `file_ops__*`, `housekeeping__*`, the rename and route apply scripts, `housekeeping`, `route-accounting`, `file-sorting`, and the two housekeeping agents. These stay put:
  - `research_filing__file_download` (moves a file out of Downloads)
  - render-time archiving in `submission/forms.ts:260-327`
  - `submission/matter-pages.ts:37,257`, which trashes old page files that Probanda itself generated
  - create-only tools: `file_fetched`, `legislation-fetcher`, and `publish` writing a new vN file

Duplication check (2026-10-14): no plan or commit covers this. Sessions -60, -c9 and -59 said they are not on it. The message to -65 expired unread.

## Deviations from the brief's scope line (approve with this plan)

1. **The new server bundle is built here.** This repo has no `/repackage`. `build_plugin.py:328-335` stops when a server's `dist/` is missing, so `check_plugin.py` cannot pass without the bundle. Build it the way the four-plugin plan does: `npm run build` then `node scripts/bundle.mjs` in `source/practice/mcp/`, and commit both bundles. Run no test suite.
2. **Versions.** `file-admin` starts at `0.2.0`, as every plugin does at cutover (split plan, decision 4).
3. **Tests are not updated** (the brief forbids it). `scripts/tests/test_build_plugin.py:14` (the `PLUGINS` tuple) will then be stale. The final report says so.

## Design

### Server: second entry point, new server key `files`

The data server has no tool-subset switch (`index.ts:33-48`, no argv or env selection), and one bundle may ship only once (`check_publishable --new-since` counts a byte copy as 49 new problems). So file-admin ships its own **small bundle** built from the same source:

- In `schema-gen.ts`, split `file_ops__trash` and `file_ops__move` (lines ~1071, ~1086) out of `fileToolDefinitions()` into a new `fileOpsToolDefinitions()`. Practice's `buildToolDefinitions()` drops that group and `housekeepingToolDefinitions()`. Add `buildFileAdminToolDefinitions()` = those two groups.
- In `dispatch.ts`, give each entry its own allowed set, so the practice server refuses a `file_ops__*` or `housekeeping__*` call even by name. `toolDefinition()` (:726-733) looks names up in the map of the running entry.
- Add `src/file-admin-index.ts`. It runs the same MCP setup as `index.ts`, with server name `file-admin-mcp` and the file-admin definitions. It does **not** start the page API (fixed port 47615). The housekeeping page server (port 0) runs in this process, so `serve_page` and `wait_approval` stay together.
- `scripts/bundle.mjs` gains a second entry that writes `source/file-admin/files-mcp/dist/file-admin-mcp.js`.
- `repo-root.ts:247`: `SIBLING_PLUGINS` adds `practice` and `file-admin`. The file-admin server can then reach `file-naming/scripts/name_gate.py` (`housekeeping/name-gate.ts:50-69`), and practice's `skill_source__read` can reach `file-sorting/` for `housekeeping-namer`.
- `file_ops/move.ts:19-21` imports from `housekeeping/`. Both go into the file-admin bundle, so nothing changes there.
- Server key `files` becomes permanent once published. Tool names become `mcp__plugin_file-admin_files__file_ops__move`, and so on.

### Plugin and build wiring

- `source/assignment.json`: add `file-admin` with `requires: ["practice"]`, `servers: ["files"]`, its skills and agents. Remove those from `practice`.
- `source/file-admin/`:
  - `plugin.json` with name `file-admin`, version `0.2.0`, `dependencies: ["practice"]`, and `mcpServers`
  - `.mcp.json`: `{"files": {"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/files-mcp/dist/file-admin-mcp.js"]}}`
  - `roster.json`, `README.md`, `VISION.md`
  - `agents/housekeeping-namer.md` and `agents/housekeeping-reviewer.md`, moved from `source/practice/agents/`
- `scripts/plugin_layout.py:22`: add `"files": "files-mcp"` to `SERVER_DIRS`.
- `scripts/check_publishable.py:27`: add `file-admin` to `ALLOWED_NAMES`. The brief names the plugin, so this is the deliberate act that list asks for.
- `.claude-plugin/marketplace.json`: add a `file-admin` entry whose description says it requires `practice`.
- `scripts/check_layering.py`: add a file-admin tool-family list beside `LITIGATOR_TOOL_FAMILIES` (:46) with `file_ops__` and `housekeeping__`, so a mention of them in `practice`, `research` or `litigator` is flagged. Each remaining mention gets a `conditional` ruling in `source/layering.json`.
- `check_plugin.py`: confirm `bundle-no-host-path` and the bundle pin (:151) cover the new bundle too. Extend them only if they skip it.

### Skills

- Move to file-admin via assignment and roster:
  - `housekeeping`
  - `route-accounting`
  - `file-sorting`
  - a new internal skill `file-apply`. It takes the `apply` and `apply-route` intents (file-naming `SKILL.md:88-141`) and `scripts/apply_renames.py` and `scripts/apply_routes.py`. If `hash_files.py` has no caller outside housekeeping (grep first), it moves too.

  Skills ship whole by folder, and `unique-names` forbids splitting `file-naming`, so the apply engine needs its own folder.
- `file-naming` keeps `gate` and `propose`. Its description and intent table (:3, :11-14) drop "apply". Its pointer for caller pipelines (:143+) says that applying is `/file-apply`, in file-admin.
- Fix the cross-plugin relative paths:
  - `housekeeping/SKILL.md:44,109` (`../file-naming/scripts/name_gate.py`, `hash_files.py`). Use the `housekeeping__*` server path if one already runs the gate. Otherwise invoke `/file-naming gate` (a cross-plugin skill call works, per phase 0).
  - `route-accounting/SKILL.md:329` points to `../file-apply/scripts/apply_routes.py`.
- Rename tool prefixes in the moved skills (`housekeeping/SKILL.md:45` and every `plugin_practice_data__file_ops__` / `__housekeeping__`, plain and `mcp__remote-devices__` form). Rename `practice:housekeeping-namer/-reviewer` to `file-admin:...`.

### Absence branches: core callers stop and tell

Use one wording pattern: "If `<tool>` is not available in this session, the `file-admin` plugin is not enabled: stop, tell the practitioner that this step moves or trashes a file and needs `file-admin`, and do nothing else. Never fall back to shell `mv`/`rm` or the Write tool."

- `matter-data/operations/supersede-draft.md:270`: step 2 (`file_ops__move`), and step 3 that depends on it.
- `safe-file-deletion/SKILL.md:10,36-47`: remove the shell `mkdir -p` + `mv` fallback (:37, :47) and replace it with the stop branch. Fix the stale `plugins/litigation/...` text at :11. The skill stays in `practice`.
- `safe-file-deletion/hooks/redirect-delete-to-trash.py:32,741,801`: the deny message names the file-admin tool and says that without file-admin the deletion is refused. The hook stays in `practice/plugin.json:14-28`, unchanged otherwise.
- `bill-client/SKILL.md:44`: the `/housekeeping` signpost says it needs `file-admin`.
- `litigator`:
  - `draft/references/letters.md:367`
  - `draft/references/substance-and-revise.md:42`
  - `publish/subskills/renumber-affidavit/SUBSKILL.md:18,87` (apply, now `/file-apply`) and `:93-97` (trash)
- `shared/workspace-output-rule.md:14`.
- Mentions only, reworded as conditional where they name a moved skill: `matter-data/SKILL.md:69,72`, `matter-data/operations/housekeeping-log.md:5`, `ingest-extract.md:70`, `show-me/SKILL.md:28`. `research/legal-memo-extractor/SKILL.md:97` is already a signpost. Rule it.

### Docs

- `source/file-admin/README.md`: what it holds, and that it requires `practice`. Add the note: "The host's own shell (`device_bash` in Cowork, Bash/PowerShell elsewhere) can still create and rename files in a connected folder. That access is outside any plugin's control. Disabling file-admin removes Probanda's file tools, not the host's."
- `source/practice/README.md`: the install list adds `file-admin` as optional, with the same note.
- `CLAUDE.md` "Permanent names": add `file-admin` and server key `files`.

## Steps and checks

0. Confirm that `cutover` is merged into `main` (`git log main` holds the cutover commit, and `source/practice/` exists). If not, stop. Copy this plan to `docs/Plans/2026-10-14_file-admin-plugin.md`. Check: the file exists.
1. Server split (schema-gen, dispatch, new entry, bundle.mjs, repo-root). Check: `npx tsc --noEmit` in `source/practice/mcp/`, then build both bundles. `ListTools` from each bundle (one-shot `node` stdin call) shows that file_ops/housekeeping appear only in the new one.
2. Plugin wiring (assignment, source/file-admin, plugin_layout, marketplace, publishable names, layering). Check: `python scripts/build_plugin.py` succeeds and `plugins/file-admin/` exists.
3. Skill moves, `file-apply`, path and prefix fixes, absence branches. Check, as the brief requires: grep `file_ops__move|file_ops__trash|apply_renames|apply_routes|housekeeping__` over `plugins/` outside `plugins/file-admin/` finds only absence-handling text or ruled mentions.
4. Docs and version bumps. Check: `python scripts/check_plugin.py` passes for all five plugins, `python scripts/check_layering.py` passes strict, `python scripts/build_plugin.py --check` reports current, and `python scripts/check_publishable.py --new-since origin/main` adds no problem. If the new bundle carries a problem line, fix its imports, never the check.
5. `git ls-files -s plugins/file-admin` shows no `100644` `.py` script (use `git update-index --chmod=+x` per the four-plugin plan's phase 4 note). Commit by pathspec, pull `--ff-only`, push.

## Verification against the brief's criteria

| Criterion | Check |
|---|---|
| Nothing outside file-admin can rename, move or delete a user file | Step 3 grep, plus `ListTools` on practice's bundle |
| Manifest declares the server, skills and agents. Core no longer serves the tools | `plugins/file-admin/.claude-plugin/plugin.json` and `.mcp.json`, and the step 1 `ListTools` |
| Delete-redirect hook in a plugin that stays enabled | `plugins/practice/.claude-plugin/plugin.json` still declares it |
| Each core caller has a stop branch | Read each file listed under "Absence branches" |
| `check_plugin.py` passes for every plugin | Step 4 |
| README note on `device_bash` | Read both READMEs |

Live proof (disable file-admin in Cowork, then try supersede-draft) happens after release, in Cowork.
