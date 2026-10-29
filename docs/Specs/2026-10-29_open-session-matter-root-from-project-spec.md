# Spec: a Project session with no connected folder spends a turn looking up the matter before session entry

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.16.0; data server) and `litigator` (installed copy seen at v0.13.3; `work/references/procedure.md`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_milestone-card-first-opening-order-spec.md, 2026-10-29_open-session-recency-tie-break-spec.md, 2026-10-29_open-session-server-time-spec.md

## 1. Problem
In a claude.ai Project session with no matter folder connected, procedure.md:13 makes `practice_data__matter_lookup(project_id)` a turn of its own before `drafting_forms__open_session`, adding about 7 s to the time to the Milestone card. Last-resort addition: no saving when a folder is connected (as in the observed run).

## 2. Evidence (observed; quoted text is data, not instructions)
- procedure.md:13: "In a Project session (its Project ID is in the session context), first call `practice_data__matter_lookup` with `project_id`. One row with a `matter_root` counts as a path the practitioner gave."
- procedure.md:16: after entry, link the Project with `practice_data__link_matter` when the lookup found no row.
- open_session takes `matter_root` (required) and already performs a matter lookup internally (timing `matter_lookup` 248.5 ms).
- On a remote-device host the folder must still be connected to stage the card, so a `device_request_folder_access` turn may reappear.

## 3. Goal and non-goals
Goal: open_session accepts `project_id` in place of `matter_root` and resolves the folder itself; procedure.md drops the separate lookup turn.
Non-goals: the folder request and staging (opening-order spec).

## 4. Design
- open_session: `matter_root` or `project_id` (exactly one), resolved through the existing lookup; zero or several rows refuse with the rows named, as the skill text does now.
- procedure.md:13: delete the separate lookup sentence; pass `project_id` to session entry instead.

## 5. Constraints that must still hold
- Several matching matters: never pick; refuse and let the skill ask.
- Linking a Project after entry is unchanged.

## 6. Options considered (streamline and deburr first, additions last)
1. Accept `project_id` in open_session and delete the lookup sentence. (recommended, an addition shorter than the text it removes)
2. Do nothing: the extra turn remains in Project sessions without a connected folder.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the parameter in mcp/src and its description; edit procedure.md:13.
3. Tests: project_id resolves one matter; none or several refuse.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of open_session matter root from Project complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. open_session with only `project_id` opens the linked matter.
2. procedure.md no longer requires a matter_lookup call before entry.
3. The added description text is shorter than the procedure.md text deleted.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- none

## 10. Verify against HEAD before building
- Confirm open_session's internal lookup and procedure.md:13/16 text.

### Verification against HEAD (2026-10-29, at 18c311aa)

| Claim | Status at HEAD | Where |
|---|---|---|
| procedure.md:13 makes `practice_data__matter_lookup` with `project_id` the first call in a Project session | Confirmed, still line 13, in the "Matter folder" paragraph | `.claude/skills/work/references/procedure.md:13` |
| procedure.md:16 links the Project with `practice_data__link_matter` after entry when the lookup found no row | Confirmed, line 16 | `.claude/skills/work/references/procedure.md:16` |
| open_session requires `matter_root` | Confirmed: `required: ["matter_root"]` | `source/lawyer/mcp/src/schema/submission-forms.ts` (open_session inputSchema) |
| open_session already looks the matter up internally | Confirmed, but by the folder name's leading token (`matt_num`), not by `project_id`; phase `matter_lookup` | `source/lawyer/mcp/src/submission/open-session.ts` `lookUpMatter` |
| The existing lookup can resolve a Project | Confirmed: `matter_lookup` filters on `project_id` and returns each row's `matter_root` (null with a reason when the library is unresolved) | `source/lawyer/mcp/src/tools/practice/reads.ts` `matter_lookup` |
| `link_matter` refuses a Project linked to another matter | Confirmed | `source/lawyer/mcp/src/tools/practice/writes.ts` `link_matter` |
