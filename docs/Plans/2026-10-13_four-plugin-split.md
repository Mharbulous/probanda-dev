# Plan: split `probanda` into four plugins

Written 2026-10-13, revised the same day after a read of the build scripts, the checks, the hook scripts, the server code and the skills the first draft had only scanned. Status: phase 0 in progress (terminal host tested 2026-10-13, desktop app and Cowork wait for Brahm). Phase 1 started in parallel, because only phase 3 depends on phase 0's answers.

Words used below. A *plugin* is one installable folder: a manifest (`plugin.json`), skills, agents, hooks and servers. A *marketplace* is the list (`.claude-plugin/marketplace.json`) a user installs plugins from. A *hook* is a small script the host runs before or after an event, and its *matcher* is the pattern that says which tool names or agent names make it run. A *server* is one of the three MCP programs the plugin starts (`data`, `canlii`, `commons`), and a *tool* is one function a server offers, named `mcp__plugin_<plugin>_<server>__<tool>`. The *roster* (`source/probanda/roster.json`) is the list of skills a plugin ships. The *bundle* is a server compiled into one file under `mcp/dist/`.

## Goal

Replace the single plugin `probanda` with four plugins in the same marketplace `probanda`:

| Plugin | Role | Requires |
|---|---|---|
| `practice` | The base. Firm records, time, billing, filing, and every part the other plugins share. | nothing |
| `research` | What the law is. | `practice` |
| `litigator` | Court work on a matter. | `practice`, `research` |
| `solicitor` | Reserved. Ships with no skills. | `practice` |

Decided by Brahm on 2026-10-13 and not open: the four names, `solicitor` empty for now, and `practice` as the plugin the others use.

Out of scope: renaming the public repository, the schema-split rebuild, and any change to what a skill does.

## Rules the end state obeys

1. **Prose points down only.** A skill, agent or hook in `practice` names nothing in another plugin. `research` names only `practice`, with one exception decided by Brahm: `verify-law` and `legal-memo-extractor` call `/case-data` (see Assignment). `litigator` names `practice` and `research`. A mention that only points the user elsewhere ("a deadline needs the `litigator` plugin") is allowed when it is worded as conditional and listed in the check's allowlist. This rule is about the text of skills, agents and hooks. The `data` server is exempt: it reads skill folders from every plugin (see decision 1), and its tool descriptions name skills in `litigator` (`schema-gen.ts` lines 527 to 710 say "Skill: probanda:case-data" and the like).
2. **A hook ships with the work it guards.** A hook goes in the plugin whose skills or server it protects, and its script stays in that plugin's source: a skill folder of that plugin, or `source/<plugin>/hooks/` (where `commons-read-only.py` already lives). A hook that enforces a firm-wide rule, so it must run even when the guarded plugin is absent, goes in `practice`. No hook may fire in fewer situations after the split than before it. A matcher changes in the same commit as the name it matches. Example: `block-subagent-legal-research` matches the host tool `Skill`, but it guards only `/legal-research`, so it ships in `research`.
3. **One source, copies only in built output.** Skills stay in the flat `.claude/skills/` tree and under `public/`. A roster per plugin assigns them. `shared/` is copied whole into every plugin by the build and exists once in source. Two reasons it must be whole: every shipped SKILL.md tells the model to find `shared/x.md` at `${CLAUDE_SKILL_DIR}/../shared/x.md`, and the `data` server treats a folder as a plugin install only when `skills/shared/` exists in it (`repo-root.ts`, `installSkillsRoot`).
4. **Skill and agent names stay unique across the four plugins**, so a bare `/show-me` never becomes ambiguous.
5. **`main` is releasable after every commit.** Until the cutover commit, `main` still builds and ships the single `probanda` plugin, and `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py` and `python -m pytest scripts/tests` pass.

## Assignment

