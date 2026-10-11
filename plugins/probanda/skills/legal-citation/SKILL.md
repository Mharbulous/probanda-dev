---
name: legal-citation
description: "Use whenever writing or displaying a legal citation to the practitioner: case or statute name, citation, pinpoint, as an italicized block quote."
---

<!-- probanda v0.1.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

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
