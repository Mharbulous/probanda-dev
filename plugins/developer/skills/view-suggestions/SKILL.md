---
name: view-suggestions
description: Use only when Brahm invokes /view-suggestions in a Claude Code session in the probanda-dev repo. Shows every suggestion in Probanda's Suggestion Box as a table, oldest first, whatever its status, and re-renders it with the filter, sort or columns Brahm asks for. Read-only. Triaging a suggestion -> /hitl-triage.
---

<!-- developer v0.16.1 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

# View suggestions

Maintainer-only. It ships in the `developer` plugin, which is never public and installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout, often driven from Brahm's iPhone through Remote Control. Every path below is relative to that checkout's root.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), and `POOL_SECRET_KEY` is set in the environment (`node cloud/suggestions/tools/triage.mjs list --all` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop).

Read-only. You never run `set-review`, `set-item` or `set-issue`, and never change a suggestion. Triage stays in /hitl-triage.

## Steps

1. **Fetch.** Run `node cloud/suggestions/tools/triage.mjs list --all`. It prints every row as JSON, oldest first.
2. **Table.** Show one markdown table, one row per suggestion, oldest first by `created_at`. The columns are the created date, the first 8 characters of `suggestion_id`, `badge`, `skill`, `plugin_version`, `title` and `issue_number`. Below it, say how many rows there are. If there are none, say the Suggestion Box is empty, and stop.
3. **Change the view.** When Brahm asks, re-render from the same rows: filter on any field (for example status, skill or a date range), sort on any field, or show other columns. The view he asks for lasts for this session only. When he names one row, show its full title and body (the pain point), its items in order (`item_list`, each with its status, reason and category), its `context_lines`, `comment` and `origin`, and, for a row sent before the card, its older `items` and its previews' labels, `chosen` flags and reasons. Write its `mockup_html`, and each older preview's `html`, to a temporary file and send it to him as a file card.
4. **Refresh.** Run step 1 again only when Brahm asks to refresh.
