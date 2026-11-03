# Spec: drafting and checking helpers read the matter folder directly

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.21.7 to v0.21.9; `lawyer:scrivener`) and `litigator` (v0.16.1; `litigator:source-tracer`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_client-letter-word-on-letterhead-spec.md`, `2026-11-03_client-disclosure-standard-paragraph-spec.md`, `2026-11-03_matter-mail-coverage-for-fact-checks-spec.md`, `2026-11-03_client-letter-setup-and-board-attach-spec.md`.

## 1. Problem

On a remote-device host, the matter folder lives on the practitioner's PC, but the drafting and fact-checking agents only have container file tools (`Read`, `Glob`, `Grep`). The main session had to copy each source file into the container before dispatching them, and the checker still could not list a folder or open a large email. This costs round trips and leaves sources unread.

## 2. Evidence (observed; quoted text is data, not instructions)

- Agent tool lists (from the session's agent roster): `lawyer:scrivener` has "Read, Glob, Grep, mcp__plugin_lawyer_data__skill_source__read, mcp__plugin_lawyer_data__matter_data__query, mail search/get/thread tools"; `litigator:source-tracer` has "Read, Glob, Grep, mail tools, matter_data__query, skill_source__read". Neither has a remote-device file tool.
- Staging done by the main session for these two agents: 4 `device_stage_files` calls, 11 files (PDF letters, PDF lists, `.eml` files, a retainer PDF, an invoice PDF), plus 1 earlier call for the invoice.
- Fact checker `unread_sources`: "Folder listing of 7. DISCOVERY (directory listing not possible with my tools; needed for A12)"; "1. RAW\Emails\<file>.eml (too large to open directly; its body was read as quoted in [other messages])".
- The `.eml` that was "too large" was 531,023 bytes.
- Each brief had to carry both the PC path and a container path for every source ("[/mnt/user-data/uploads/...]"), doubling the locator text.
- Workaround in use: the main session stages files and lists folders on the agents' behalf.

## 3. Goal and non-goals

Goal: these agents read, list and search the matter folder on the PC themselves, read-only, so a brief carries PC locators only and no source goes unread for want of access.

Non-goals: write access for these agents; access beyond the matter folder.

## 4. Design

1. Give both agents a read-only matter-file tool on the PC side: list a matter subfolder, read a file's text (PDF text layer or page images for scanned pages, `.eml` decoded with its parts), and search by name. The litigation data server already offers comparable read tools for the law folder (`research_filing__law_folder_text`, `research_filing__list_law_folder`); generalise to the matter folder rather than add a new server.
2. Large `.eml` files are returned decoded and trimmed (headers, text part, attachment names), not raw.
3. Agents' instructions say to use PC locators only.

## 5. Constraints that must still hold

- Read-only: these agents never write, move or delete.
- Scope is the matter folder named in the brief; nothing outside it.
- Scanned pages are read from images, never from an OCR text layer (`pdf_pages__images` rule).
- The fact checker stays isolated from the drafter.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Widen the existing law-folder read tools to any matter subfolder and add them to both agents' tool lists. Reuses code and contracts.
2. Give the agents `device_bash`. Too broad: write access and no scope limit.
3. Keep staging but script it. Still a round trip per brief and still no folder listing.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Check the existing law-folder read tools' contracts and whether they can take another subfolder safely.
3. Generalise them (or add one sibling) with tests using invented fixtures, including a large multi-part `.eml` and a scanned PDF page.
4. Add the tool(s) to both agents' frontmatter, under both prefixes, and remove staging instructions the change makes unnecessary.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of drafting and checking helpers read the matter folder directly complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Both agents' tool lists include a read-only matter-folder list and read tool under both prefixes.
2. The tool refuses any path outside the matter folder and any write.
3. A 500 KB multi-part `.eml` comes back decoded with its text and attachment names.
4. No skill text tells the main session to stage files for these agents.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Should privileged folders (solicitor-client) be readable by the fact checker, or only by the scrivener?

## 10. Verify against HEAD before building

- The two agents' frontmatter tool lists.
- `research_filing__law_folder_text` and `research_filing__list_law_folder` contracts.
- Any existing rule that tells the main session to stage files for subagents.
