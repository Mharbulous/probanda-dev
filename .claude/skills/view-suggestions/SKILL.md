---
name: view-suggestions
description: Use only when Brahm invokes /view-suggestions in a Claude Code session in the probanda-dev repo. Shows every suggestion in Probanda's Suggestion Box as a table, oldest first, whatever its status, and re-renders it with the filter, sort or columns Brahm asks for. Read-only. Triaging a suggestion -> /suggestion-triage.
---

# View suggestions

Maintainer-only. It ships in the `developer` plugin, which is never public and installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout, often driven from Brahm's iPhone through Remote Control. Every path below is relative to that checkout's root.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), and `POOL_SECRET_KEY` is set in the environment (`node cloud/suggestions/tools/triage.mjs list --all` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop).

Read-only. You never run `set-status` and never change a suggestion. Triage stays in /suggestion-triage and /adversarial-triage.

## Steps

1. **Fetch.** Run `node cloud/suggestions/tools/triage.mjs list --all`. It prints every row as JSON, oldest first.
2. **Table.** Show one markdown table, one row per suggestion, oldest first by `created_at`. The columns are the created date, the first 8 characters of `suggestion_id`, `status`, `skill`, `plugin_version`, `title` and `issue_number`. Below it, say how many rows there are. If there are none, say the Suggestion Box is empty, and stop.
3. **Change the view.** When Brahm asks, re-render from the same rows: filter on any field (for example status, skill or a date range), sort on any field, or show other columns. The view he asks for lasts for this session only. When he names one row, show its full title and body, its `items` and its previews' labels, `chosen` flags and reasons. Write each preview's `html` to a temporary file and send it to him as a file card.
4. **Refresh.** Run step 1 again only when Brahm asks to refresh.
