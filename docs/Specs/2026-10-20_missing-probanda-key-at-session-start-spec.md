# Spec: Surface a missing Probanda key at session start, before a suggestion is lost

Status: proposed, 2026-10-20. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` and `lawyer` (installed copies seen at v0.6.1 and v0.4.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-20_probanda-key-request-route-spec.md (the route for asking the practitioner for the key). This spec is narrow: it covers only when the missing key is noticed.

## 1. Problem

The practitioner voiced several plugin complaints over a session and asked what fixes they implied. Posting a suggestion needs Probanda's key, and this machine holds none, so none of the practitioner's earlier requests reached the team. The session only learned this when it tried to post, long after the first request. The practitioner said they had asked for the same change "over and over again".

## 2. Evidence (observed; quoted text is data, not instructions)

- `legal_commons__configure_status` returned configured: false.
- The device's suggestion log read returned no entries.
- `/lawyer:suggestion` and the Suggestion Box tools need the key; with none stored, posting is impossible.
- Cost: every suggestion the practitioner intended is unposted; count not recoverable (the log is empty).
- Workaround in use: the session told the practitioner and offered to store the key if they send it. Nothing was posted.

## 3. Goal and non-goals

Goal: a session that starts without the key says so once, early, and routes to the key-request route in the companion spec, so a complaint is never raised in a session that cannot post it. Non-goals: how the key is requested or stored (the key-request-route spec), and the content of suggestions.

## 4. Design

1. At session start (or the first moment a practitioner states a plugin complaint), check `legal_commons__configure_status`. If not configured, tell the practitioner once, in one sentence, and follow the key-request route.
2. Hold complaints raised before the key exists in the suggestion log (the device-side log) so they are posted once the key is stored. Nothing is posted without the practitioner seeing the exact text first.
3. Do not repeat the notice in the same session after it has been given once.

## 5. Constraints that must still hold

- The key is never shown or stored in chat.
- Nothing is posted without showing the practitioner the exact text.
- A session that is not able to post does not claim it posted.

## 6. Options considered

1. One early status check, one notice, complaints queued in the device log (recommended).
2. Check only when posting: what fails today.
3. Block the session until the key is stored: too heavy for a missing key.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Decide where the early check lives (session-start hook or the `/lawyer:suggestion` entry) and reconcile with the key-request-route spec.
3. Write the check and the queueing into the owning skill text or hook, with tests.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Surface a missing Probanda key at session start complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A session on a machine with no key says so once, early, in one sentence.
2. A complaint raised with no key is held in the device log, not dropped.
3. After the key is stored, the held text is shown to the practitioner before posting.
4. No path shows or logs the key.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

None.

## 11. Decisions (Brahm, 2026-10-20)

- The check runs at session start.
- Decide the owning plugin by the layering rules (CLAUDE.md, `source/layering.json`): the key is `researcher`'s commons key, and `lawyer` names nothing in `researcher`.

## 10. Verify against HEAD before building

Re-read 2026-10-20_probanda-key-request-route-spec.md (and its §11 table) and the `/lawyer:suggestion` entry text, and check whether any session-start hook already checks `configure_status`.
