# Spec: bill-style time descriptions from the outset

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.21.7 at the start of the session and v0.21.9 by its end) and `timekeeper` (installed copy not version-checked in this session). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_defensible-time-entries-spec.md` (owns the billing-rules store, the evidence chain, staff-time inference with recorded confirmation, and `/vet-billable-time` as the gate before `/bill-client`); `2026-11-03_billing-workbook-adjustments-and-chart-script-spec.md`.

## 1. Problem

In a billing run the practitioner asked for "a list of time entries, with one row per date, and with each date followed by time activity descriptions". The session returned a table of raw computer-activity summaries (application names and window titles). The practitioner then had to ask again: "redo the table ... to be more in the style of standard billing descriptions that you would see on a lawyers bill". Only the second pass produced usable invoice narratives. Separately, staff entries had no computer activity at all, so their descriptions were placeholders until the practitioner supplied what the staff member had been doing.

## 2. Evidence (observed; quoted text is data, not instructions)

- Every TimeCamp entry in the billing period had an empty note (`description: ""`) except one the session itself annotated. Count: 60 billable entries pulled, 59 with blank notes.
- `/bill-client` (v0.21.7) Step 6 writes the TimeCamp `description` into a "Notes" column and says nothing about producing client-readable narratives. Its description of the deliverable is "a clean pivot-chart worksheet ready for the biller's review".
- A `/vet-billable-time` skill appeared in the skill list mid-session (plugin re-sync), described as "confirms each TimeCamp line's duration and client-readable description against its evidence ... and writes the billable time summary". The billing run had already passed the point where it would have been used, so it was never called. Its source was not read in this session (UNVERIFIED).
- Window-activity reads used to write descriptions were very large: one call for one date returned 785,312 characters; a call for nine dates returned 4,770,935 characters. Both had to be filtered by `entry_id` in a script.
- Staff entries (legal assistant) had zero window-activity rows in every case (5 entries over 3 days). The session's first descriptions for them were "Assist with filing ..." and "File administration", flagged as placeholders. The practitioner's own reading ("helping with filing, probably filing and organizing documents into the paperless filing system") became the final text.
- Surrounding-event inference that the practitioner accepted: the lawyer's time on the matter ended minutes before the staff entry began, filing documents were saved shortly before, no file in the matter folder changed during the staff entries (consistent with moves and renames, which do not change modified time), and on another day a served document was saved into the court-file folder during the staff member's own entry.
- The bill-style format the practitioner accepted: date, timekeeper initials, a semicolon-separated sequence of present-tense verb phrases ("Telephone call with client; review ...; draft ...; correspondence with ..."), hours to one decimal.

## 3. Goal and non-goals

Goal: the first time-entry table a billing run shows is already in bill style, written from the evidence, with staff entries described from surrounding events and marked as inferred until confirmed.

Non-goals: storing billing rules or the per-line evidence chain (owned by the defensible-time-entries spec); writing TimeCamp notes without per-entry approval; stating law.

## 4. Design

1. `/bill-client` calls `/vet-billable-time` as the step that produces descriptions, before any table of time is shown to the practitioner. No separate "activity summary" table is produced unless asked for.
2. The description style (the format in §2, last bullet) is written once, in one place the vetting step reads, with two or three invented examples. No second copy elsewhere.
3. Staff entries with no activity: describe from the surrounding events listed in §2, say in one line which events the description rests on, and carry an "inferred" flag until the practitioner confirms it. (The recorded confirmation is the defensible-time-entries spec's job; this spec only requires the flag and the one-line basis.)
4. Staff notes at source: when a staff entry on a matter has a blank note, the vetting step lists it once so the practitioner can ask staff to add a short TimeCamp note. Nothing is written to TimeCamp without per-entry approval.

## 5. Constraints that must still hold

- No figure or description is presented as fact that the evidence does not support; inferred staff descriptions stay labelled until confirmed.
- TimeCamp is written only on explicit per-entry approval.
- The practitioner never sees a tool, table or field name.
- No client content in the skill text or tests; examples are invented.

## 6. Options considered (streamline and deburr first, additions last)

1. **Recommended.** Delete `/bill-client`'s raw "Notes" description path and route description writing through `/vet-billable-time`, with the style defined once there. Mostly removal and one pointer.
2. Add a style paragraph to `/bill-client` itself. Rejected: duplicates the vetting step's job and its text.
3. Ask the practitioner for the format each run. Rejected: it is the cost this spec removes.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Read `/vet-billable-time` in full; confirm whether it already writes bill-style descriptions and handles staff entries with no activity. Change only what is missing.
3. Make `/bill-client` call it before any time table is shown, and delete the text that made the raw Notes column the description.
4. Define the style once (§4.2) where the vetting step reads it.
5. Add the staff-entry inference rule and the blank-note listing (§4.3, §4.4).
6. Tests with invented fixtures (§8).
7. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of bill-style time descriptions from the outset complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `/bill-client`'s text calls `/vet-billable-time` before any step that shows the practitioner a table of time.
2. The description style and its examples exist in exactly one file; no other skill restates them.
3. A fixture lawyer entry with blank note and activity evidence yields a bill-style line in the §2 format on the first pass.
4. A fixture staff entry with no activity yields a description, a one-line basis naming the surrounding events, and an inferred flag.
5. A fixture with blank staff notes produces one list of those entries, and no TimeCamp write.
6. Net text added across existing skill files is no more than the text removed, or the excess is justified in the recap.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Is the §2 format the firm's standard for every matter, or only for litigation files?
2. Should inferred staff descriptions appear on the invoice draft at all before confirmation, or be held back?

## 10. Verify against HEAD before building

- `lawyer/skills/bill-client/SKILL.md` (as seen in the installed copy at v0.21.7; v0.21.9 may already differ): Step 6 and the Notes column.
- `timekeeper/skills/vet-billable-time/SKILL.md` (UNVERIFIED path; skill seen only in the skill list).
- Whether the defensible-time-entries spec has landed first; if so, read its staff-time and vetting changes and do not duplicate them.

## 11. Verification against HEAD (be14c121, 2026-11-03)

| Spec claim | Finding at HEAD | Consequence |
|---|---|---|
| `/bill-client` Step 6 writes the TimeCamp description into a "Notes" column | Gone. Step 6 no longer has a Notes column, and the deliverable is the draft invoice. | Nothing to delete. §6 option 1's removal is already done. |
| `/bill-client` calls `/vet-billable-time` before any table of time (§4.1, criterion 1) | Met. `.claude/skills/bill-client/SKILL.md` Step 6.4 invokes it, and every invoice figure comes from its `invoice_lines.json`. Steps 6.1 to 6.3 show candidate dates and `/timecamping`'s day judgments, which are evidence review, not time-entry lines. | No edit to `/bill-client`. |
| Path `timekeeper/skills/vet-billable-time/SKILL.md` (UNVERIFIED) | Source is `.claude/skills/vet-billable-time/SKILL.md`. `source/assignment.json` assigns it to `timekeeper`. | All work is in that folder. |
| Whether `/vet-billable-time` writes bill-style descriptions | No. Step 5's examples are "Phone call to client, 12 min" and "Drafting retainer letter". | Replace them with the style (§4.2). |
| §2 format: date, initials, semicolon sequence, hours to one decimal | The row shape already exists. `tie_out.py` `final` joins a person-day's descriptions with "; " and writes `date`, `initials` and `hours` in `invoice_lines.json`. | The skill only has to write each line's phrases. No script change. |
| Style exists once (§4.2) | The only examples of it in skill text are in `vet-billable-time/SKILL.md`. "Phone call to client" also appears in test fixtures only. | One copy, in Step 5. |
| Staff entries with no activity (§4.3) | Step 3 flags them "no evidence", and Step 5 forbids "a guessed purpose". There is no inference rule. A "no evidence" line bills only if confirmed with an estimate, which `tie_out.py` enforces (`line_evidence`). | Add the labelled inference to Step 5, and keep the existing rule. |
| Blank staff notes (§4.4) | Not listed anywhere. The skill never calls `update_entry`. The roster's `role` field marks `staff`. | One new small script. |
| Whether the defensible-time-entries spec has landed | Partly. be14c121 landed its `tie_out.py`, `line_map.py` and their tests. Its staff inference and recorded confirmation are not in `/vet-billable-time` or `/timecamping`, whose SKILL.md still says it judges only the practitioner's own time. | Do not edit those files or `/timecamping`. This spec adds only the flag and the one-line basis. |

Open questions (§9), decided by the orchestrating session: the format applies to `/bill-client`'s litigation matters, and unconfirmed inferred text never reaches the draft because Step 5 confirms every line.