| Plugin | Skills | Agents | Hooks | Servers |
|---|---|---|---|---|
| `practice` (30) | `practice-data`, `bill-client`, `ar-follow-up`, `invoice-reviewing`, `invoice-tracking`, `retainer-tracking`, `wip-tracker`, `matter-status-tracking`, `file-review-prep`, `task-prioritization`, `executive-assistant`, `build-timeline`, `time-sorting`, `time-entry-drafting`, `time-pipeline-data`, `timecamping`, `timecamping-data`, `route-accounting`, `rule-update`, `show-me`, `safe-file-deletion`, `find-document`, `file-naming`, `file-sorting`, `localize`, `reflect`, `plugin-fix`, `TLDR`, `proof-read`, `dyu` | `docket-clerk`, `housekeeping-reviewer`, `housekeeping-namer`, `localize-helper` | `inject-practice-quirks`, `redirect-delete-to-trash`, `staged-file-gate`, `trailing-dyu`, `session-lane-guard`, `mail-send-gate` (script moves, see below) | `data`, under decision 1 |
| `research` (7) | `legal-research`, `verify-law`, `legal-commons`, `legal-citation`, `case-brief`, `legal-memo-extractor`, `review-proposition` | `law-librarian`, `research-agent`, `research-paralegal`, `legislation-fetcher`, `verify-claim`, `troubleshooter` | `block-main-session-canlii`, `block-subagent-legal-research`, `commons-read-only` | `canlii`, `commons` |
| `litigator` (13) | `case-data`, `ingest`, `apply-to-facts`, `prepare`, `draft`, `drafting-data`, `polish-substance`, `publish`, `assemble`, `calculate`, `rule-migrate`, `litigation-fact-extractor`, `housekeeping` | `extract-affidavit`, `extract-facts`, `extract-sought-orders`, `extract-caselaw`, `extract-provision`, `verify-source`, `verify-caselaw`, `verify-edges`, `marshal-facts`, `migration-runner`, `rules-improviser`, `rules-reorienter`, `delivery-checker` | `html-pages-gate`, `practitioner-words-gate` | none |
| `solicitor` (0) | none | none | none | none |

That is 50 skills (44 roster keys, `legal-commons`, and the 5 public skills) and 23 agents of the 24 files under `source/probanda/agents/`.

Changes from the first draft, each with the reason found in the files:

