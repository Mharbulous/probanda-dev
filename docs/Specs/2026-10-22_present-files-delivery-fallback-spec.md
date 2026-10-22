# Spec: present-files delivery fallback for device-bridge sessions

Status: proposed, 2026-10-22. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.8.1), plus the lawyer data server's hook text. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-22_preferences-read-skill-key-spec.md; 2026-10-22_board-card-duplicate-text-spec.md

## 1. Problem
In a session linked to the user's PC through the device bridge, the first-choice file-card tool named by a hook and by /draft, `mcp__cowork__present_files`, was not in the tool list. The fallback (`device_stage_files`, then `SendUserFile`) failed on its first attempt because the page's folder was not a connected folder. Showing one page took 3 calls and 1 permission prompt instead of 1 call, and this recurs in every such session where the draft folder is not already connected.

## 2. Evidence (observed; quoted text is data, not instructions)
- Hook text after `drafting_forms__open_session`: "mcp__cowork__present_files with that path, or, where that tool is not in the tool list, stage that page alone with device_stage_files and call SendUserFile on the staged path" (source: PostToolUse hook; cites shared/present-files.md).
- /draft rule `draft.open.step-1` (references/procedure.md): "SendUserFile only as its fallback", and a remote-device-only host "stages that page in one device_stage_files call in the round trip right after session entry returns".
- First `device_stage_files` call error: "These files can't be read without a grant — call device_request_folder_access with the folder path (the user is asked to approve)". The session had no connected folder (system reminder said so). The skill never consulted `get_device_info.connectedFolders` before staging.
- After one `device_request_folder_access` for the draft folder only, staging returned ok and `SendUserFile` returned "1 file delivered to user".
- Research by a subagent from public sources (not verified here): GitHub anthropics/claude-code issue 50041 shows `mcp__cowork__present_files` existed in a Cowork Windows session in April 2026 and could fail with a "not accessible" error; the Claude Code tools reference lists SendUserFile and not present_files; issue 76739 reports SendUserFile can report success without delivering; no official source says present_files was removed.
- Cost: 3 calls (failed stage, access request, re-stage) and 1 permission prompt to present 1 page.
- Workaround in use: request access to the draft folder only, stage, then SendUserFile with display render.

## 3. Goal and non-goals
Goal: the file-card step succeeds in one attempt on a remote_device host, whichever delivery tool is listed, and nothing assumes a tool exists.
Non-goals: changing Claude Code or SendUserFile; letting an agent read the page (the html-pages rule stays); removing the permission prompt when the user has not connected the folder.

## 4. Design
(a) Replace "use present_files first" in the hook and shared/present-files.md with availability-based wording: use whichever of present_files or SendUserFile is in the tool list; if neither, say in plain words where the page is.
(b) On a remote_device host, check `get_device_info.connectedFolders` for the draft folder before the first `device_stage_files` call. If it is absent, make the single `device_request_folder_access` call for that folder only (reason names the page), in the same round trip as session entry, then stage.
(c) When the delivery tool gives no confirmation the user saw the page, say in one plain-words line what was presented.

## 5. Constraints that must still hold
- html-pages rule: an agent never reads, greps, parses or stages-to-read a Job Board page; it only presents it.
- The page presented is session entry's `job_board_path` and nothing else; the Opening's one-line rule is unchanged.
- One access request, minimal folder set, never a request for computer control.

## 6. Options considered
1. Neutral wording, connectedFolders check and early access request (recommended): removes the failed first call, keeps the prompt only when the folder is unconnected.
2. Wording change only: fixes the assumption, keeps the failed first stage.
3. Leave as is: costs one failed call per session, no behaviour risk.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Locate the hook definition, shared/present-files.md, shared/html-pages.md and the draft procedure step-1 text.
3. Apply §4 (a) and (b); apply (c) if §9 resolves it.
4. Update any test or lint that pins the old wording.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of present-files delivery fallback for device-bridge sessions complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No source text says `mcp__cowork__present_files` must be tried before checking it is listed.
2. The remote_device route checks `connectedFolders` before the first `device_stage_files` call and requests access at most once, for the draft folder only.
3. The html-pages never-read rule and the Opening's one-line rule are unchanged.
4. Any test or lint pinning the old wording is updated.
Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Does the PostToolUse hook live in the plugin's hook config (fixable here) or in the app harness (then record that and stop)?
- Should (c) name the folder in plain words, given the Opening currently states no paths?

## 10. Verify against HEAD before building
Confirm each path, quote and root cause above in the repo at HEAD; mark any that differ, and append the table to this spec before changing code.
