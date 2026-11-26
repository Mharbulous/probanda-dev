---
name: "streamline-skill"
description: "List the skill instructions this session read, mark what was needed, wasted, found late or missed, and write a spec for restructuring those skills' source files so future sessions find the needed instruction fast. Run it in the session that used the skills. Invoke as /developer:streamline-skill."
disable-model-invocation: true
---

<!-- developer v0.16.0 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

Goal: a spec for restructuring the skills this session used, so future sessions find the needed instruction fast, without first reading inapplicable material, and never miss one through poor signposting. Edit no skill. The spec is the only file this skill writes.

1. **Inventory.** From this session's transcript, list every skill you used and each reference file and section you read. Mark each item: needed, read but not needed, needed but found late, skipped, or never reached.

2. **Read the current source.** Open each listed skill's SKILL.md and the reference files involved, so every location in the spec is quoted from the file, not from memory. In a probanda-dev checkout, read `source/skills/<skill>/`. Elsewhere, such as Cowork, read the installed copy from the base directory the skill's load message named.

3. **Diagnose.** For each item read but not needed, and each item needed but found late, skipped or never reached, name its cause:
   1. Bloat: situational SKILL.md content most sessions don't need.
   2. Misleading references: pointers to the wrong place, to a whole file when one section would do, or lacking "when to read".
   3. Buried context: needed instructions hidden in long sections or design-history rationale.
   4. Poor scoping: reference files without a clear scope boundary, so no signpost can label them accurately.

4. **Target structure.** Every proposed change moves the skills toward this:
   - Hub and spoke: SKILL.md is the hub holding every signpost. Reference files are one level deep and never point to another reference file in the same skill.
   - Each signpost states when to read its target, precisely enough to be followed only when it applies.
   - A hand-off to another skill lands on a new, self-signposting hub, so cross-skill references are fine.
   - Material used by several skills goes in `source/skills/shared/`, which each SKILL.md points to directly.

5. **Write the spec.** For each proposed change give:
   - source location (file and section)
   - what moves, splits or is cut
   - destination
   - the exact replacement pointer text

   Every location names the source path (`source/skills/<skill>/...` or `source/...`), never a built `plugins/` path or an installed copy's path. Save the spec as `docs/skill-streamlining/<YYYY-MM-DD>_<skill-names>.md` in the probanda-dev repo. Where the repo is not granted as a folder, such as Cowork, write it with `repo_docs__write` (under whichever of `mcp__plugin_lawyer_data__repo_docs__write` and `mcp__remote-devices__plugin_lawyer_data__repo_docs__write` this host grants), whose `path` is relative to `docs/` (`skill-streamlining/<YYYY-MM-DD>_<skill-names>.md`). Report the path and a one-paragraph summary.
