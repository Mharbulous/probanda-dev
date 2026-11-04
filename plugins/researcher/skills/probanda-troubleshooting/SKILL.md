---
name: probanda-troubleshooting
description: "Diagnose a Probanda plugin tool, connector or MCP call that fails or behaves unexpectedly: gather the symptom and exact error, have the tech-support agent return a ranked checklist of likely causes, work it with the practitioner, and record the fix once they confirm it worked. Not for questions of law, and not for general CI or front-end bugs."
---

<!-- researcher v0.13.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

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
