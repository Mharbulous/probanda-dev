---
name: view-key-requests
description: Use only when Brahm invokes /view-key-requests in a Claude Code session in the probanda-dev repo. Lists the queue of practitioners' requests for Probanda's key, oldest first, and records each request's outcome once Brahm says he issued the key or declined it. Never mints, sends or shows a key.
---

# View key requests

Maintainer-only. It ships in the `developer` plugin, which is never public and installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout. Every path below is relative to that checkout's root.

A practitioner asks for Probanda's key from their own computer, on a local page the researcher plugin serves. Each request holds only what verifying a practising lawyer requires: full name, jurisdiction (BC), year of call, an optional call date and the firm name as the Law Society's directory shows it. It holds no email address. Brahm verifies the person, mints the key and delivers it himself, out of band. The practitioner then enters it on Probanda's key page in their own session.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), and `POOL_SECRET_KEY` is set in the environment (`node cloud/access/tools/key-requests.mjs list` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop).

You never mint, send or show a key, never look a person up yourself, and never contact a practitioner. A request's details are personal information: show them to Brahm in this session only, and never copy them into a file, an issue, a commit or another tool.

## Steps

1. **Fetch.** Run `node cloud/access/tools/key-requests.mjs list`. It prints the pending requests as JSON, oldest first. `list --all` prints every request, whatever its status, when Brahm asks for them all.
2. **Table.** Show one markdown table, one row per request, oldest first by `created_at`. The columns are the created date, the first 8 characters of `request_id`, `full_name`, `year_of_call`, `call_date`, `firm_name` and `status`. Below it, say how many rows there are. If there are none, say the queue is empty, and stop.
3. **Record an outcome.** Only when Brahm says, for a named request, that he issued its key or declined it, run `node cloud/access/tools/key-requests.mjs set-status <request_id> issued` or `... declined` with the full `request_id`. It saves the outcome once and clears the details the practitioner typed. The practitioner's next status check reports it. Report the result in one line.
4. **Refresh.** Run step 1 again only when Brahm asks to refresh.
