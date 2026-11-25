# Spec: Work Board entry skips the file card when the session has no file-card tool

Status: proposed, 2026-11-24. Written in a matter session; implementation is handed to Claude Code. Plugin: `litigator` (installed copy seen at v0.28.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise. Related specs, same date: `2026-11-24_unattended-runs-plan-and-work-plan-marker-jobs-spec.md`

## 1. Problem

On session entry, `/work` tells the session to present the Work Board page as a file card. A general-purpose subagent has neither `mcp__cowork__present_files` nor `SendUserFile`. In this run, all three subagents tried, then reported a "presentation gap" in their hand-back, which added noise and tool calls to every subagent report.

## 2. Evidence (observed; quoted text is data, not instructions)

- `/work` "Rules for each step": "The first act is one ToolSearch for the card path only: … the file-card tool (`mcp__cowork__present_files`, or `SendUserFile` only when that is not in the tool list: `shared/present-files.md`)".
- Subagent hand-backs, verbatim fragments: "this session has no card tool (neither the Cowork file-card tool nor SendUserFile loaded)"; "That needs `SendUserFile`, which is not in this subagent's tools".
- Frequency: 3 of 3 subagents.
- Error text: none. Each subagent noted the gap and continued.
- Workaround in use: the subagent named the page's folder in its report instead.

## 3. Goal and non-goals

Goal: when no file-card tool is available (a subagent or a headless run), session entry skips the card silently and goes on.

Non-goal: changing card behaviour in an attended main session.

## 4. Design

`shared/present-files.md` (or the entry rule) gains one clause: if neither card tool loads, skip presenting and continue. Do not report it. The orchestrating session presents pages itself.

## 5. Constraints that must still hold

- An attended main session still shows the Work Board as a file card.
- The rule that HTML pages are never read or parsed by the model is unchanged.

## 6. Options considered, streamline and deburr first, additions last

1. One clause in `shared/present-files.md`: no card tool means skip silently. (recommended)
2. Have the entry hook detect a subagent context and omit the card instruction. Trade-off: needs a context signal the hook may not have.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the skip clause, folding any text it makes redundant.
3. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Work Board entry skips the file card when the session has no file-card tool complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The rules served at entry state that, with no file-card tool available, the card is skipped without reporting.
2. Attended card behaviour is unchanged.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

None.

## 10. Verify against HEAD before building

Confirm where the card instruction lives (the `/work` SKILL.md, `shared/present-files.md`, or an entry hook's output) and edit it there.
