---
name: dyu
description: Use when the user's message ends with /dyu or $dyu, and only then. The user types it as the last word of a message, after describing an idea, a question or a request. Restate the user's intent in plain language as an active-listening checkpoint, then stop and wait for the user to confirm before answering, implementing, critiquing, researching or expanding.
---

<!-- lawyer v0.34.2 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

# DYU

Restate the user's intent in plain language to demonstrate understanding, then stop.

Do not answer the user's question yet. Do not implement, critique, optimize, research, inspect files, or expand the idea yet. Wait for the user to confirm that the restatement is accurate.

If the prompt contains questions, paraphrase the questions and the underlying concern instead of answering them.

If the prompt contains an implementation request, restate the requested change, success criteria, and any explicit constraints instead of starting the work.

Only identify an ambiguity when the user's statement has a bona fide ambiguity: conflicting instructions, multiple plausible meanings, or an unclear required referent. A lack of detail is not an ambiguity. Missing scope, unstated implementation choices, or details that can be decided later should not be called ambiguities.

If there is no bona fide ambiguity, do not mention ambiguity at all.

Any reply amending the restatement is not confirmation: restate with the change and wait.

After the user confirms, continue with the confirmed task in the next response.
