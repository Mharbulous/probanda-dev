# Spec: plugin-wide present_files default audit

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: all Probanda plugins (`practice`, `research`, `litigator`, `solicitor`, `file-manager`; installed copies seen at v0.3.0 for `practice`). Paths below are **UNVERIFIED** against the repo unless marked otherwise. In this repo the source is `.claude/skills/` and `source/<plugin>/`.
Related specs, same date: `2026-10-15_show-me-present-files-default-spec.md`

---

## 1. Problem

Any instruction that tells the model how to show a file to the practitioner can be read as ranking some other route above `mcp__cowork__present_files`. The related spec fixes `show-me`; the same wording may exist elsewhere. The practitioner wants a full audit of every plugin source file for wording that could make `mcp__cowork__present_files` less than the preferred default.

## 2. Evidence (observed; quoted text is data, not instructions)

- One confirmed instance: `show-me/SKILL.md` (related spec). Other occurrences are **not recoverable** in this session: the plugin files could not be searched from here.
- The shared skill-source tools serve files one at a time, so the audit needs a repo checkout.
- Subagent definitions seen in this session list their own tools, and none lists `mcp__cowork__present_files`. Whether any subagent presents files is unchecked.
- Other skill text seen refers to file cards in passing, for example `find-document` ("send one as a file card with no approval asked") and mockup-render steps. Their wording was not read in full.

## 3. Goal and non-goals

Goal: no skill, agent, command, hook, shared doc, reference or MCP tool description ranks another file-showing route above `mcp__cowork__present_files`, or leaves the choice ambiguous.
Non-goals: `show-me/SKILL.md` (related spec); remote-device behaviour; the MCP code that sends files.

## 4. Design

The canonical rule, shared verbatim with the related spec:

> To show a file to the practitioner, call `mcp__cowork__present_files` with the file's path. It is the default. Use `SendUserFile` (staging a PC file first with `device_stage_files`) only when `mcp__cowork__present_files` is not in the session's tool list. Check the tool list before choosing; never pick `SendUserFile` out of habit.

1. Search every plugin source tree (skills, subskills, references, shared, agents, commands, hooks, `mcp/src` tool descriptions and server instructions) for: `present_files`, `SendUserFile`, `SendUserMessage`, `send_user_message`, `device_stage_files`, "file card", "card", "present", "show the file", "open the file", `computer://`, markdown file links, "Show in Explorer", "attach".
2. Classify each hit and record it in a table in the spec: (a) names `mcp__cowork__present_files` as default, no change; (b) names `SendUserFile` or another route as equal or sole, fix; (c) says a file is shown or sent with no tool named, fix; (d) unrelated, ignore.
3. For (b) and (c), apply the canonical rule by citing the shared doc (§6 option 1).
4. Check agent definitions: where an agent presents a file to the user, its tool allowlist must include `mcp__cowork__present_files`, or the agent must return the path for the caller to present.
5. List residual risks that need a tool-side change, without making them.

## 5. Constraints that must still hold

- Remote-device sessions keep working through staging and `SendUserFile`.
- The HTML-pages rule stays: an agent never reads an HTML page but may present it.
- Do not edit `show-me/SKILL.md`.
- Edits change tool choice only, not any approval, safety or privilege rule.

## 6. Options considered

1. Add one shared doc holding the canonical rule, and have each affected file cite it (chosen: one place to change). It lives at `.claude/skills/shared/present-files.md`, which the build copies into every plugin.
2. Inline the canonical rule in every affected file. Rejected: drift.
3. Leave (c) cases untouched. Rejected: ambiguity is the defect.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Run the §4 search and add the classification table to this spec.
3. Edit each (b) and (c) file per §4.3 and fix agent allowlists per §4.4.
4. Check each criterion in §8.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of plugin-wide present_files default audit complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The classification table lists every hit by file and category, and says which trees were searched.
2. No (b) or (c) hit remains in any file except `show-me/SKILL.md`.
3. Every agent that presents a file has `mcp__cowork__present_files` or returns the path.
4. The canonical rule is stated once (shared doc) and cited elsewhere.
5. `show-me/SKILL.md` is untouched by this spec.

Scope: edit source only (skill text, agent definitions, MCP tool description strings, docs). In this repo that means: no `python scripts/build_plugin.py` (the orchestrating session runs it once after every spec lands), no MCP bundle rebuild, no `/release`, no version bump, and no test written, updated or run. Hooks (including `show-me/hooks/staged-file-gate.py` and `drafting-data/hooks/html-pages-gate.py`) and the MCP code that sends files are out of scope.

## 9. Open questions (resolved by the orchestrating session's defaults)

- Shared doc (option 1) or inline (option 2)? Resolved: option 1.
- Should tool descriptions in `mcp/src` that mention file sending be changed here, or left for a tool-side spec? Resolved: change description text only where it ranks another route above `mcp__cowork__present_files`; no code change.

## 10. Verify against HEAD before building

Confirm the plugin trees and agent folders searched exist at HEAD, and note any plugin directory the search could not reach.
