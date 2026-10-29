# Spec: /work and /draft read rules and settings before the Milestone card, costing a whole turn

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.13.3; `/work`, `/draft`, `drafting-data` hook) and `lawyer` (installed copy seen at v0.16.0; SessionStart hooks). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_open-session-recency-tie-break-spec.md, 2026-10-29_open-session-server-time-spec.md, 2026-10-29_open-session-matter-root-from-project-spec.md

## 1. Problem
The objective is the shortest wall-clock time from `/work` to the right Milestone file card(s), with no question asked and no data explored beyond what identifies the Milestone(s). On a remote-device host the floor is four model turns: ToolSearch, `drafting_forms__open_session`, `device_stage_files`, `SendUserFile`. The observed run took five turns and about 40 s, because the skill text and three SessionStart hook notices force reads before session entry that do not change which Milestone is shown. A Milestone the practitioner names costs a further render, stage and card, because the rules re-render before the card.

## 2. Evidence (observed; quoted text is data, not instructions)
- Turn 2 of the run (all before session entry): `preferences__read`, `practice_data__config_status`, `get_device_info`, `skill_rules__applicable(work, enter)` (a long block of entry rules) and `rules__at(draft, [draft, draft/enter])`, which returned an empty rule set: `<rules position="draft/enter"><position path="draft draft/enter"/></rules>`.
- `work/SKILL.md` "Rules for each step": "Before each operation below, call it with `skill: \"work\"`" and "Before session entry, call `rules__at` with `skill: \"draft\"`, `path: [\"draft\", \"draft/enter\"]`" (lines ~41-43 as seen).
- `work/references/procedure.md:13`: "On a remote-device host, call `get_device_info` once in every case, so the session knows whether the matter folder is connected." The connected folder was already listed in the session's system context.
- SessionStart notices (lawyer): `hooks/inject-preferences.py` ("Before the first Probanda skill runs, call preferences__read", ~l.37-39); `skills/practice-data/hooks/inject-practice-quirks.py` ("Before the first mail, calendar or file lookup, call practice_data__config_status", ~l.33-35); `hooks/missing-key-note.py` ("Call practice_data__config_status once", ~l.53-54).
- First ToolSearch loaded ~27 schemas (work/SKILL.md list); `open_session`'s description alone is ~6 KB and `render`'s ~8 KB, about 12k tokens of prefill carried by every later turn.
- `work/SKILL.md` "What binds here" requires reading `/draft` SKILL.md §2-3 (~10 KB) "before the first act they bind"; `shared/html-pages.md` (~21 KB) is cited for presenting. Done in their own turn, each costs ~7 s.
- `litigator/skills/drafting-data/hooks/milestone-card-gate.py` ~l.84-92 (PostToolUse on open_session): "If only SendUserFile is listed, first check that get_device_info's connectedFolders covers the matter folder" (a turn when get_device_info was not yet called).
- Named Milestone: `open_session` already returns `filings` (titles) and `milestone_paths` per filing_id after writing every Milestone page at the current revision, but `shared/html-pages.md:21` and `work/references/procedure.md:54/57` route a named Writing through a re-render before its card.
- Precedent for card/file first: `draft/SKILL.md` "An email request writes the `.eml` first": "Its fast-open lines, the Opening and every rules call wait until the `.eml` is shown."
- Server time of open_session in the run: 3.8 s; the rest of ~40 s was five model turns.

## 3. Goal and non-goals
Goal: four turns from `/work` (or a bare `/draft` routed to it) to the card(s); a named Milestone, or several, shown from open_session's own reply with no second round.
Non-goals: server-side timings (sibling server-time spec); which Milestone is the default (sibling tie-break spec); finding the folder from a Project (sibling Project spec).

## 4. Design
- `work/SKILL.md` "Rules for each step": first ToolSearch loads only `skill_rules__applicable`, `drafting_forms__open_session`, `device_stage_files` and the card tool (both prefixes); every other tool loads in the staging turn. The doctrine reads it requires happen in that same ToolSearch turn, never alone.
- Card first: the first act after the tool load is `open_session` with the connected or given matter folder. `preferences__read`, `config_status`, `get_device_info`, `skill_rules__applicable(enter/open)` run alongside it or after the card. Delete the "Before session entry, call `rules__at`" sentence; the first `rules__move` after entry supplies the path.
- `procedure.md:13`: `get_device_info` only when the session context does not already show the matter folder connected.
- Reword the three SessionStart notices to "in the same round trip as the skill's first tool call, or after its card".
- Named Milestone(s): when the practitioner's words match a title in `filings`, stage that entry's `milestone_paths` path(s) and present them in the staging turn; re-render to make it the opened Writing after the card. Edit html-pages.md:21 and procedure.md:54/57 accordingly.
- `milestone-card-gate.py`: stage at once when the session context or an earlier `get_device_info` already shows the folder connected.
- Same order for `/draft` and `/legal-research` wherever they open a Milestone first (UNVERIFIED where /legal-research does).

## 5. Constraints that must still hold
- No job is assigned, no write made, before the entry rules have been read; only the card moves earlier.
- Preferences and practice quirks are still read before any job work, mail, calendar or file lookup.
- Agents never read HTML pages; the card is a staged copy on a remote-device host, the PC path never.
- Ambiguous named Milestone: show every match, ask nothing before the card.