- `housekeeping` goes to `litigator`. Its SKILL.md calls `/case-data` operations at every stage (`pointer-health`, `ingest-status`, `ingest-unattended`, `relocate-source`, `housekeeping-log`, lines 42 to 238) and `/drafting-data` to re-point paths. That cannot be reworded into a signpost. `route-accounting`, `file-sorting`, `file-naming`, `housekeeping-namer` and `housekeeping-reviewer` stay in `practice`: they serve the accounting root and name no litigation skill.
- `verify-law`, its agent `verify-claim` and `legal-memo-extractor` stay in `research`. Brahm decided this on 2026-10-13, against the review's default of moving them to `litigator`. Both skills call `/case-data`, which is in `litigator`: `verify-law` delegates to it to resolve the source document (lines 22 to 69) and runs its operation in edge mode (line 176), and `legal-memo-extractor` writes its index into the matter's case-data folder and delegates citation listing to it (lines 53 to 95). These calls are the one named exception to rule 1. `research` still does not require `litigator`. Phase 4 words each call so that, when `litigator` is not installed, the skill stops at that step and tells the user that the step needs the `litigator` plugin. It does not carry on without the step. Phase 1 reads both skills and records which of their modes work with `research` alone.
- `rule-migrate` stays in `litigator`. The first draft thought it might belong with `rule-update`. It does not: `rule-update` changes the court-rule overlay the docket clerk uses, while `rule-migrate` moves a `/draft` working rule onto `draft/rules/nodes/`, the rules map of the drafting skill.
- `mail-send-gate` stays in `practice`, but its script `mail-send-gate.py` moves from `.claude/skills/draft/hooks/` to `source/practice/hooks/`. It enforces the firm-wide rule that the model never sends email (`shared/email.md`), it lets the `practice` morning briefing through by subject prefix, and it reads no file from the `draft` folder (the first draft's worry). Left in `draft/hooks/`, its `${CLAUDE_PLUGIN_ROOT}/skills/draft/hooks/...` path would not exist in `practice`.
- `html-pages-gate` and `practitioner-words-gate` go to `litigator`. Both scripts live in `.claude/skills/drafting-data/hooks/`, both guard what the drafting tools produce (the Job Board pages and a job's wording), and the first draft had them in `practice` where their script path would not exist. A page exists only on a machine where `litigator` ran, so the gate fires in every situation it fires in today.
- `docket-clerk`, its `shared/docket-clerk/` tree, `rule-update` and `session-lane-guard` stay in `practice`. The guard's matcher names the deadline tools of `practice_data` and the agent `docket-clerk`, and eight `practice` skills name the clerk (`ar-follow-up`, `executive-assistant`, `file-review-prep`, `localize`, `practice-data`, `rule-update`, `show-me`, `task-prioritization`). The guard also matches `Skill` to catch the five drafting skills entering the drafting lane. Those skills are in `litigator`, but `practice` is always installed with it, so the guard still fires. Its script is in `shared/`, which every plugin ships, so the path exists.
- `troubleshooter` goes to `research` because its tools are on the `commons` server.
- `delivery-checker` is dispatched by `/draft` and `/case-data`, so it goes to `litigator` even though its one tool is `practice_data__firm_profile`.

Unplaced: the agent `equivalence-checker`. No skill, agent or hook in the repo names it (one grep hit, its own file). Default: remove it at cutover. If Brahm wants it kept, it goes to `research`, since it judges clauses of law.

Default taken here, open to Brahm: `housekeeping` moves to `litigator`. Brahm has not ruled on that move.

Still open for phase 1: `bill-client` (steps 1 and 5 use `/case-data`'s `profile`, `initialize` and `housekeeping-log` operations, with `practice-data` as the fallback), `find-document` (asks `/case-data` to resolve a name), `localize` (names `/draft` and `/publish`, which call it, so these may be signposts), `legal-research` (asks `/case-data` for a held copy and tells the caller to `ingest`, lines 72 and 91), `case-brief` (offers to persist through `case-data`, lines 135 to 139), and the agents `law-librarian` and `research-agent`, which hold a `case_data__query` grant and read the matter's case database as one of their three authority layers. Each is either reworded as conditional on `litigator` or moved.

## What the files show (2026-10-13)

Read, not scanned. Where the first draft gave a number, the corrected number follows.

- Tool names. 230 lines in 47 files under `.claude/skills/`, `public/plugins/probanda/skills/` and `source/probanda/agents/` hold `plugin_probanda_<server>__` (first draft: 138). By server: `data` 203 occurrences, `canlii` 18, `commons` 18.
- Agent and skill prefixes. 96 lines hold `probanda:` followed by a name (first draft: 76). 50 of them are `probanda:docket-clerk`. The prefix is not only for agents: `probanda:draft`, `probanda:legal-research`, `probanda:dyu`, `probanda:contract-interest-rates` and `probanda:court-interest-calculator` are skill or subskill invocations. Two name things that do not exist (`probanda:audit-agent`, `probanda:dates-and-deadlines`) and are already stale.
- Hook matchers in `source/probanda/plugin.json`: four name a `plugin_probanda_` tool, two name `probanda:docket-clerk`. Three hook scripts hold a name in code, not two: `session-lane-guard.py` (`AGENT = "probanda:docket-clerk"`), `block-main-session-canlii.py` (the tool pattern and `RESEARCH_AGENT_PREFIXES = ("probanda:",)`) and `trailing-dyu.py` (`(?:probanda:)?dyu`). The third is a public file, so changing it needs a new approval (phase 7).
- Tests that hold the names: `.claude/skills/legal-research/tests/test_canlii_guard.py`, `test_subagent_gate_guard.py`, `test_westlaw_first.py`, `.claude/skills/shared/docket-clerk/tests/test_session_lane_guard.py`, `source/probanda/tests/test_agent_shim_contract.py`, `test_trailing_dyu.py`, and every file under `scripts/tests/`.
- The server source holds the plugin name and the source path. `schema-gen.ts` bakes "Skill: probanda:case-data", "probanda:timecamping-data" and "probanda:time-pipeline-data" into tool descriptions. `repo-root.ts` recognises a checkout by the marker folder `source/probanda/mcp`. `build-stamp.ts` and `test/bundle-contract.e2e.test.mjs` read `source/probanda/mcp/dist/litigation-mcp.js`. `test/repo-root.unit.test.mjs` builds fixtures with that marker. The checked-in bundles under `mcp/dist/`, `canlii-mcp/dist/` and `commons-mcp/dist/` therefore have to be rebuilt at cutover, and the build script says they "are built elsewhere and ship byte-for-byte". Who rebuilds them, and with what, is not written down anywhere in this repo. Phase 5 must say.
- Scripts and CI that hold `source/probanda` or `plugins/probanda` as a path: `build_plugin.py`, `check_plugin.py` (`SOURCE_DIR`, `SHIPPED_DIR`, `PUBLIC_SKILLS_DIR`, `ENTRY_POINT_REGISTRY`, `RECITAL_RULE_MIRRORS`, `FETCH_GRANTS`), `check_public_tree.py` (`PRIVATE_ROOTS` and `SHARED_FILES`: with `source/probanda/` deleted, the fingerprint scan would silently stop reading the server source), `export_public.py` (`REQUIRED_FILES`, `tree_summary`), `.github/workflows/data-mcp-tests.yml` (sparse checkout and working directory), `.github/workflows/skills-python-tests.yml` (the test search path), and `README.md`.
- The two baselines under `scripts/check_plugin_baselines/` hold no plugin name. Their keys are `.claude/skills/...` paths, which do not change.
- No saved data is keyed to the plugin name. The `data` server reads its config from `%APPDATA%\Coclerk\coclerk.json` (`config-path.ts`), and the `canlii` and `commons` servers keep credentials under `%LOCALAPPDATA%` (`dpapi-store.ts` in each). No skill, agent or hook uses `${CLAUDE_PLUGIN_DATA}`. A rename strands no data.
- The `data` server reads skill folders from its own plugin's install (`resolveShippedRoot` in `repo-root.ts`). Callers: `case/backend.ts` (`case-data/references/triggers.sql`, read before every case-data write), the three migration resolvers (`case-data`, `drafting-data`, `timecamping-data`), `housekeeping/name-gate.ts` (`file-naming/scripts/name_gate.py`), `submission/bcsc-form-harness.ts`, `draft-harness.ts`, `publish-host.ts`, `scrutiny-review.ts` (scripts under `draft` and `publish`), `knowledge/tree.ts` (the trees of `draft`, `publish`, `assemble`, `legal-research` and `docket-clerk`, a list fixed in the bundle), and `files/skill-source.ts` (anything asked of `skill_source__read` or `list`). After the split those folders sit in all three plugins.
- Where an installed plugin's folder sits, on this machine. Terminal and VS Code sessions load from `~/.claude/plugins/synced/<org>_<account>/<plugin>/`, with sibling plugins as sibling folders and a `~g<N>` suffix on a newer generation (`dev-tools~g2/`). Desktop and Cowork sessions load from `%APPDATA%\Claude\local-agent-mode-sessions\<user>\<account>\rpm\plugin_<id>\`, folders named by an id, not by plugin name. Plugins installed with `claude plugin install` land in `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. So a sibling plugin cannot be found by one path rule on every host.
- Problem lines that `check_publishable.py` counts: none under `shared/`, none in `source/probanda/agents/`, none in `plugin.json` or `.mcp.json`. The copies the build makes of `shared/` therefore add no problem. The data bundle `litigation-mcp.js` holds 42 schema lines and 7 machine-path lines, so one copy of it may ship, never two.

## What the host documents say

From the Claude Code documentation, read on 2026-10-13 by a documentation agent, pages `code.claude.com/docs/en/plugins/*` and `claude.com/docs/plugins/*`. Each point is "documented" or "not documented", never tested here.

- Documented: `plugin.json` has a `dependencies` list. A bare name means a plugin in the same marketplace. Claude Code installs the dependencies with the plugin and refuses to enable a plugin whose dependency is missing. The Cowork build page lists dependencies as a Claude Code feature, not a Cowork one.
- Documented: a marketplace may list several plugins from one repository, each with its own `source` folder. A manifest with only `name`, `version` and `description` is valid.
- Documented: agents are named `<plugin>:<name>`, and a `SubagentStart` or `SubagentStop` matcher is a regular expression over that full name. Tools are named `mcp__plugin_<plugin>_<server>__<tool>`.
- Documented: removing a plugin from a marketplace does not uninstall it. The installed copy stays and reports "not found in marketplace" at session start, unless the marketplace sets `forceRemoveDeletedPlugins: true`, which uninstalls it at the next session start. Not documented for Cowork.
- Not documented: whether a skill in one plugin may call another plugin's tool or agent. The docs describe a dependency as "one whose MCP server or skill it calls", which implies yes, and state no isolation between plugins. Today the single plugin already has skills in one folder calling agents in another, and the hosts do not know folders, so the only new thing is the prefix. Phase 0 tests it.
- Not documented: where Cowork puts a plugin on disk, and whether a Cowork session can read a sibling plugin's folder.

## Decisions taken by default

Brahm can overturn any of these before the phase that uses it.

1. **Where the `data` server lives and how it finds skill folders (used in phase 3).** The server stays one program, in `practice`, keeping every tool name. Default, changed from the first draft: each plugin registers its own install folder, and the server reads the registrations. A `SessionStart` hook in each of the four plugins writes its `${CLAUDE_PLUGIN_ROOT}` under a `plugins` key in `%APPDATA%\Coclerk\coclerk.json`, the per-device file the server already reads. `resolveShippedRoot` then tries, in order: its own install, then each registered plugin folder that holds `skills/shared/` and `skills/<first segment>/`. It fails with a message naming the missing plugin when no folder has the segment. The first draft's default, guessing a sibling folder from the server's own path, fails on the desktop store, where folders are named by id. This default needs no path rule, works on any host that runs hooks with `${CLAUDE_PLUGIN_ROOT}` set, and survives the `~g<N>` generation folders because the newest session rewrites the entry. Phase 0 confirms that each plugin's `SessionStart` hook runs on each host with that variable set. If it does not on some host, the fallback is one server bundle per plugin, each reading only its own folders, with the `data` tools divided among them. That fallback renames most tool names a second time and copies the bundle's 49 problem lines into each plugin, which `check_publishable.py --new-since` refuses, so it is the last resort.
2. **Server keys.** `data`, `canlii` and `commons` keep their keys. Only the plugin part of each tool name changes.
3. **The old plugin.** `probanda` is removed from the marketplace in the cutover commit, and the marketplace sets `forceRemoveDeletedPlugins: true` so Claude Code uninstalls it at the next session start. Whether Cowork honours that flag is unknown, so phase 6 still has each machine check and uninstall by hand.
4. **Versions.** Each plugin starts at `0.2.0` and is versioned on its own from then on. The public plugins start at `0.0.1`, as the one public plugin does now.
5. **Public plugin.** The five public skills follow the assignment: `legal-citation` to `research`, `litigation-fact-extractor` to `litigator`, `TLDR`, `proof-read` and `dyu` to `practice`. Publication waits for Brahm's express instruction, as always.
6. **Requires.** Each `plugin.json` declares its `dependencies` as the goal table says. Where a host ignores the field (Cowork, per its docs), a skill that needs a missing plugin fails with the wording phase 4 adds.
7. **Where the server source lives.** `source/probanda/mcp/`, `canlii-mcp/` and `commons-mcp/` move to `source/practice/mcp/`, `source/research/canlii-mcp/` and `source/research/commons-mcp/` at cutover, and every path listed under "What the files show" changes in the same commit. The alternative, a neutral `source/servers/` folder that the four plugin folders point at, is simpler for the checks but puts the server outside the plugin that ships it. Phase 2 may choose the neutral folder if the per-plugin move makes `check_public_tree.py`'s fingerprint roots or the CI sparse checkouts awkward.

## Phases

Each phase ends with its check passing, a commit and a push.

### Phase 0: find out what the hosts allow

Build a throwaway marketplace outside this repo with two plugins, `a` and `b`, where `b` declares `dependencies: ["a"]`, `b` has a skill that calls a tool on `a`'s server and dispatches `a:agent`, each has a `SessionStart` hook that writes `${CLAUDE_PLUGIN_ROOT}` to a temp file, and a third plugin `c` has a manifest only. Install it in a terminal session, the desktop app and Cowork, and record per host:

- whether `dependencies` installs `a` with `b`, and what the user sees when `a` is removed,
- whether `b`'s skill can call `a`'s tool and `a`'s agent,
- whether `c` installs,
- whether each plugin's `SessionStart` hook ran and what `${CLAUDE_PLUGIN_ROOT}` held,
- what happens to an installed plugin after it is removed from the marketplace, with and without `forceRemoveDeletedPlugins`.

Check: a table of the five answers per host, written into this plan under decision 1 and decision 3. This phase needs Brahm for the installs and the "Check for updates" press, because no session can trigger a sync.

#### Phase 0 results

The test marketplace is the private repository `Mharbulous/host-probe` (marketplace `host-probe`, plugins `probea`, `probeb`, `probec`), with a local checkout beside this repo. `probeb` depends on `probea`, and its skill `/probe-check` calls `mcp__plugin_probea_echo__where`, dispatches `probea:echo-agent` and prints a report. The `where` tool also says whether `probea`'s server can read a file inside each folder a `SessionStart` hook registered, which is the lookup decision 1 relies on. Delete the repository and uninstall the three plugins once all three hosts are recorded.

| Question | Terminal, installed with `claude plugin install` (tested 2026-10-13) | Terminal, synced from claude.ai | Desktop app | Cowork |
|---|---|---|---|---|
| Does `dependencies` install `probea` with `probeb`? | Yes: "+ 1 dependency: probea". | waits for Brahm | waits for Brahm | waits for Brahm |
| What happens when `probea` is removed? | The uninstall succeeds with "warning: required by probeb". `probeb` then shows "failed to load", "Dependency "probea@host-probe" is not installed", and its skill is absent from the next session. The session itself shows no warning. | waits | waits | waits |
| Can `probeb`'s skill call `probea`'s tool and agent? | Yes, both. The tool was called under its plain name. | waits | waits | waits |
| Does `probec` (manifest only) install? | Yes. | waits | waits | waits |
| Did each `SessionStart` hook run, and what did `${CLAUDE_PLUGIN_ROOT}` hold? | Both ran. The variable held each plugin's own folder, both as an expanded argument and in the hook's environment. The server's environment held it too, and the server could read the marker file in both registered folders. | waits | waits | waits |
| After `probec` is removed from the marketplace, no flag | It stays installed and shows "failed to load", "Plugin probec not found in marketplace host-probe". | waits | waits | waits |
| The same, with `forceRemoveDeletedPlugins: true` | It is uninstalled at the next session start. | waits | waits | waits |

On the terminal host with `claude plugin install`, decision 1 (registration by `SessionStart` hook) and decision 3 (`forceRemoveDeletedPlugins`) both work as the plan assumes.

### Phase 1: confirm the assignment and list every upward reference

For each of the 50 skills and 24 agents, read it and record its plugin, every skill, agent, tool and `shared/` file it names, and whether each upward reference is a signpost or a real call. Resolve each real upward call by moving the unit or by rewording the caller so the work is offered only when the other plugin is present. Settle the items listed as "still open" above, and find a caller for `equivalence-checker` or confirm it has none.

Check: a committed `source/assignment.json` naming a plugin for every skill, agent, hook script and server, and a script `scripts/check_layering.py` that lists every upward reference and fails on any not in its allowlist. At the end of this phase it runs with `--report` and its output matches a committed list of the real upward calls still to fix. The strict run is phase 4's check. (The first draft said the check "fails now and passes at the end of phase 4", which breaks rule 5 for phases 1 to 3.)

### Phase 2: teach the build and the checks about several plugins

`scripts/build_plugin.py` builds every plugin named in `source/assignment.json` from `source/<plugin>/` into `plugins/<plugin>/`, stamping each SKILL.md with that plugin's name and version. `scripts/check_plugin.py` runs its invariants per plugin and gains three: names unique across plugins, the rule 1 check from phase 1, and rule 2 (every hook matcher names a tool its own plugin ships, a host tool, or an agent its own plugin ships). `OLD_IDENTIFIERS` gains `plugin_probanda_` and `probanda:` followed by a letter, applied only to a plugin not named `probanda`. `check_publishable.py` gains the four names in `ALLOWED_NAMES`. Brahm instructed the four names on 2026-10-13, which is the deliberate act that list asks for. `check_public_tree.py`, `export_public.py` and the two CI workflows take their paths from the assignment file or from a list, not from the literal `probanda`. Every test under `scripts/tests/` that builds a fixture named `probanda` is parameterised.

Until cutover the assignment file lists one plugin, `probanda`, holding everything.

Check: `python scripts/build_plugin.py --check` reports `plugins/probanda` current with no byte changed, `python scripts/check_plugin.py` passes, and `python -m pytest scripts/tests` passes, including a new test that builds a two-plugin fixture and asserts that `shared/` lands in both, that each SKILL.md carries its own plugin's stamp, and that a hook whose script path does not exist in its plugin fails the build.

### Phase 3: make the data server find skill folders across plugins

Carry out decision 1 as settled by phase 0. With one plugin installed the new lookup finds only its own install, so this ships before cutover.

Check: `npm test` in the server folder passes, plus new tests that serve a skill folder from a registered second install, that ignore a registered folder with no `skills/shared/`, and that fail by name when no registered folder holds the segment.

### Phase 4: rewrite the references

In source, with the single plugin still shipping: remove or reword every real upward reference from phase 1, and move `mail-send-gate.py` to `source/probanda/hooks/` with its `plugin.json` path. This phase changes prose and one file location. Names that depend on the plugin name are not touched yet.

Check: `python scripts/check_layering.py` passes strict. `build_plugin.py --check`, `check_plugin.py` and the Python tests pass.

### Phase 5: cutover, in one commit

1. Create `source/practice/`, `source/research/`, `source/litigator/` and `source/solicitor/`, each with its `plugin.json` (with `dependencies`), roster, `README.md`, `VISION.md`, agents and hooks. Move the server folders per decision 7. Delete `source/probanda/`.
2. Rename every `plugin_probanda_<server>__` to the plugin that ships that server (`practice` for `data`, `research` for `canlii` and `commons`), in skills, agents, hook matchers, hook scripts and tests, in both the plain and the `mcp__remote-devices__` bridged form. Rename every `probanda:<name>` to the plugin that ships `<name>`, not the plugin of the file that mentions it: `probanda:docket-clerk` becomes `practice:docket-clerk` in a `litigator` skill too. Drop the two stale names. Change `schema-gen.ts`, `repo-root.ts`'s checkout marker, `build-stamp.ts` and the server tests, then rebuild the three bundles and commit the new `dist/` files. Say in the commit message which machine and command built them.
3. Fill `source/assignment.json` with the four plugins.
4. List the four plugins in `.claude-plugin/marketplace.json`, remove `probanda`, and set `forceRemoveDeletedPlugins: true`. Build. `plugins/probanda/` disappears and four folders appear.
5. Update `CLAUDE.md`: the build and release sections, "Permanent names" (the four plugin names join the list) and "One plugin" (replaced by the layering rule). Update `README.md`.

Checks: `build_plugin.py --check` and `check_plugin.py` pass for all four. A search of the four built folders for `plugin_probanda_` and for `probanda:` followed by a letter finds nothing. `python -m pytest scripts/tests` and the server suite pass. `python scripts/check_publishable.py --new-since origin/main` passes. That last check matches a problem line by its text, so a line that moves to another file adds nothing, but a line that is copied, or whose text changes, counts as new. The data bundle is the one file at risk: it holds 49 problem lines, it is rebuilt in this commit, and it must ship in `practice` only. If the rebuilt bundle shows a new problem line, the fix is in the server source, never in the check.

### Phase 6: move each machine over

Brahm, on each machine: press "Check for updates" on the marketplace, confirm `probanda` is gone (uninstall it by hand if it is still listed), install `practice`, `research` and `litigator`. Then a session on that machine checks:

- every scheduled task and every permission allowlist that names `plugin_probanda` or a `probanda:` name, in the user settings, this repo's `.claude/` settings and the settings files under the case-data root. On 2026-10-13 neither this repo's `.claude/settings.json` nor the user's `settings.json` held one. Each found is rewritten to the new names.
- a morning briefing, a deadline listing, a research question and a draft session each run end to end, and `skill_source__read` serves a `litigator` skill file from a `practice` session.

Check: the five runs complete, and a search of those settings files for the old names finds nothing.

### Phase 7: the public plugin

Move the five public skills to `public/plugins/<plugin>/skills/`, give each public plugin its `.claude-plugin/plugin.json`, list the four in the public `marketplace.json`, change `trailing-dyu.py`'s prefix to `practice:`, and update `export_public.py`'s required files and `check_public_tree.py`. Every moved or changed file leaves `public-approved.json`, so `export_public.py --plan` refuses until Brahm instructs a new approval. Approval and publication happen only on his express instruction.

Check: `python scripts/check_public_tree.py` passes and, once approved, `python scripts/export_public.py --plan` reports that every check passed.

## Risks

- **Phase 0 may show that Cowork ignores `dependencies`.** Then a dependent skill must stop with a message naming the missing plugin, and phase 4 adds that wording. The docs already say Cowork treats dependencies as a Claude Code feature, so plan for this.
- **Phase 0 may show that a plugin's `SessionStart` hook does not run on some host, or runs without `${CLAUDE_PLUGIN_ROOT}`.** Then decision 1's registration fails there and the fallback applies, with its second rename and its bundle copies.
- **`research` is thin and still leans on `litigator`.** Even after the three moves, `legal-research`, `case-brief`, `law-librarian` and `research-agent` read the matter's case data when it exists. If phase 1 finds that rewording them as conditional loses real behaviour, the choice between making `research` require `litigator` and merging the two goes back to Brahm.
- **Cutover is one large commit, and it rebuilds the bundles.** It cannot be split, because a half-renamed tool name leaves a hook that matches nothing, which rule 2 forbids. The bundle rebuild is the step most likely to add a problem line or a machine path, so run `check_publishable.py --new-since` and `check_plugin.py`'s `bundle-no-host-path` before pushing.
- **The first sync after cutover.** A machine that syncs before `probanda` is uninstalled shows no duplicates, because the old plugin is gone from the marketplace, but its installed copy keeps running stale skills until the host removes it or Brahm does.
- **Public approval.** Phase 7 changes every public path, so nothing can be published until Brahm re-approves the whole public tree.
