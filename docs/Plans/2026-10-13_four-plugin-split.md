# Plan: split `probanda` into four plugins

Written 2026-10-13. Status: not started.

## Goal

Replace the single plugin `probanda` with four plugins in the same marketplace `probanda`:

| Plugin | Role | Requires |
|---|---|---|
| `practice` | The base. Firm records, time, billing, filing, and every part the other plugins share. | nothing |
| `research` | What the law is. | `practice` |
| `litigator` | Court work on a matter. | `practice`, `research` |
| `solicitor` | Reserved. Ships with no skills. | `practice` |

Decided by Brahm on 2026-10-13: the four names, `solicitor` empty for now, and `practice` as the plugin the others use.

Out of scope: renaming the public repository, the schema-split rebuild, and any change to what a skill does.

## Rules the end state obeys

1. **References point down only.** `practice` names nothing in another plugin. `research` names only `practice`. `litigator` names `practice` and `research`. A mention that is only a signpost ("a deadline needs the `litigator` plugin") is allowed when it is worded as conditional and listed in the check's allowlist.
2. **A hook ships with what it guards.** A hook whose matcher names one server's tools ships in the plugin that ships that server. A hook whose matcher names host tools (`Bash`, `Read`, `SendUserFile`, mail tools, `Skill`) ships in `practice`, because only `practice` is always installed. No hook may fire in fewer situations after the split than before it. A matcher changes in the same commit as the name it matches.
3. **One source, copies only in built output.** Skills stay in the flat `.claude/skills/` tree and under `public/`. A roster per plugin assigns them. A `shared/` file that two plugins cite is copied into each by the build and exists once in source.
4. **Skill and agent names stay unique across the four plugins**, so a bare `/show-me` never becomes ambiguous.
5. **`main` is releasable after every commit.** Until the cutover commit, `main` still builds and ships the single `probanda` plugin.

## Assignment

Changed from the first sort in conversation, each for the reason given: `docket-clerk`, its `shared/docket-clerk/` tree, `rule-update` and `session-lane-guard` go to `practice` (rule 2: the hook guards the deadline tools of the practice records, and seven practice skills name the clerk). The four agents that `/case-data` dispatches go to `litigator`. `troubleshooter` goes to `research`, because its tools are on the `commons` server. `mail-send-gate` and `html-pages-gate` go to `practice` (rule 2).

| Plugin | Skills | Agents | Hooks | Servers |
|---|---|---|---|---|
| `practice` (31) | `practice-data`, `bill-client`, `ar-follow-up`, `invoice-reviewing`, `invoice-tracking`, `retainer-tracking`, `wip-tracker`, `matter-status-tracking`, `file-review-prep`, `task-prioritization`, `executive-assistant`, `build-timeline`, `time-sorting`, `time-entry-drafting`, `time-pipeline-data`, `timecamping`, `timecamping-data`, `route-accounting`, `rule-update`, `show-me`, `safe-file-deletion`, `find-document`, `file-naming`, `file-sorting`, `housekeeping`, `localize`, `reflect`, `plugin-fix`, `TLDR`, `proof-read`, `dyu` | `docket-clerk`, `housekeeping-reviewer`, `housekeeping-namer`, `localize-helper` | `inject-practice-quirks`, `redirect-delete-to-trash`, `staged-file-gate`, `trailing-dyu`, `session-lane-guard`, `mail-send-gate`, `html-pages-gate`, `practitioner-words-gate` (see decision 1) | `data` |
| `research` (7) | `legal-research`, `verify-law`, `legal-commons`, `legal-citation`, `case-brief`, `legal-memo-extractor`, `review-proposition` | `law-librarian`, `research-agent`, `research-paralegal`, `legislation-fetcher`, `verify-claim`, `troubleshooter` | `block-main-session-canlii`, `block-subagent-legal-research`, `commons-read-only` | `canlii`, `commons` |
| `litigator` (12) | `case-data`, `ingest`, `apply-to-facts`, `prepare`, `draft`, `drafting-data`, `polish-substance`, `publish`, `assemble`, `calculate`, `rule-migrate`, `litigation-fact-extractor` | `extract-affidavit`, `extract-facts`, `extract-sought-orders`, `extract-caselaw`, `extract-provision`, `verify-source`, `verify-caselaw`, `verify-edges`, `marshal-facts`, `migration-runner`, `rules-improviser`, `rules-reorienter`, `delivery-checker` | none | none |
| `solicitor` (0) | none | none | none | none |

