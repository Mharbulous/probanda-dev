---
name: probanda-troubleshooting
description: "Diagnose a Probanda plugin tool, connector or MCP call that fails or behaves unexpectedly: gather the symptom and exact error, have the troubleshooter agent return a ranked checklist of likely causes, work it with the practitioner, and record the fix once they confirm it worked. Not for questions of law, and not for general CI or front-end bugs."
---

# Probanda troubleshooting

The front end to the `researcher:troubleshooter` agent. The agent searches the troubleshooting store and the web, ranks the causes and screens what it records. This skill only briefs it and relays its answer: never search, rank or record yourself.

A practice_data error that `probanda.json` was not found is not a fault: Probanda has not been set up on that device. Send the practitioner to `/legal:probanda-setup` instead of diagnosing it.

1. **Gather.** The symptom, the tools involved, the exact error text and what was already tried. Copy the error text as it appeared. If you do not have it, ask for it; never invent it. Leave out every client, matter, person and document.
2. **Diagnose.** Dispatch `researcher:troubleshooter` with `mode: diagnose` and those four facts.
3. **Relay.** Give the practitioner the agent's first line (the store state), its ranked checklist and its hard stops. A hard stop (a Westlaw stop, a permission denial, a sandbox refusal, an OS security block) goes to the practitioner as it is, with no workaround.
4. **Work the checklist** with the practitioner, one item at a time, until a fix works or the list runs out.
5. **Record.** Only after the practitioner confirms a fix worked, dispatch `researcher:troubleshooter` with `mode: record`, the four facts from step 1 and the confirmed cause and fix. Report the `entry_id` and `confirmed_count` it returns. If step 2's first line was `store: not configured`, skip this dispatch and say in one line that the fix cannot be saved because the troubleshooting store is not set up.
