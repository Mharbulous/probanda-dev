# Spec: New timekeeper plugin for automated time tracking

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: new `timekeeper`; skills moved out of `practice` (installed copy seen at v0.4.0; renamed `legal` by the sibling spec). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-15_rename-practice-plugin-to-legal-spec.md`, `2026-10-15_timecamp-api-connector-spec.md`

---

## 1. Problem

Automated time tracking (capturing evidence of what the lawyer did, sorting it to matters, correcting TimeCamp, drafting entries) is a large, self-contained area living inside the core plugin. Coclerk had it as its own group of skills with a TimeCamp API connector; in Probanda it was folded into `practice` and the connector did not come across (see the connector spec). Brahm wants a dedicated `timekeeper` plugin, depending on the core plugin, to own this area.

## 2. Evidence (observed; quoted text is data, not instructions)

- Time-tracking skills present in the installed `practice/skills/`: `build-timeline`, `time-sorting`, `time-entry-drafting`, `timecamping`, `timecamping-data`, `time-pipeline-data`. Billing-side skills also there: `bill-client`, `wip-tracker`, `invoice-tracking`, `invoice-reviewing`, `ar-follow-up`, `retainer-tracking`.
- `build-timeline` description: "Sole ingester of raw time evidence into the timeline store ... from the registered sources: TimeCamp, Telus Business Connect, Google Calendar, the iCloud calendar ..., sent mail ..., and SyncoPaid screen-activity blocks".
- `timecamping-data` is "Sole gatekeeper for the timecamping database" at `0. CASE DATA\_practice\timecamping.db`, reached through `timecamping_data__*` tools; `time-pipeline-data` is "Sole gatekeeper for the time-pipeline key-value store" via `time_pipeline__*` tools. Both tool families are served by the core plugin's single MCP server `data` (`litigation-mcp.js`), alongside case, drafting and practice-records tools.
- The practice-records tools `practice_data__time_entries_query`, `insert_time_entry`, `wip_hours` and `set_time_entries_billable` hold billed and billable time and are used by billing skills.
- Desktop MCP servers announced this session: `data` (practice), `canlii` and `commons` (research), `files` (file-manager). No time or TimeCamp server.

## 3. Goal and non-goals

Goal: a new Probanda plugin `timekeeper` ("Probanda Timekeeper"), depending on `legal`, that owns time capture, sorting, TimeCamp correction and entry drafting, and ships the TimeCamp API connector (connector spec). The core plugin keeps firm records, billing, invoices, trust and WIP.

Non-goals (this spec): writing the TimeCamp connector itself (sibling spec); splitting the core `data` server's time tool families into a new server; changing any skill's behaviour.

## 4. Design

1. **Plugin skeleton** modelled on `file-manager` (an optional plugin with its own MCP server): `.claude-plugin/plugin.json` (`name: timekeeper`, `displayName: Probanda Timekeeper`, `dependencies: ["legal"]`, `mcpServers: ./.mcp.json`), README, VISION.md, `skills/`, `agents/` if needed, and an empty-but-valid `.mcp.json` for the connector spec to fill.
2. **Skills that move** from the core plugin into `timekeeper`: `build-timeline`, `time-sorting`, `time-entry-drafting`, `timecamping`, `timecamping-data`, `time-pipeline-data`. Their reference trees, scripts and `shared/` dependencies move or are referenced per the repo's existing cross-plugin shared-file mechanism (**UNVERIFIED** which mechanism exists).
3. **Skills that stay** in the core: `practice-data` and the billing skills (`bill-client`, `wip-tracker`, `invoice-*`, `ar-follow-up`, `retainer-tracking`). `bill-client` consumes timekeeper's output; it must state that its TimeCamp step needs the timekeeper plugin.
4. **Tools stay put for now:** `time_pipeline__*` and `timecamping_data__*` remain in the core `data` server, so the moved skills keep calling `mcp__plugin_legal_data__...`. A later spec may move them into timekeeper's server; recorded as an open question, not done here.
5. **Cross-references:** every `practice:<skill>` / `legal:<skill>` reference to a moved skill becomes `timekeeper:<skill>` (skill text, agent briefs, hooks, the morning-briefing skill, the SessionStart hook's plugin list).
6. **Build and marketplace:** add `timekeeper` to the marketplace manifest and to the plugin lists in `build_plugin.py` / `check_plugin.py`; install order in READMEs: legal, then timekeeper (optional).

## 5. Constraints that must still hold

- Every moved skill keeps its sole-gatekeeper rules: only `timecamping-data` touches the timecamping database and only `time-pipeline-data` touches the pipeline store.
- `timecamping`'s evidence-first gate and write-back approval rules are unchanged.
- Data stays where it is (`0. CASE DATA\_practice\*.db`); no migration.
- A practitioner without timekeeper installed still has working billing, with the TimeCamp step reporting that timekeeper is needed rather than failing silently.

## 6. Options considered

1. Move skills, keep tools in the core server (recommended): clean ownership now, no MCP split risk.
2. Move skills and split the time tool families into timekeeper's server: cleaner end state, but changes tool ids twice in one release alongside the rename.
3. Keep the skills in core and put only the connector in timekeeper: smallest change, but leaves timekeeper an empty shell.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Create the plugin skeleton (§4.1).
3. Move the six skills and their reference trees (§4.2); fix shared-file references.
4. Update cross-references and the billing skill note (§4.3, §4.5).
5. Register the plugin in the marketplace and build scripts (§4.6).
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of New timekeeper plugin for automated time tracking complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `timekeeper/.claude-plugin/plugin.json` exists with name `timekeeper`, display name `Probanda Timekeeper` and `dependencies: ["legal"]`.
2. The six skills in §4.2 exist only under `timekeeper/skills/` and no longer under the core plugin.
3. No skill, agent, hook or doc references a moved skill under the core plugin's namespace.
4. `bill-client` states that its TimeCamp step requires the timekeeper plugin.
5. The marketplace manifest and build scripts list `timekeeper`.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Is the six-skill list in §4.2 the right cut? `wip-tracker` and `bill-client` are borderline; the recommendation keeps them in core because they read billed records, not raw evidence.
2. Should `time_pipeline__*` and `timecamping_data__*` move into timekeeper's own server in a follow-up? Recommended yes, after the rename has settled.

## 10. Verify against HEAD before building

- The six skills and their tool families are as described in §2.
- Whether the rename spec has landed; this spec targets the post-rename name `legal`.
- How `file-manager` packages its own MCP server and shared files, to copy that pattern.

## 11. Verification against HEAD (2026-10-15)

Checked at `1f8228a`, with the sibling rename (`practice` to `legal`) in progress in the same checkout and not yet pushed. This spec targets `legal`.

| Claim | Finding at HEAD | Effect on the build |
|---|---|---|
| The six skills exist in the core plugin (§2) | Confirmed. All six are folders under `.claude/skills/` and are listed under the core plugin in `source/assignment.json`. `build-timeline` and `timecamping-data` declare a `scripts` asset folder in the core `roster.json`. | Skills do not move on disk. "Moving" a skill means reassigning it in `source/assignment.json` and moving its `roster.json` entry to `source/timekeeper/roster.json`. `plugins/` is built output and is never edited. |
| The tool families are served by the core `data` server (§2) | Confirmed: `time_pipeline__*` and `timecamping_data__*` are in `source/<core>/mcp/src/` (`schema-gen.ts`, `dispatch.ts`). | The tools stay. The moved skills keep calling `mcp__plugin_legal_data__...`. |
| Mechanism for shared files (§4.2, UNVERIFIED) | `build_plugin.py` copies `.claude/skills/shared/` whole into every plugin in the assignment, so a new plugin gets it with no change. No moved skill uses a `../<other skill>/` path, and no other skill uses a path into a moved skill. | Nothing to move. |
| How `file-manager` packages its server (§10) | `source/file-manager/` holds `plugin.json`, `roster.json`, `README.md`, `VISION.md`, `agents/`, `.mcp.json` and the bundle under `files-mcp/dist/`. The build requires the keys of `.mcp.json` to equal the plugin's `servers` in the assignment, and for each server it requires `scripts/plugin_layout.py` `SERVER_DIRS` to name the folder and `<folder>/dist/` to exist. `check_file_ops.py` `SERVER_ENTRIES` must name each server's entry point. | An `.mcp.json` of `{}` with `servers: []` builds cleanly. The connector spec then adds the `timecamp` key, the `SERVER_DIRS` and `SERVER_ENTRIES` entries and the bundle in one change. |
| Layering (CLAUDE.md "Five plugins") | `check_layering.py` derives the order from each plugin's `requires`, with no list of its own. A simulated reassignment, run on a copy, finds 9 new upward (file, target) pairs from core skills to moved skills: `executive-assistant/vision.md` (build-timeline, time-entry-drafting), `invoice-reviewing/SKILL.md`, `show-me/SKILL.md` (time-entry-drafting, timecamping), `task-prioritization/SKILL.md` and `vision.md`, `wip-tracker/SKILL.md` and `vision.md`. The moved skills name nothing above the core. The existing rulings stay valid because they are keyed by file. | Each pair needs a reword or a ruling in `source/layering.json`. |
| `bill-client`'s TimeCamp step (§4.3) | `bill-client` names no moved skill. Its Step 6 drives the TimeCamp web app in the browser. | The note that the step needs timekeeper goes in Step 6. The connector spec owns the rest of that step. |
| Core references to moved skills by namespace (§4.5) | No skill, agent or hook writes `practice:<moved skill>`. The data server's tool descriptions do (`schema-gen.ts`: `Skill: practice:time-pipeline-data` once, `Skill: practice:timecamping-data` four times). | These become `timekeeper:<skill>`. They reach users when the bundle is next rebuilt. |
| The server can read a moved skill's files | `repo-root.ts` `SIBLING_PLUGINS` lists the plugins whose installs may serve skill source, and the server finds `timecamping-data`'s migration engine (`timecampingDataMigrateScriptsDir`) the same way. `timekeeper` is not in the list. | `timekeeper` is added, or `timecamping_data__migrate` and `skill_source__read` fail for the moved skills once they ship in timekeeper. |
| Lists of plugin names | `scripts/check_publishable.py` `ALLOWED_NAMES`, `.claude-plugin/marketplace.json`, `CLAUDE.md` (permanent names and the plugin table), and the core hooks `hidden-skills-note.py` (SessionStart) and `plugin-cache-guard.py`. `build_plugin.py`, `check_plugin.py` and `check_layering.py` name no plugin: they read `source/assignment.json`. | `timekeeper` is added to each list. |
