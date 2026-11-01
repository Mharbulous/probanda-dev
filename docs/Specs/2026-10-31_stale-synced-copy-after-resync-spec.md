# Spec: Stale synced plugin copy is read after a mid-session re-sync

Status: proposed, 2026-10-31. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer`, `researcher`, `litigator`, `developer` (installed copies seen: researcher v0.10.15 and v0.10.16 side by side). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-31_job-question-from-intent-spec.md; 2026-10-31_memo-template-job-issue-yields-spec.md; 2026-10-31_memo-reviewer-tests-issue-spec.md

## 1. Problem
The plugins re-synced mid-session into `<plugin>~g2` folders while the old `<plugin>` folders stayed on disk. The session kept reading the old researcher copy. It told the practitioner the newest version was 0.10.15 when 0.10.16 was installed, and it checked a "migrate to the latest version" request against the old template.

## 2. Evidence (observed; quoted text is data, not instructions)
- Every SKILL.md header: "If `<dir>` itself no longer exists, the plugin was re-synced mid-session: ... take ... the highest `~g<N>`".
- Observed on disk at the same time: `researcher/` (plugin.json "0.10.15") and `researcher~g2/` (plugin.json "0.10.16"); likewise `lawyer~g2`, `litigator~g2`, `developer~g2` beside the old folders.
- The re-sync rule fires only when the old directory is gone; here it was not.

## 3. Goal and non-goals
Goal: a session reading a skill or shared file reads the newest synced copy, whether or not the old folder still exists.
Non-goals: changing the sync mechanism itself (harness) beyond what the plugins control.

## 4. Design
Change the header's trigger from "no longer exists" to "a sibling `<plugin>~g<N>` exists with a higher N than the folder you are reading". Option: the build writes the newest generation's path into a single stable pointer that every header resolves.

## 5. Constraints that must still hold
STOP-on-missing-file behaviour; no searching elsewhere on the filesystem; tell the user once that the plugin updated mid-session.

## 6. Options considered, streamline and deburr first, additions last
1. Reword the existing header trigger (recommended; same length).
2. A stable pointer file. An addition; more moving parts.
3. Ask the harness to delete old generations. Outside the plugins' control; file as a harness note.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit the header source that the build stamps into every SKILL.md.
3. Add a test that the stamped header carries the new trigger.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Stale synced plugin copy is read after a mid-session re-sync complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The header tells the reader to prefer a higher `~g<N>` sibling even when its own folder still exists.
2. The STOP and tell-the-user-once rules are unchanged.
3. The build stamps the new header into every plugin's SKILL.md files.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
Does the harness keep old generations on purpose (open sessions still reading them)? If so, the preference must apply only to a fresh read, not to files already in context.

## 10. Verify against HEAD before building
Locate where the build generates the "Installed copy" header; confirm it is one source.