Unplaced: the agent `equivalence-checker`. No skill names it. Phase 1 finds its caller or reports it as dead.

The assignment was made from names, descriptions and a text scan, not from reading each skill. Phase 1 confirms it.

## What the scan found (2026-10-13)

A text scan of every skill and agent against the first sort counted references that would cross a plugin boundary. The numbers below are from that first sort, so the moves above already remove some.

- Skill-to-skill, as distinct pairs: `litigator` to `practice` 32, `practice` to `litigator` 20, `research` to `litigator` 16, `litigator` to `research` 15, `research` to `practice` 3, `practice` to `research` 3.
- Skill-to-agent pairs: `litigator` to `research` 10, `practice` to `litigator` 9, `practice` to `research` 4, `research` to `litigator` 1.
- 39 skill pairs and 14 agent pairs therefore point up, against rule 1. The heaviest: `housekeeping`, `file-sorting`, `find-document` and `bill-client` name `case-data`. `localize` names `draft` and `publish`. `verify-law`, `legal-research`, `case-brief` and `legal-memo-extractor` name `case-data`, `ingest` or `draft`.
- 138 mentions of `plugin_probanda_<server>__` in skills and agents, 76 mentions of the agent prefix `probanda:`, six hook matchers in `plugin.json` (four name a `plugin_probanda` tool and two name `probanda:docket-clerk`), and two hook scripts that hold either name in code (`session-lane-guard.py`, `block-main-session-canlii.py`).
- No saved data is keyed to the plugin name. The data server reads its config from the per-device file under `%APPDATA%`, and the `canlii` and `commons` servers keep credentials under `%LOCALAPPDATA%`. No skill, agent or hook uses `${CLAUDE_PLUGIN_DATA}`. A rename strands no data.
- The data server reads skill folders from its own plugin's install (`resolveShippedRoot` in `source/probanda/mcp/src/repo-root.ts`): `case-data`, `drafting-data`, `timecamping-data`, `file-naming`, the `draft`, `publish` and `assemble` scripts, each skill's knowledge tree, and anything asked of `skill_source`. It treats a folder as an install only when `skills/shared/` exists in it. After the split most of those folders are in `litigator`.

## Decisions taken by default

Brahm can overturn any of these before the phase that uses it.

1. **Where the data server lives (used in phase 3).** Default: one server, in `practice`, taught to find a skill folder in a sibling plugin's install. It fails with a message naming the missing plugin when that plugin is not installed. This keeps every tool under one name and changes one function. It holds only if phase 0 shows that sibling plugin folders can be found the same way on every host. If not, the fallback is one server bundle per plugin, built from the one source tree, each reading only its own plugin's folders. Under the fallback `practitioner-words-gate` moves to `litigator` with the drafting tools, and `localize-helper` needs a knowledge-tool grant per plugin.
2. **Server keys.** `data`, `canlii` and `commons` keep their keys. Only the plugin part of each tool name changes.
3. **The old plugin.** `probanda` is removed from the marketplace in the cutover commit. Nothing redirects an installed copy, so each machine uninstalls it by hand.
4. **Versions.** Each plugin starts at `0.2.0` and is versioned on its own from then on.
5. **Public plugin.** The five public skills follow the assignment: `legal-citation` to `research`, `litigation-fact-extractor` to `litigator`, `TLDR`, `proof-read` and `dyu` to `practice`. Publication waits for Brahm's express instruction, as always.

## Phases

Each phase ends with its check passing, a commit and a push.

### Phase 0: find out what the hosts allow

Build a throwaway two-plugin marketplace outside this repo and install it in a terminal session, the desktop app and Cowork. Record, per host:

- whether `plugin.json` can declare that one plugin requires another, and what the user sees when the required one is missing,
- whether a skill or agent in one plugin can call a tool on another plugin's server and dispatch another plugin's agent by its prefixed name,
- whether a plugin with no skills installs,
- where each plugin's folder sits relative to its sibling, including any `~g<N>` suffix.

Check: a table of the four answers per host, written into this plan under decision 1. This phase needs Brahm for the installs, because no session can trigger a sync.

### Phase 1: confirm the assignment and list every upward reference

For each of the 50 skills and 24 agents, read it and record its plugin, every skill, agent, tool and `shared/` file it names, and whether each upward reference is a signpost or a real call. Resolve each real upward call by moving the unit or by rewording the caller so the work is offered only when the other plugin is present. Read `rule-migrate` and `mail-send-gate.py` in particular: the first may belong with `rule-update`, and the second may read files from the `draft` folder.

