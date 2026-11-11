# Phase 1: move the plugins and skills to the planned tree

Status: built on 2026-11-10. The planned tree this targeted was deleted once `docs/diagrams/Built/Progressive-Context-Tree.html` was redrawn to match it. Slice 1 reworded `design-decisions.md` instead of moving it, by the developer's choice, and the public copy of slice 4 is moved but not yet approved or published. Phase 2 (`docs/Plans/2026-11-10_data-store-restructure-phase-2.md`) follows it and changes the stores.

The target was the planned tree (now deleted; the result is `docs/diagrams/Built/Progressive-Context-Tree.html`): every skill it marked "moved from" changes plugin, and nothing else does. Why the skills are grouped this way is in `docs/Plans/2026-11-10_data-pool-framework.md`. This plan does not restate either.

## Goal

`source/assignment.json` places every skill, agent, hook and server where the planned tree shows it, and every check below passes on `main`. Each plugin then ships the skills that work on the data pools it owns, so a skill reaches the data it needs inside its own plugin or one below it.

## What changes

| Change | From | To |
|---|---|---|
| A new plugin, `billing`, displayed as "Billing", requiring `lawyer` | | |
| All 8 timekeeper skills, the `screenshot-reader` agent, the `timecamp` server and the hooks `ceremony-gate` and `screenshot-reader-gate` | timekeeper | billing |
| `bill-client`, `issue-invoice`, `invoice-reviewing`, `wip-tracker`, `ar-follow-up`, `invoice-tracking` | lawyer | billing |
| `litigation-fact-extractor` | litigator | lawyer |
| The plugin `timekeeper` | ships skills | retired |

Nothing else moves. The planned tree's notes say why `find-document`, `file-review-prep`, `proof-read`, `compare-documents`, `suggestion` and `probanda-troubleshooting` stay where they are.

## What it costs

The cost is counted in upward references: a file in one plugin naming a skill, agent or tool of a plugin it does not require. `python scripts/check_layering.py` fails on each one that has no ruling in `source/layering.json`, and counts them per (file, target) pair.

Measured on 2026-11-10 at commit `7f68a2fa`, by replaying that check's scan against the changed assignment:

| State | Pairs |
|---|---|
| Today | 125 |
| After the billing move | 130 |
| After `litigation-fact-extractor` also moves | 129 |

The billing move drops the rulings that let lawyer's billing skills reach timekeeper, and needs new ones for lawyer files that still name a moved skill. Re-run the count at the start of the session, because the files change daily: copy `source/assignment.json` to a scratch folder with the moves applied and call `check_layering.scan()` on it, as the measurement did.

## Slices

Each slice leaves `main` passing every check and is released on its own with `/release`. Do them in this order, because each later slice is counted against the one before.

1. **Cheap cuts first.** The framework document's "Open" section lists rewordings that remove about 23 rulings for matter-data, show-me and localize without moving anything. That figure is an estimate from a review and has not been re-counted. Doing these first makes the later counts easier to read.
2. **Create `billing` with everything timekeeper ships.** Add `source/billing/` (its `plugin.json`, `roster.json`, agents, hooks, tests and the `timecamp-mcp` folder), move timekeeper's entries in `source/assignment.json` to it, and add it to `.claude-plugin/marketplace.json`, to `PLUGINS` and the server paths in `scripts/plugin_layout.py`, to `ALLOWED_NAMES` in `scripts/check_publishable.py`, and to the bundle script `source/lawyer/mcp/scripts/bundle.mjs`, which writes the server's bundle into `source/timekeeper/timecamp-mcp/dist/` today. The server's own source stays under `source/lawyer/mcp/src/timecamp/`. In the same commit:
   - Every `mcp__plugin_timekeeper_timecamp__*` tool name becomes `mcp__plugin_billing_timecamp__*`, in skills, agents, hooks and tests.
   - `ceremony-gate.py` and `screenshot-reader-gate.py` hard-code the prefix `timekeeper:`. Change it to `billing:`, with their tests.
   - `source/lawyer/hooks/hidden-skills-note.py` and `plugin-cache-guard.py` list the plugin names. Add `billing`.
   - timekeeper then ships nothing. It stays in the marketplace until slice 5.
