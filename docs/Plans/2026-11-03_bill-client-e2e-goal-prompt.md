# Goal-oriented prompt: /lawyer:bill-client end to end

## Context
Brahm asked for the handoff to be rewritten as a goal-oriented prompt to paste into a new session. The only output is the prompt below. Nothing in the repo changes in this session.

## Prompt

```text
GOAL
Make /lawyer:bill-client run the whole billing process for one matter, from the last invoice to a complete client invoice ready for the lawyer's signature. It uses the skills already in the Probanda Lawyer and Timekeeper plugins and adds only what they lack. Work in the probanda-dev repo.

DONE WHEN
1. One command: Brahm types /lawyer:bill-client and names a matter. He never has to start another skill. He only answers the confirmations the process asks for.
2. Complete: the invoice covers everything since the last invoice, in the layout of the firm's last signed invoice. Every time line has a date, person, duration, rate, amount and description. Totals tie to the lines. Rates come from the matter's retainer and are never hard-coded.
3. Defensible: each line traces to named evidence in an audit file saved beside the invoice in the matter's BILLING folder. A description states only what that evidence shows and never guesses a purpose. Each time block is confirmed with Brahm against its evidence, one at a time. A candidate date is never billed on its own strength.
4. Accurate: each line's duration is within plus or minus 20% of the working time its evidence supports. A duration the evidence cannot bound goes to Brahm and is recorded in the audit file as his estimate. Example check on the sample matter: the Dec 22 call lasted 12 min 18 s (0.205 h), so a line for that call alone falls between 0.164 h and 0.246 h before rounding.
5. Stops at signature: the invoice is unsigned and marked as a draft for lawyer review. Nothing is sent, no invoice is recorded as issued, and no trust money is moved.
6. Honest about gaps: every source that could not be reached, and every line resting on a gap, is listed for the lawyer on one page before signature.
7. Without the timekeeper plugin, /lawyer:bill-client says time work needs it and stops, as Step 6 does now.
8. Checks and release: python scripts/build_plugin.py --check, check_plugin.py, check_layering.py, check_file_ops.py and check_publishable.py --new-since origin/main all pass, and the change is released with /release. A rehearsal on the sample matter meets items 2 to 6, or you report exactly which it misses.

ASK BRAHM FIRST
Ask these two together, each with a concrete example, before you design the rest.
A. How is the invoice produced? No skill creates one today. /bill-client ends at an Excel pivot chart, and /invoice-reviewing assumes a draft was already made in LEAP or a similar system. Read the last signed invoice and offer the realistic routes, including "stop at a package Brahm enters in LEAP".
B. Which wins on short days, the rounding rule or the 20% limit? Rounding each person's day up to the next 0.1 h can overshoot 20% on any day under 0.5 h. A 0.205 h day bills as 0.3 h, which is 46% over. Options: measure the 20% before rounding and keep the round-up, round to the nearest 0.1 h, or something Brahm prefers.

KEEP THESE DECISIONS (Brahm, 2026-11-02)
- /timecamping is the only judge of which matter time belongs to. /time-sorting stays only for its TimeCamp task list.
- /time-entry-drafting and its UTBMS codes are off this path. Say so if a test shows this leaves descriptions inadequate, and let Brahm decide.
- A person's day under 0.1 h is written off. Lines keep unrounded time.
- Close gaps in TimeCamp only through the connector and never the web app. Uncovered time is entered by Brahm by hand.

WHAT EXISTS, AND THE KNOWN OBSTACLES
- Read first: bill-client, get-candidate-dates, build-timeline, timecamping, time-sorting, time-pipeline-data, timecamping-data, time-entry-drafting, invoice-reviewing, invoice-tracking, wip-tracker and practice-data, all under .claude/skills/. /get-candidate-dates is built, so use it and do not rebuild it.
- /timecamping works one date at a time and says it does not write invoice-ready descriptions. Find what turns a confirmed block into a line a client can read.
- bill-client, timecamping, time-entry-drafting, invoice-reviewing and wip-tracker carry disable-model-invocation: true, which blocks a Skill call from another skill. Solve this without weakening the approval gate on TimeCamp writes.
- bill-client ships in lawyer, and timekeeper sits above lawyer. Each reference to a timekeeper skill must be conditional on the plugin being installed, say what happens without it, and have a ruling in source/layering.json.
- invoice-reviewing cannot read invoice files and does not support line-item checks. Either extend it or say which check replaces it.
- The Excel steps in bill-client are long and rely on clicks. Keep them only if the invoice still needs them.

CONSTRAINTS
- Keep to the repo's CLAUDE.md and COMMANDMENTS.md. Change source and rebuild. Never edit plugins/ by hand.
- Prefer changing existing skills. Any new skill, agent or script must name the failure or cost it answers. Have skill-tooling:context-architect (advise mode) check the design before you build.
- Client information never enters the repo, including tests, fixtures, plans and commit messages. Use invented data in tests.
- Mail: use only the terms in CLAUDE.md. Probanda never permanently deletes mail. Reading for billing moves nothing.
- Before building, show the flow as one diagram: skill names in bold with a short description, a label on every edge, NEW on anything that does not exist yet. Publish it as a rendered artifact, because chat does not render Mermaid.

SAMPLE MATTER: L165 Ghilarducci v. Akal
- Last invoice: BILL#10099, dated 2025-12-09 (initial consult), paid from trust on 2026-07-02. Confirm from the PDF.
- Candidate list: run /get-candidate-dates or ask Brahm to paste the claude.ai Project doc "claude/L165 billing - candidate dates.md". About 40 rows from Dec 4, 2025 to Nov 2, 2026. Strongest: Dec 22, Jan 5, Jan 23, Feb 18-19, Oct 22, Oct 29, Nov 2.
- TimeCamp task "GhilarducciI -L165" since Dec 1: Brahm 5.70 h, Monnie 0.91 h, Kiana 0.04 h. Many entries last seconds, and window titles were the most useful extra evidence.
- Phone: TELUS archives at C:\Users\Brahm\Sync\ADMIN\TIME TRACKING\Telus cover Dec 2025 to Aug 2026. Calendar-month files are Ext. 4 (Brahm); 30th-to-29th files are Ext. 15 (empty). The only real call: Dec 22, 10:36 am, outgoing to the client, 12 min 18 s. Rogers carries the line from about Sep 2026, and no logs have been found.
- Known gaps: logicalaw.ca Outlook mail and calendar are unreachable, the SyncoPaid folder is empty, and access to ADMIN LEAP task data, Downloads, and Monnie's and Kiana's folders was refused.
- Retainer rates: $400/h for lawyers, $150/h for paralegals and assistants. Confirm from the retainer.

WORKING WITH BRAHM
Do not ask non-blocking questions or send him to look things up. No session can trigger the plugin sync, and only Brahm can type /lawyer:bill-client. So after release, check the time on the machine's .last-complete-round file, then give him the exact text to type. Do not call the goal met until that live run passes items 1 to 7, and report what is still unproven until then.
```

## Verification
Compared the prompt's claims with bill-client, get-candidate-dates, source/assignment.json, source/layering.json, the frontmatter of the pipeline skills, and the billable-path memory.
