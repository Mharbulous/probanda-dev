---
name: probanda-troubleshooting
description: "Diagnose a Probanda plugin tool, connector or MCP call that fails or behaves unexpectedly: gather the symptom and exact error, have the troubleshooter agent return a ranked checklist of likely causes, work it with the practitioner, and record the fix once they confirm it worked. Not for questions of law, and not for general CI or front-end bugs."
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Probanda troubleshooting

The front end to the `researcher:troubleshooter` agent. The agent searches the troubleshooting store and the web, ranks the causes and screens the entry it prepares. This skill briefs it, relays its answer and, after the practitioner approves, sends the prepared entry: never search, rank or write an entry yourself.

A practice_data error that `probanda.json` was not found is not a fault: Probanda has not been set up on that device. Send the practitioner to `/lawyer:probanda-setup` instead of diagnosing it.

1. **Gather.** The symptom, the tools involved, the exact error text and what was already tried. Copy the error text as it appeared. If you do not have it, ask for it; never invent it. Leave out every client, matter, person and document.
2. **Diagnose.** Dispatch `researcher:troubleshooter` with `mode: diagnose` and those four facts.
3. **Relay.** Give the practitioner the agent's first line (the store state), its ranked checklist and its hard stops. A hard stop (a Westlaw stop, a permission denial, a sandbox refusal, an OS security block) goes to the practitioner as it is, with no workaround.
4. **Work the checklist** with the practitioner, one item at a time, until a fix works or the list runs out.
5. **Record.** Only after the practitioner confirms a fix worked, dispatch `researcher:troubleshooter` with `mode: prepare`, the four facts from step 1 and the confirmed cause and fix. It writes nothing. Act on its answer:
   - `store: not configured` and a suggestion draft: the troubleshooting store is maintainer-only, so this is the usual answer. Say in one line that the fix is not saved in the troubleshooting store, and offer to send it to Probanda through `/lawyer:suggestion`, with the draft's title and body as the suggestion's text. Never ask the practitioner for a key or a store project URL.
   - `action: confirm`: call `troubleshoot__confirm_fix` with its `entry_id`, and report the `confirmed_count` it returns.
   - `action: record`: call `troubleshoot__record` with the entry exactly as the agent returned it. An entry in the store can never be deleted, so the call is held for the practitioner's approval. When it is refused, show the entry's symptom, tools, error strings, cause, fix and source exactly as the call carries them, then the warning and the block the refusal gives, and repeat the call unchanged after they paste it. A different text needs a new approval. Report the `entry_id` it returns.
   - A `record refused: <kinds>` reply: dispatch the agent once more in `mode: prepare` with that text, and send its new entry the same way. After a second refusal, stop and say that the fix was not saved.
