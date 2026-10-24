---
name: view-suggestions
description: Use only when Brahm invokes /view-suggestions in a Claude Code session in the probanda-dev repo. Shows every suggestion in Probanda's Suggestion Box as a table, oldest first, whatever its status, and re-renders it with the filter, sort or columns Brahm asks for. Read-only. Triaging a suggestion -> /suggestion-triage.
---

<!-- developer v0.1.20 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# View suggestions

Maintainer-only. It ships in the `developer` plugin, which is never public and installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout, often driven from Brahm's iPhone through Remote Control. Every path below is relative to that checkout's root.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), and `POOL_SECRET_KEY` is set in the environment (`node cloud/suggestions/tools/triage.mjs list --all` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop).

Read-only. You never run `set-status` and never change a suggestion. Triage stays in /suggestion-triage and /adversarial-triage.

## Steps

1. **Fetch.** Run `node cloud/suggestions/tools/triage.mjs list --all`. It prints every row as JSON, oldest first.
2. **Table.** Show one markdown table, one row per suggestion, oldest first by `created_at`. The columns are the created date, the first 8 characters of `suggestion_id`, `status`, `skill`, `plugin_version`, `title` and `issue_number`. Below it, say how many rows there are. If there are none, say the Suggestion Box is empty, and stop.
3. **Change the view.** When Brahm asks, re-render from the same rows: filter on any field (for example status, skill or a date range), sort on any field, or show other columns. The view he asks for lasts for this session only. When he names one row, show its full title and body, its `items` and its previews' labels, `chosen` flags and reasons. Write each preview's `html` to a temporary file and send it to him as a file card.
4. **Refresh.** Run step 1 again only when Brahm asks to refresh.
