---
name: "CPR"
description: "Jolt the local implementer by hand, through the same path as its post-run beat, and report whether the runner that receives the jolt is online. Invoke as /developer:CPR."
disable-model-invocation: true
---

<!-- developer v0.8.5 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# /CPR

Local lane only. The cloud lane gets no jolt: it has no gate, so each one would start a paid session, and it already starts on labels.

1. Run `env -u GH_TOKEN gh workflow run local-implementer-trigger.yml --ref main --repo Mharbulous/probanda-dev`.
2. Run `env -u GH_TOKEN gh api repos/Mharbulous/probanda-dev/actions/runners --jq ".runners[] | {name, status, busy}"`.
3. Report one line:
   - A runner is `online`: the jolt was sent. The script's gate decides whether Claude Code starts, and its log is under `%LOCALAPPDATA%\probanda-local-implementer\logs` on the PC.
   - No runner is `online`: the jolt waits in GitHub's queue until the PC's runner returns, and GitHub drops it after 24 hours.

When step 1 fails, no jolt was sent. Report its exact error and stop. Never look for a token, and never try another route. A Cowork session may have no `gh` or no GitHub login, so this failure is the expected report there.

A jolt starts a round only when an issue is takeable. It never clears a claim.
