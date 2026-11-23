---
name: view-key-requests
description: Use only when Brahm invokes /view-key-requests in a Claude Code session in the probanda-dev repo. Lists the queue of practitioners' requests for Probanda's key, oldest first, and records each request's outcome once Brahm says he issued the key or declined it. Never mints, sends or shows a key.
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

# View key requests

Maintainer-only. It ships in the `developer` plugin, which is never public and installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout. Every path below is relative to that checkout's root.

A practitioner asks for Probanda's key from their own computer, on a local page the researcher plugin serves. Each request holds what verifying a practising lawyer requires (full name, jurisdiction (BC), year of call, an optional call date and the firm name as the Law Society's directory shows it), plus an email and an optional phone that the practitioner typed. The typed email and phone are only for contacting the applicant about the request. Brahm verifies the person, mints the key and sends it only to the email address the firm's website or the directory lists for them, never to the typed one. The practitioner then enters it on Probanda's key page in their own session.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), and `POOL_SECRET_KEY` is set in the environment (`node cloud/access/tools/key-requests.mjs list` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop).

You never mint, send or show a key, never look a person up yourself, and never contact a practitioner. A request's details are personal information: show them to Brahm in this session only, and never copy them into a file, an issue, a commit or another tool.

## Steps

1. **Fetch.** Run `node cloud/access/tools/key-requests.mjs list`. It prints the pending requests as JSON, oldest first. `list --all` prints every request, whatever its status, when Brahm asks for them all.
2. **Table.** Show one markdown table, one row per request, oldest first by `created_at`. The columns are the created date, the first 8 characters of `request_id`, `full_name`, `year_of_call`, `call_date`, `firm_name`, `email`, `phone` and `status`. Below it, say how many rows there are. If there are none, say the queue is empty, and stop.
3. **Record an outcome.** Only when Brahm says, for a named request, that he issued its key or declined it, run `node cloud/access/tools/key-requests.mjs set-status <request_id> issued` or `... declined` with the full `request_id`. It saves the outcome once and clears the details the practitioner typed. The practitioner's next status check reports it. Report the result in one line.
4. **Refresh.** Run step 1 again only when Brahm asks to refresh.
