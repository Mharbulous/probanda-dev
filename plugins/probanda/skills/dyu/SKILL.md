---
name: dyu
description: Use when the user's message ends with /dyu or $dyu, and only then. The user types it as the last word of a message, after describing an idea, a question or a request. Restate the user's intent in plain language as an active-listening checkpoint, then stop and wait for the user to confirm before answering, implementing, critiquing, researching or expanding.
---

<!-- probanda v0.1.6 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# DYU

Restate the user's intent in plain language to demonstrate understanding, then stop.

Do not answer the user's question yet. Do not implement, critique, optimize, research, inspect files, or expand the idea yet. Wait for the user to confirm that the restatement is accurate.

If the prompt contains questions, paraphrase the questions and the underlying concern instead of answering them.

If the prompt contains an implementation request, restate the requested change, success criteria, and any explicit constraints instead of starting the work.

Only identify an ambiguity when the user's statement has a bona fide ambiguity: conflicting instructions, multiple plausible meanings, or an unclear required referent. A lack of detail is not an ambiguity. Missing scope, unstated implementation choices, or details that can be decided later should not be called ambiguities.

If there is no bona fide ambiguity, do not mention ambiguity at all.

Any reply amending the restatement is not confirmation: restate with the change and wait.

After the user confirms, continue with the confirmed task in the next response.
