---
name: legal-citation
description: "Use whenever writing or displaying a legal citation to the practitioner: case or statute name, citation, pinpoint, as an italicized block quote."
---

<!-- researcher v0.24.0 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

# Legal citation

How a legal citation is displayed. Applies to every case, statute, regulation and rule cited in a message to the practitioner.

1. Block quote. A citation always goes in a block quote (a line starting with `>`), on its own.
2. Italicize the name. Case names are italicized. Statute, regulation and rule names are italicized.
3. Then the citation. Follow the name with its citation (neutral citation first where there is one).
4. Then the pinpoint. End with the pinpoint (`para 16`, `s. 5`, `r. 9-6(3)`).

Separate the parts with commas and end with a full stop:

> *Case name v. Case name*, 2026 BCCA 00, para 16.

> *Supreme Court Civil Rules*, B.C. Reg. 168/2009, r. 9-6(3).

When the pinpoint cites another authority within it, add it after the pinpoint in parentheses, in the same form:

> *Case name v. Case name*, 2026 BCCA 00, para 16 (citing *Other v. Case*, 2024 BCCA 00, para 69).

One authority per block quote. Never state the law the authority stands for.
