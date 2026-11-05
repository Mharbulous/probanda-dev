---
name: "streamline-skill"
description: "List the skill instructions this session read, mark what was needed, wasted, found late or missed, and write a spec for restructuring those skills' source files so future sessions find the needed instruction fast. Run it in the session that used the skills. Invoke as /developer:streamline-skill."
disable-model-invocation: true
---

<!-- developer v0.8.2 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

Goal: a spec for restructuring the skills this session used, so future sessions find the needed instruction fast, without first reading inapplicable material, and never miss one through poor signposting. Edit no skill. The spec is the only file this skill writes.

1. **Inventory.** From this session's transcript, list every skill you used and each reference file and section you read. Mark each item: needed, read but not needed, needed but found late, skipped, or never reached.

2. **Read the current source.** Open each listed skill's SKILL.md and the reference files involved, so every location in the spec is quoted from the file, not from memory. In a probanda-dev checkout, read `.claude/skills/<skill>/`. Elsewhere, such as Cowork, read the installed copy from the base directory the skill's load message named.

3. **Diagnose.** For each item read but not needed, and each item needed but found late, skipped or never reached, name its cause:
   1. Bloat: situational SKILL.md content most sessions don't need.
   2. Misleading references: pointers to the wrong place, to a whole file when one section would do, or lacking "when to read".
   3. Buried context: needed instructions hidden in long sections or design-history rationale.
   4. Poor scoping: reference files without a clear scope boundary, so no signpost can label them accurately.

4. **Target structure.** Every proposed change moves the skills toward this:
   - Hub and spoke: SKILL.md is the hub holding every signpost. Reference files are one level deep and never point to another reference file in the same skill.
   - Each signpost states when to read its target, precisely enough to be followed only when it applies.
   - A hand-off to another skill lands on a new, self-signposting hub, so cross-skill references are fine.
   - Material used by several skills goes in `.claude/skills/shared/`, which each SKILL.md points to directly.

5. **Write the spec.** For each proposed change give:
   - source location (file and section)
   - what moves, splits or is cut
   - destination
   - the exact replacement pointer text

   Every location names the source path (`.claude/skills/<skill>/...` or `source/...`), never a built `plugins/` path or an installed copy's path. Save the spec as `docs/skill-streamlining/<YYYY-MM-DD>_<skill-names>.md` in the probanda-dev repo. Where the repo is not granted as a folder, such as Cowork, write it with `repo_docs__write` (under whichever of `mcp__plugin_lawyer_data__repo_docs__write` and `mcp__remote-devices__plugin_lawyer_data__repo_docs__write` this host grants), whose `path` is relative to `docs/` (`skill-streamlining/<YYYY-MM-DD>_<skill-names>.md`). Report the path and a one-paragraph summary.
