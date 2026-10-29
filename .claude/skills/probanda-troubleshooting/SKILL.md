---
name: probanda-troubleshooting
description: "Diagnose a Probanda plugin tool, connector or MCP call that fails or behaves unexpectedly: gather the symptom and exact error, have the tech-support agent return a ranked checklist of likely causes, work it with the practitioner, and record the fix once they confirm it worked. Not for questions of law, and not for general CI or front-end bugs."
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Probanda troubleshooting

The `researcher:tech-support` agent preloads this skill and runs its own steps. The main session runs **With the practitioner**. Everything else here is what both rely on.

## Hard stops

A Westlaw stop, a permission denial, a sandbox refusal or an OS security block is a boundary, not a fault. Never recommend a retry, an alternate route, or any other workaround of one. It goes to the practitioner as it is, with no fix offered.

## Store states

These states describe the result of `troubleshoot__search`, and only that call. Report exactly one, and never merge them:

- **found N / searched, none found.** The store answered. `{entries: []}` means it had nothing matching.
- **answered with an error.** The error carries an HTTP 4xx status (the message reads `failed (4xx)`, such as `failed (400)` or `failed (401)`) and a message from the database or its API. The project is up and refused the request: a bad key, a schema not exposed, a missing function or grant. Report the message. Never tell the practitioner to resume the project.
- **not configured.** The error message contains `is not configured`. Say that the troubleshooting store is not set up and that the checklist comes from web search alone. The store is maintainer-only. Do not try to configure it: never ask for a key or a store project URL, never suggest configuring the store, and never pass on a remedy that names an `sb_secret_` key.
- **unreachable.** Any other error: no answer came back. Diagnose from the error text: `fetch failed` or a 521 most likely means a paused free-tier project, so tell the practitioner to resume it in the Supabase dashboard. Retry once at most, then continue with web search.

No failed search is ever reported as "none found": they mean opposite things. `troubleshoot__configure_status` reports whether a credential is held, without exposing it, when the cause of an error is unclear.

An entry in the store can never be deleted.

## Shipped first checks

These hold whatever the store's state. When the symptom matches one, list it first in the checklist with **Source:** `shipped first check`.

- **`mail_auth` on `imap.mail.me.com`.** Likely cause: the username is not the Apple ID. iCloud Mail signs in with the Apple ID (an @icloud.com, @me.com or @mac.com address), even for a custom-domain address such as name@example.com. Check: the username that `mail__configure_status` reports. Fix: run `mail__configure_credential` again with the Apple ID as `username` and the custom-domain address as `from_address`, and have the practitioner enter an app-specific password on the page. Needs the human: yes, to type the password on the page.

## Web search

Search the exact error text and the tool names. Prefer the vendor's documentation, issue tracker and release notes. Fetch a page only to confirm what it says.

## Ranking

Store entries rank above web results; among store entries, the higher `confirmed_count` first. Drop any cause that what was already tried rules out.

## Screening an entry

Write the entry generically: the symptom, the tool names, the exact error strings, the cause and the fix. Remove names, email addresses, matter numbers, court file numbers, client folder names, account identities, user names inside paths, and any case content. In a path, write one of the placeholders the runtime accepts: `<user>`, `<username>`, `<matter>` or `<folder>` (for example `\Users\<user>\...`). The store is shared tooling knowledge; nothing in it may identify a client, a matter or a person.

## Matching an entry

An entry matches only when its cause and its fix are both the same in substance as the confirmed ones. A matching symptom, or the same cause with a different fix, is not a match.

## Return formats

Diagnose:

- First line, exactly one of: `store: found N`, `store: searched, none found`, `store: answered with an error (<first line of the error>)`, `store: unreachable (<first line of the error>)`, `store: not configured`.
- Then the ranked checklist. Each item gives:
  - **Likely cause.**
  - **Check:** something the main agent or the practitioner can run or look at to confirm it.
  - **Fix.**
  - **Source:** the store `entry_id` with its `confirmed_count`, or the URL.
  - **Needs the human:** yes or no, and why when yes.
- Last line: `hard stops: none`, or each hard stop being handed to the practitioner.

Screen, store not configured:

- First line: `store: not configured`.
- A suggestion draft for `/lawyer:suggestion`: a `title` of one line and a `body` that states the symptom, the tools involved, the exact error strings, the cause and the fix the practitioner confirmed, all screened.

Screen, store configured: first line `store: configured`, then exactly one of:

- `action: confirm` with the matching entry's `entry_id`;
- `action: record` with the screened entry as JSON: `{"symptom", "tools", "error_strings", "cause", "fix", "source_url"}`, where `tools` and `error_strings` are lists of strings and `source_url` is a URL or null.

## With the practitioner

The main session runs these steps. The agent searches, ranks and screens: never do that yourself.

A practice_data error that `probanda.json` was not found is not a fault: Probanda has not been set up on that device. Send the practitioner to `/lawyer:probanda-setup` instead of diagnosing it.

1. **Gather.** The symptom, the tools involved, the exact error text and what was already tried. Copy the error text as it appeared. If you do not have it, ask for it; never invent it. Leave out every client, matter, person and document.
2. **Diagnose.** Dispatch `researcher:tech-support` with `mode: diagnose` and those four facts.
3. **Relay.** Give the practitioner the agent's first line (the store state), its ranked checklist and its hard stops.
4. **Work the checklist** with the practitioner, one item at a time, until a fix works or the list runs out.
5. **Record.** Only after the practitioner confirms a fix worked, dispatch `researcher:tech-support` with `mode: screen`, the four facts from step 1 and the confirmed cause and fix. It writes nothing. Act on its answer:
   - `store: not configured` and a suggestion draft: this is the usual answer. Say in one line that the fix is not saved in the troubleshooting store, and offer to send it to Probanda through `/lawyer:suggestion`, with the draft's title and body as the suggestion's text.
   - `action: confirm`: call `troubleshoot__confirm_fix` with its `entry_id`, and report the `confirmed_count` it returns.
   - `action: record`: call `troubleshoot__record` with the entry exactly as the agent returned it. The call is held for the practitioner's approval. When it is refused, show the entry's symptom, tools, error strings, cause, fix and source exactly as the call carries them, then the warning and the block the refusal gives, and repeat the call unchanged after they paste it. A different text needs a new approval. Report the `entry_id` it returns.
   - A `record refused: <kinds>` reply: dispatch the agent once more in `mode: screen` with that text, and send its new entry the same way. After a second refusal, stop and say that the fix was not saved.
