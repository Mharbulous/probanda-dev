# Spec: research-agent's sources prepared in one step on a remote-device host

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.12.1; `/legal-research`, `researcher:research-agent`, `researcher:memo-reviewer`) and `lawyer` (v0.21.9; `research_filing__law_folder_text`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_note-up-cap-heavily-cited-decisions-spec.md`, `2026-11-03_note-up-agent-batch-cap-spec.md`, `2026-11-03_page-manifest-from-text-extraction-spec.md`, `2026-11-03_legal-research-rules-served-by-operation-spec.md`, `2026-11-03_helpers-read-matter-folder-spec.md`.

## 1. Problem

On a remote-device host the matter folder is on the practitioner's PC, and research-agent's `Read` cannot open host paths. The doctrine tells the caller to stage the extracted texts and name the staged paths, but nothing does it for the caller, so a first spawn without them wastes a full audit run. memo-reviewer has the same limit: given file paths, it returned no verdict and asked for the full text pasted in.

## 2. Evidence (observed; quoted text is data, not instructions)

- Doctrine: "Where the agent's `Read` cannot reach the host scratchpad, as in a cloud session with the matter on the desktop, stage only the rows' `text_path` files ..." (source: `researcher/skills/shared/legal-research.md`, duty 2).
- First research-agent spawn: about 140,000 tokens, 23 tool uses, no memo; its return: "My Read tool cannot reach host `C:\` paths, and I cannot list the law-text folder ... I guessed two decision file names wrong (`not_found`)."
- Caller then made 6 `law_folder_text` calls and 4 `device_stage_files` calls (23, 21, 8 and 2 files) and hand-wrote each staged path into the re-invocation prompt.
- memo-reviewer return: "I didn't review the memo and have no verdict, because I don't have its text ... My only tool, skill_source__read, reads the skills tree and can't open files on the matter drive." The caller then pasted the memo (about 25 KB) and notes (about 10 KB) into the message, three times over the review loop.
- Workaround in use: the caller stages by hand and pastes memo text for review.

## 3. Goal and non-goals

Goal: one step gives research-agent and memo-reviewer what they can read, so no spawn runs blind and no memo is pasted by hand.

Non-goals: write access for either agent; reading outside the matter's `6. LAW` tree and scratchpad.

## 4. Design

1. Preferred: the agents read through the litigation data server (which runs on the PC) rather than container `Read`: research-agent already holds `research_filing__law_folder_text` neighbours; give it, and memo-reviewer, a read of a scratchpad or `law-text` file by path. This removes staging entirely, consistent with `2026-11-03_helpers-read-matter-folder-spec.md` §4.
2. Fallback: `law_folder_text` returns a ready-to-paste spawn-prompt block (listing, text paths, UNREAD rows, page manifests) so the caller copies one field, not 20 paths.

## 5. Constraints that must still hold

- Both agents stay read-only and isolated; memo-reviewer still sees only the memo, notes and rule files.
- Privileged and disclosed trees stay closed.
- The memo is saved verbatim; no reviewer or caller edit.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Design §4.1: one read-by-path tool shared with the helpers spec; delete the doctrine's staging paragraph.
2. Design §4.2: keep staging, generate the field. Smaller change, keeps the extra round trips.
3. Spawn the agents with container access to a synced copy. Copies client files; rejected.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Settle with the helpers-read-matter-folder spec which tool both use; extend its scope to `6. LAW` and the research-agent scratchpad.
3. Grant it to research-agent and memo-reviewer; change memo-reviewer's brief to take the scratch paths; remove the staging paragraph from duty 2.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of research-agent's sources prepared in one step on a remote-device host complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. On a remote-device host, research-agent can read every `text_path` `law_folder_text` returns without the caller staging it.
2. memo-reviewer can read the memo and notes from their scratch paths.
3. `shared/legal-research.md` no longer tells the caller to stage text files or paste the memo.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. One shared read tool with the helpers spec, or a separate research-only one?

## 10. Verify against HEAD before building

- `researcher` research-agent and memo-reviewer agent files (tool grants).
- `lawyer` MCP `research_filing__law_folder_text` and `research_filing__write_scratch`.
- `shared/legal-research.md` duty 2 and "memo-reviewer checks every memo before it is saved".
- The status of `2026-11-03_helpers-read-matter-folder-spec.md`.
