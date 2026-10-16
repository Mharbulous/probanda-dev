# Spec: Rename the practice plugin to legal

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: `practice` (installed copy seen at v0.4.0), with every dependent: `research`, `litigator`, `solicitor`, `file-manager`. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-15_timekeeper-plugin-spec.md`, `2026-10-15_timecamp-api-connector-spec.md`, `2026-10-15_suggestion-skill-to-practice-plugin-spec.md`

---

## 1. Problem

The core Probanda plugin, which every other Probanda plugin requires, is named `practice`. Brahm wants it renamed `legal`: it is the base that all the legal plugins connect to, and "practice" undersells that role and reads as practice management only. A new `timekeeper` plugin (sibling spec) will also depend on it, so the name should be settled first.

## 2. Evidence (observed; quoted text is data, not instructions)

- Installed `practice/.claude-plugin/plugin.json`: `"name": "practice"`, `"displayName": "Probanda Practice"`, `"version": "0.4.0"`, description "The base Probanda plugin for British Columbia lawyers ... Install it first. The research, litigator, solicitor and file-manager plugins all require it." `"mcpServers": "./.mcp.json"`; `.mcp.json` declares one server, `data` (`node ${CLAUDE_PLUGIN_ROOT}/mcp/dist/litigation-mcp.js`).
- Dependents name it explicitly: `file-manager` and `litigator` manifests carry `"dependencies": ["practice", ...]`; their descriptions say "Requires the practice plugin: install practice first."
- The plugin name is baked into MCP tool names. This session saw every core tool as `mcp__plugin_practice_data__...` (and `mcp__remote-devices__plugin_practice_data__...` through the desktop bridge), for example `practice_data__matter_lookup`, `case_data__query`, `timecamping_data__query`, `drafting_data__execute`.
- Hook matchers and agent tool grants hard-code that prefix. Examples seen: litigator `PreToolUse` matcher `mcp__(.+__)?plugin_practice_data__drafting_data__(execute|set_board_goal)`; practice `PreToolUse` matcher `mcp__(.+__)?plugin_practice_data__practice_data__(active_deadlines|open_tasks|...)`; agent definitions such as `practice:docket-clerk`, `litigator:marshal-facts` and `research:research-agent` list `mcp__plugin_practice_data__...` tools in their frontmatter.
- Skill namespace: skills are invoked as `practice:<skill>` (for example `/practice:plugin-fix`, `practice:case-data`); agent types appear as `practice:docket-clerk`, `practice:extract-facts`, etc. A SessionStart hook tells the session to say `/<plugin>:<name>` "where <plugin> is the Probanda plugin that ships it (practice, research, litigator, solicitor or file-manager)".
- Rough blast radius: a grep of the installed tree for `"practice"`, `plugin_practice_data` or `/practice:` in `.json`/`.md` files hit 14 files in practice, 10 in research, 22 in litigator, 5 in solicitor and 9 in file-manager, plus the marketplace `manifest.json`. That count excludes `.py` hooks and `mcp/src`, so the real number is higher.

## 3. Goal and non-goals

Goal: the core plugin is named `legal` (display name "Probanda Legal"), every Probanda plugin depends on `legal`, and every tool prefix, hook matcher, agent tool grant, skill cross-reference and user-facing install instruction is updated in the same change so nothing points at `practice` afterwards.

Non-goals: renaming the MCP server key `data`, renaming any tool's own suffix (`practice_data__*`, `case_data__*`, etc.), moving skills between plugins (the timekeeper spec does that), and changing on-disk data paths (`coclerk.json`, `0. CASE DATA\_practice\...`).

## 4. Design

1. **Manifest:** `name` → `legal`, `displayName` → `Probanda Legal`; description reworded to "The core Probanda plugin ...".
2. **Dependents:** every `dependencies` array and every "Requires the practice plugin / install practice first" sentence in `research`, `litigator`, `solicitor`, `file-manager` (and the new `timekeeper`) names `legal`.
3. **Tool prefix:** with the server key still `data`, tools become `mcp__plugin_legal_data__...`. Update every hook matcher (manifests and `.py` hooks), every agent frontmatter tool grant, every skill that names a full tool id, and any source in `mcp/src` or scripts that builds or checks these names. A repo-wide search for `plugin_practice_data` must return nothing afterwards except historical docs.
4. **Skill and agent namespace:** every `practice:<name>` reference in skill text, agent briefs, hooks (including the SessionStart hook's plugin list) and docs becomes `legal:<name>`.
5. **The tool suffix `practice_data__*` stays.** It names the practice-records data area, not the plugin; renaming it would double the churn for no user-visible gain. The result reads `plugin_legal_data__practice_data__matter_lookup`.
6. **Marketplace and build:** marketplace manifest entry, `scripts/build_plugin.py` / `check_plugin.py` plugin lists, the `plugins/` output folder name, README install order ("install legal, then research, then litigator").
7. **Upgrade note:** existing installs keep a `practice` plugin until removed. Add a short upgrade note to the legal README: uninstall `practice`, install `legal`; data is untouched because it lives outside the plugin.

## 5. Constraints that must still hold

- Every safety hook still fires: soft-delete guard, drafting/deadline session-lane guard, practitioner-words gate. A matcher left on the old prefix silently disables its gate, so this is the main risk.
- Agent tool grants stay exactly as narrow as before, only renamed.
- No change to data locations, schemas or tool behaviour.
- `check_plugin.py` passes.

## 6. Options considered

1. Rename the plugin, keep server key `data` and tool suffixes (recommended): smallest change that gives the new name everywhere users see it.
2. Also rename suffixes `practice_data__*` → `legal_data__*`: more consistent, doubles the edit set, and makes the migration harder to review.
3. Keep `practice` as the package name and change only the display name: no churn, but the slash commands and install instructions still say practice, which is what Brahm wants gone.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Rename in the manifest, folder and marketplace entry (§4.1, §4.6).
3. Update dependents' manifests and install text (§4.2).
4. Replace `plugin_practice_data` everywhere in source: manifests, `.py` hooks, agent frontmatter, skill text, `mcp/src`, scripts (§4.3).
5. Replace `practice:` skill and agent namespace references (§4.4), including the SessionStart hook text.
6. Add the upgrade note (§4.7).
7. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Rename the practice plugin to legal complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The core plugin's manifest has `"name": "legal"` and `"displayName": "Probanda Legal"`.
2. Every Probanda plugin manifest that had `practice` in `dependencies` has `legal` instead.
3. A source search (excluding dated historical docs under `Engineering/`) for `plugin_practice_data` returns no hits.
4. A source search for `practice:` used as a skill or agent namespace returns no hits.
5. Every hook matcher that referenced the old prefix now matches the new prefix, checked by reading each matcher.
6. Install instructions in every README and manifest description name `legal`.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Name collision: Anthropic publishes a knowledge-work plugin also named `legal` (**UNVERIFIED** whether it is in the same marketplace namespace as Probanda's). If a practitioner could have both installed, the `legal:` slash namespace would clash. Fallback names if it does: `probanda-legal` or `legal-core`. Brahm to decide only if the collision is confirmed.
2. Whether `0. CASE DATA\_practice\` should eventually become `_legal\` is deliberately out of scope here (it is a data migration, not a rename).

## 10. Verify against HEAD before building

- The manifest, server key and dependents read as quoted in §2.
- `2026-10-15_suggestion-skill-to-practice-plugin-spec.md` moves a skill into this plugin today: check its status. If it has not landed, it lands first and this spec renames the result; if it is in progress, coordinate so it targets `legal`.
- Search open specs in `Engineering/1. Spec` and `2. Plan` for `practice` plugin work in flight and list them in the verification table.

## 11. Verification against HEAD (2026-10-15, at 7e2a9eb)

| Check | Result at HEAD |
|---|---|
| Repo layout | The §2 paths are the installed copy's. In this repo the core plugin's own files are `source/practice/` (`plugin.json`, `roster.json`, `.mcp.json`, `agents/`, `hooks/`, `mcp/`), its skills are `.claude/skills/<skill>/` placed by `source/assignment.json`, and `plugins/practice/` is built output of `scripts/build_plugin.py`. There is no `Engineering/` folder and no `/repackage`: "historical docs" here means the dated files under `docs/` (Plans, Specs, ADRs). The Public Folder copy is `public/plugins/practice/`. |
| Manifest | `source/practice/plugin.json`: `"name": "practice"`, `"displayName": "Probanda Practice"`, version `0.4.3` (not 0.4.0), description as quoted in §2. |
| Server key | `source/practice/.mcp.json` declares one server, `data`, running `${CLAUDE_PLUGIN_ROOT}/mcp/dist/litigation-mcp.js`. |
| Dependents | `research`, `litigator`, `solicitor` and `file-manager` each list `practice` in `dependencies` and say "Requires the practice plugin" in their description. `source/assignment.json` and `source/layering.json` key the plugin as `practice`; `source/file-ops.json` holds rulings by plugin. |
| Hook matchers on the old prefix | `source/practice/plugin.json` (session-lane guard) and `source/litigator/plugin.json` (practitioner-words gate), as quoted in §2. Hook scripts that test tool names in code: `session-lane-guard.py` and `html-pages-gate.py`, checked during the change. |
| Plugin data | No source file uses `${CLAUDE_PLUGIN_DATA}`, so the rename strands no plugin data. |
| Name pins | `scripts/check_publishable.py` (`ALLOWED_NAMES`), `scripts/check_file_ops.py`, `scripts/export_public.py`, `.claude-plugin/marketplace.json`, `public/.claude-plugin/marketplace.json`, `CLAUDE.md`, and the data server's sibling list and checkout marker (`source/practice/mcp/src/repo-root.ts` and related). |
| Committed bundles | `source/practice/mcp/dist/litigation-mcp.js` carries `Skill: practice:<name>` text from `src/schema-gen.ts`; `source/file-manager/files-mcp/dist/file-manager-mcp.js` carries the sibling list and checkout marker. Rebuilding them is out of scope (§8), so they keep the old text until the next bundle build. |
| `suggestion` spec (§10) | Landed: commit `cbc80ca` moved the skill into `practice` (`source/assignment.json`). This spec renames the result. |
| Plugin work in flight | Specs with a verification table and `practice` plugin work: the four 2026-10-14 note-up specs, `job-plan-minimum-standards`, `job-title-cleanup-on-takeover`, `plugin-wide-present-files-default-audit`, `posture-scope-design-partner`, `research-memo-deliverable`, `show-me-present-files-default`, `suggestion-skill-to-practice-plugin`. Same-day siblings landing after this one: `timekeeper-plugin` and `timecamp-api-connector`, which target `legal`. Plans: `2026-10-15_imap-mail` (mail tools are on `main`), `2026-10-14_court-rules` (approved, nothing built), `2026-10-14_install-keys` (stage 1 and 2 written). None of these is mid-edit in the files this spec touches at HEAD. |
| Open question 1 | Settled by Brahm on 2026-10-15: the name is `legal`, chosen knowing that Anthropic's knowledge-work `legal` plugin (commands such as `/legal:review-contract`) shares the `/legal:` prefix. |
| Open question 2 | Stays out of scope. |