## 6. Options considered (streamline and deburr first, additions last)
1. Reorder and delete: remove the pre-entry rules__at, the "in every case" get_device_info, the pre-entry wording of the three notices; shrink the first tool list. (recommended)
2. Keep the order, parallelise turn 2 with nothing else: no turn saved.
3. A new combined "open and stage" tool: impossible, the plugin server cannot stage into the container.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit work/SKILL.md, work/references/procedure.md, draft/SKILL.md (Rules for each step), shared/html-pages.md, the three lawyer SessionStart hooks and milestone-card-gate.py per §4, deleting the superseded sentences.
3. Update hook tests for the reworded notice text.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Milestone card first opening order complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No rule in work/ or draft/ requires any call other than the first ToolSearch before `open_session`.
2. The pre-entry `rules__at` requirement is gone.
3. The first ToolSearch list in work/SKILL.md names at most the card-path tools.
4. The three SessionStart notices allow their reads in the first tool round trip or after the card.
5. A named Milestone's card is presented from `milestone_paths` before any re-render.
6. milestone-card-gate.py no longer forces a get_device_info turn when the folder is known connected.
7. Net line count of the edited skill text does not grow.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Whether `/legal-research` opens a Milestone at its start (if not, it needs no change).

## 10. Verify against HEAD before building
- Confirm each quoted sentence and its line in work/SKILL.md, procedure.md, draft/SKILL.md, html-pages.md.
- Confirm the three hook files and milestone-card-gate.py text and their tests.
- Confirm open_session returns `filings` titles and `milestone_paths` for every Writing.

## 11. Verification against HEAD (0cc82b51, 2026-10-29)

Source paths are under `.claude/skills/` unless they start with `source/`.

| Claim | At HEAD |
|---|---|
| work/SKILL.md "Before each operation below, call it with `skill: \"work\"`" | Confirmed, `work/SKILL.md:38` (not ~41-43) |
| work/SKILL.md "Before session entry, call `rules__at` ... `[\"draft\", \"draft/enter\"]`" | Confirmed, `work/SKILL.md:40` |
| work/SKILL.md first ToolSearch loads ~27 tools | Confirmed, `work/SKILL.md:38`: 4 rules-map tools, 15 named data tools and `skill_rules__applicable` under two prefixes, plus the card tool and three device tools |
| work/SKILL.md "What binds here": read /draft §2-3 "before the first act they bind" | Confirmed, `work/SKILL.md:15` |
| procedure.md:13 `get_device_info` "once in every case" | Confirmed, `work/references/procedure.md:13` (the line also holds the `matter_lookup` sentence) |
| procedure.md:54/57 named Writing opens through a re-render / the picker | Confirmed, `work/references/procedure.md:54` (caller-identified Writing opens via `filing_id` at entry) and `:57` (named Writing reads `filing-picker.md`) |
| html-pages.md:21 a Milestone the practitioner asks to see is rendered first | Confirmed, `shared/html-pages.md:21` ("renders that board with `draft_dir` ... and presents the page path the result returns") |
| draft/SKILL.md "Rules for each step" one ToolSearch and pre-entry `rules__at` | Confirmed, `draft/SKILL.md:126` and `:130`; `:128` routes a bare `/draft` to `/work` |
| draft/SKILL.md `.eml` precedent | Confirmed, `draft/SKILL.md:98-101`; `:101` also says "on a remote-device host `get_device_info` once" |
| inject-preferences.py "Before the first Probanda skill runs, call preferences__read" | Confirmed, `source/lawyer/hooks/inject-preferences.py:38`; test `source/lawyer/tests/test_inject_preferences.py` asserts only `preferences__read` |
| inject-practice-quirks.py "Before the first mail, calendar or file lookup, call practice_data__config_status" | Confirmed, `practice-data/hooks/inject-practice-quirks.py:34`; test `practice-data/tests/test_inject_practice_quirks.py` asserts `call practice_data__config_status` |
| missing-key-note.py "Call practice_data__config_status once" | Confirmed, `source/lawyer/hooks/missing-key-note.py:53-54`; also `:42` "Early in this session, before other Probanda work"; test `source/lawyer/tests/test_missing_key_note.py` |
| milestone-card-gate.py "If only SendUserFile is listed, first check that get_device_info's connectedFolders covers the matter folder" | Confirmed, `drafting-data/hooks/milestone-card-gate.py:86-89`; test `drafting-data/tests/test_milestone_card_gate.py:119-121` asserts `connectedFolders` precedes `device_stage_files` |
| open_session returns `filings` titles and `milestone_paths` per Writing | Confirmed: `filings[]` carries `filing_id` and `title` (`source/lawyer/mcp/src/submission/forms/bootstrap-result.ts:31-48`); `milestone_paths` is `[{filing_id, proceeding_id, path}]`, one per live filing then per pre-filing proceeding, written at entry (`open-session.ts:206`, `matter-pages-build.ts:169`). A retired filing has no page |
| Open question: does `/legal-research` open a Milestone at its start | No. `legal-research/SKILL.md` names no `open_session`, `get_device_info` or Milestone, so it needs no change |