Check: a committed `source/assignment.json` naming a plugin for every skill, agent, hook script, server and cited `shared/` file, and a script that fails on any real upward reference not in its allowlist. It fails now and passes at the end of phase 4.

### Phase 2: teach the build and the checks about several plugins

`scripts/build_plugin.py` builds every plugin named in `source/assignment.json` from `source/<plugin>/` into `plugins/<plugin>/`. `scripts/check_plugin.py` runs its invariants per plugin and gains three: names unique across plugins, the rule 1 check from phase 1, and rule 2 (every hook matcher names a tool its own plugin ships, or a host tool in `practice`). `OLD_IDENTIFIERS` gains `plugin_probanda_` and the agent prefix, applied only to the new plugins. `check_publishable.py` gains the four names in `ALLOWED_NAMES`. Brahm instructed the four names on 2026-10-13, which is the deliberate act that list asks for.

Until cutover the assignment file lists one plugin, `probanda`, holding everything.

Check: `python scripts/build_plugin.py --check` reports `plugins/probanda` current with no byte changed, and `python -m pytest scripts/tests` passes.

### Phase 3: make the data server work across plugins

Carry out decision 1 as settled by phase 0.

Check: the data server's test suite passes, plus new tests that serve a skill folder from a sibling install and that fail by name when the sibling is absent.

### Phase 4: rewrite the references

In source, with the single plugin still shipping: remove or reword every real upward reference from phase 1. This phase changes prose only. Names that depend on the plugin name are not touched yet.

Check: the phase 1 script passes. `build_plugin.py --check` and `check_plugin.py` pass.

### Phase 5: cutover, in one commit

1. Create `source/practice/`, `source/research/`, `source/litigator/` and `source/solicitor/`, each with its `plugin.json`, roster, agents and hooks. Move the server folders to their plugin. Delete `source/probanda/`.
2. Rename every `plugin_probanda_<server>__` to its new plugin, in skills, agents, hook matchers, hook scripts, both bridged and plain forms. Rename every agent prefix `probanda:` the same way.
3. Fill `source/assignment.json` with the four plugins.
4. List the four plugins in `.claude-plugin/marketplace.json`. Build. `plugins/probanda/` disappears and four folders appear.
5. Update `CLAUDE.md`: the build and release sections, "Permanent names" (the four plugin names join the list) and "One plugin" (replaced by the layering rule). Update `README.md` and the CI workflows.

Checks: `build_plugin.py --check` and `check_plugin.py` pass for all four. A search of the four built folders for `plugin_probanda_` and `probanda:` finds nothing. `python scripts/check_publishable.py --new-since origin/main` passes. That last check counts identical problem lines, so a file holding schema text or a machine path must not be copied into two built plugins: it may only move.

### Phase 6: move each machine over

Brahm, on each machine: uninstall `probanda`, press "Check for updates" on the marketplace, install `practice`, `research` and `litigator`. Then a session on that machine checks:

- every scheduled task and every permission allowlist that names `plugin_probanda` or a `probanda:` skill, in the user settings, this repo's `.claude/` settings and the settings files under the case-data root. Each is rewritten to the new names.
- a morning briefing, a deadline listing, a research question and a draft session each run end to end.

Check: the four runs complete, and a search of those settings files for the old names finds nothing.

### Phase 7: the public plugin

Move the five public skills to `public/plugins/<plugin>/skills/`, give each public plugin its `plugin.json`, list them in the public `marketplace.json`, and update `export_public.py`'s required files and `check_public_tree.py`. Approval and publication happen only on Brahm's express instruction.

Check: `python scripts/check_public_tree.py` passes and `python scripts/export_public.py --plan` reports that every check passed.

## Risks

- **Phase 0 may show that a plugin cannot require another.** Then each dependent skill must stop with a message naming the missing plugin, and phase 4 adds that wording.
- **`research` and `litigator` are tightly joined.** Research files what it finds into the matter's case data. If phase 1 shows that most research skills cannot work without `case-data`, the layering in rule 1 does not fit, and the choice between merging the two and moving the law half of `case-data` goes back to Brahm.
- **Cutover is one large commit.** It cannot be split, because a half-renamed tool name leaves a hook that matches nothing, which rule 2 forbids.
- **The first sync after cutover.** A machine that syncs before `probanda` is uninstalled shows no duplicates, because the old plugin is gone from the marketplace, but its installed copy keeps running stale skills until removed.
