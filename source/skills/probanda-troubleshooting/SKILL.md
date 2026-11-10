---
name: probanda-troubleshooting
description: "Diagnose a Probanda plugin tool, connector or MCP call that fails or behaves unexpectedly: gather the symptom and exact error, have the tech-support agent return a ranked checklist of likely causes, work it with the practitioner, and record the fix once they confirm it worked. Not for questions of law, and not for general CI or front-end bugs."
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Probanda troubleshooting

The `researcher:tech-support` agent preloads this skill and runs its own steps. The main session runs **With the practitioner**. **Hard stops** and **Store states** are what both rely on. The rest of the agent's know-how sits in two helper files under `probanda-troubleshooting/references/`, which the agent reads for its mode only: `diagnose.md` (shipped first checks, web search, ranking, the diagnose return format) and `screen.md` (screening, matching, the screen return formats).

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
