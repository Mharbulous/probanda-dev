---
name: "CPR"
description: "Jolt the local implementer by hand, through the same path as its post-run beat, and report whether the runner that receives the jolt is online. Invoke as /developer:CPR."
disable-model-invocation: true
---

<!-- developer v0.13.3 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

# /CPR

Local lane only. The cloud lane gets no jolt: it has no gate, so each one would start a paid session, and it already starts on labels.

1. Run `env -u GH_TOKEN gh workflow run local-implementer-trigger.yml --ref main --repo Mharbulous/probanda-dev`.
2. Run `env -u GH_TOKEN gh api repos/Mharbulous/probanda-dev/actions/runners --jq ".runners[] | {name, status, busy}"`.
3. Report one line:
   - A runner is `online`: the jolt was sent. The script's gate decides whether Claude Code starts, and its log is under `%LOCALAPPDATA%\probanda-local-implementer\logs` on the PC.
   - No runner is `online`: the jolt waits in GitHub's queue until the PC's runner returns, and GitHub drops it after 24 hours.

When step 1 fails, no jolt was sent. Report its exact error and stop. Never look for a token, and never try another route. A Cowork session may have no `gh` or no GitHub login, so this failure is the expected report there.

A jolt starts a round only when an issue is takeable. It never clears a claim.
