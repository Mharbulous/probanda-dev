# Spec: /legal-research's rules served by operation

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.12.1; `/legal-research`) and `lawyer` (v0.21.9; `skill_rules__applicable`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_note-up-cap-heavily-cited-decisions-spec.md`, `2026-11-03_note-up-agent-batch-cap-spec.md`, `2026-11-03_research-agent-sources-staged-in-one-step-spec.md`, `2026-11-03_page-manifest-from-text-extraction-spec.md`.

## 1. Problem

Every `/legal-research` run reads its whole doctrine file and priority file before doing anything, though each step uses only a slice. `/work` already serves its rules one operation at a time through `skill_rules__applicable`.

## 2. Evidence (observed; quoted text is data, not instructions)

- Gate step 1: "Read `shared/legal-research.md` and follow it ... It sends you to `shared/research-priority.md` ... read that too" (source: `researcher/skills/legal-research/SKILL.md`).
- Sizes: `shared/legal-research.md` 626 lines; `shared/research-priority.md` 143 lines (installed copy).
- `/work` pattern: "Before each operation below, call it with `skill: \"work\"`, the operation and each fact known" (source: `litigator/skills/work/SKILL.md`, "Rules for each step").
- `skill_rules__applicable` with `skill: "drafting-data"` returned `not_served` in this session, so tag coverage is per skill.
- Workaround in use: the caller reads the full files.

## 3. Goal and non-goals

Goal: a research run loads only the rules for the step it is on.

Non-goals: changing any rule's meaning.

## 4. Design

Tag the doctrine into operations matching the gate's steps (preflight, job, scope, westlaw, legislation, note_up, spawn, review, persist, board_sort, currency) and have the gate call `skill_rules__applicable` per step, as `/work` does.

## 5. Constraints that must still hold

- Every rule still reaches the step that needs it; the regression-prone Westlaw-first order is unchanged.
- If the rules tool is unavailable, the gate's steps 2-5 remain the minimum protocol.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Tag in place and serve by operation; while splitting, delete repeated text (the Westlaw stop and batching sentences recur).
2. Split into several smaller files read by step. No tool change, more files.
3. Leave as is. About 770 lines read per run.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Land after the other four specs of this date, which edit the same doctrine.
3. Tag the sections, add the vocabulary, switch the gate to per-step calls, and run the rules lint.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of /legal-research's rules served by operation complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `skill_rules__applicable` with `skill: "legal-research"` serves each gate step's rules.
2. The gate no longer reads the whole doctrine; each rule in the old file is served by at least one operation.
3. The rules lint passes.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Can `skill_rules__applicable` serve a researcher-plugin skill from the lawyer server today?

## 10. Verify against HEAD before building

- `researcher/skills/legal-research/SKILL.md`, `shared/legal-research.md`, `shared/research-priority.md`.
- `skill_rules__applicable` and its lint; `/work`'s atom tags as the model.