3. **Move the six billing skills from lawyer to billing.** Propose the new rulings this needs and drop the ones it clears.
4. **Move `litigation-fact-extractor` from litigator to lawyer.** Its source is in the Public Folder, at `public/plugins/litigator/skills/litigation-fact-extractor/`. Drop the ruling for `.claude/skills/ingest/SKILL.md` naming it.
5. **Retire timekeeper.** Remove it from `.claude-plugin/marketplace.json`, `source/assignment.json` and `PLUGINS`, delete `source/timekeeper/`, keep the name in `ALLOWED_NAMES` beside the other retired names, and record the retirement in `CLAUDE.md` under "Permanent names". Update `CLAUDE.md`'s plugin table and `README.md`. Redraw `docs/diagrams/Built/Progressive-Context-Tree.html` from the new assignment, and delete the planned tree's "moved from" labels or the planned tree itself, whichever the developer prefers.

## Constraints

- **Retiring a plugin name is a one-way door** (Commandment 8, and "Permanent names" in `CLAUDE.md`): a retired name is never reused, and every installed copy of timekeeper is stranded. It is accepted here because the developer is the only installer. If that has changed by the time this runs, stop and ask.
- **The saved TimeCamp login must survive.** `source/lawyer/mcp/src/timecamp/client.ts` keeps it in a protected file under `defaultStateDir(env, "timecamp")`, a folder named for the server, not the plugin. Confirm before slice 2 that `defaultStateDir` (in `source/mcp-shared/dpapi-store`) does not build its path from the plugin's name or from `${CLAUDE_PLUGIN_DATA}`. If it does, stop and ask, because the move would lose the login.
- **Version rule** (`CLAUDE.md`, "Releasing"): slice 2 renames tools, so every plugin whose files name them takes a minor bump.
- **A hook ships in the plugin whose work it guards, and its matcher changes in the same commit as the name it matches.**
- **Skill and agent names stay unique** across the plugins. No skill is renamed.
- **`plugins/` is never edited by hand.** Change the source, run `python scripts/build_plugin.py`, commit the result.

## Out of scope

- Any change to a database, a schema or a tool family: that is Phase 2. The `timecamping_data__*` and `time_pipeline__*` tools stay in lawyer's `data` server. (Since issue 284, `time_pipeline__*` is served by billing's `timekeeping` server.)
- Any edit to `COMMANDMENTS.md`.
- Moving any skill the planned tree does not mark as moved.

## Stop and ask the developer

- **Before adding a ruling to `source/layering.json`.** A ruling is an exception a person decides. Show the developer the full list for the slice: each file, the skill it names, and the proposed reason.
- **Before approving or publishing anything under `public/`** (slice 4). Commandment 1 requires the developer's express instruction in the conversation for each approval and each publication.
- **After slice 2 is released**, the developer installs `billing` in claude.ai and, after slice 5, removes `timekeeper`. No session can do either. Give him the steps.

## Verification

After each slice, all of these pass:

- `python scripts/check_layering.py`
- `python scripts/build_plugin.py --check`
- `python scripts/check_plugin.py`
- `python scripts/check_public_tree.py`
- `python scripts/check_publishable.py --new-since origin/main`
- `python -m pytest -q` on `source/lawyer/tests`, `source/billing/tests`, `source/litigator/tests`, `scripts/tests` and the `tests` folder of each moved skill

After slice 5:

- Every skill the planned tree draws sits under the same plugin in `source/assignment.json`.
- A search of the repository outside `docs/` and the retired-names lists finds no `timekeeper`.
- On the developer's machine, with `billing` installed: `/billing:timecamping` opens, a `mcp__plugin_billing_timecamp__status` call answers with the saved login, and `/billing:bill-client` starts on a test matter.
