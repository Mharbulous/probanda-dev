---
name: gather-disbursements
description: >
  Gather a BC Supreme Court bill of costs' disbursements: guide the CSV export,
  parse it through the disbursement-processor subagent, and review every flagged
  item with the practitioner. Builds them by interview when there is no CSV.
  Serves both Form 62 and Form 63 bills. Does not collect receipts — those are
  gathered at binding by /assemble with assemble-boc.
---

# Gather Disbursements

First member of the bill-of-costs chain. It fills `disbursements[]` in the shared
state file and nothing else.

**In Cowork, stop here.** In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_lawyer_data__<name>`), stop before any tool
call or file write. This step runs on the PC, in a Claude Code session in the
desktop app's Code tab, where the Probanda plugin is installed, not in a
Cowork cloud sandbox, which cannot see the matter-data folder this chain works in
(#1273, as for `publish-boc` under ADR 0026). Tell the practitioner so, and how
to run it there: open a Code-tab session in the matter's folder and ask for
the same bill-of-costs step. Do not retry or probe in Cowork.

Read `references/bill-of-costs-workspace.md` before doing anything: it defines the
working folder, the state file, the "Bill of costs details" form and the Sources
of Authority that bind this member. If the state file does not exist yet, render
the details form and create it first.

Practitioner input renders per `.claude/skills/shared/elicitation-widget.md` —
plain chat text only as that file's fallback rung, never as the primary ask.

## 1. Ask for the export

Help the practitioner export the matter's disbursements as a CSV from the
accounting system, then elicit the file: one form with an `.elicit-files` dropzone
(`data-name="disbursement_csv"`) paired with a textarea ("or paste the export
here"), and a "No CSV — build disbursements by interview" pill as the escape
hatch.

## 2a. With a CSV — the processor subagent

When the CSV arrives (dropzone or chat attachment — infer first), spawn a
background subagent from `subskills/gather-disbursements/agents/disbursement-processor.md`,
replacing `{CSV_PATH}` with the absolute path to the CSV and `{SKILL_DIR}` with
the resolved path to `subskills/gather-disbursements/`.

It returns two arrays: `disbursements` (each row already carrying its `category`)
and `flagged`.

Render one form with one `.elicit-group` per flagged item: the flag reason on the
question line, pills "Include as-is" / "Exclude" / "Modify", with `data-other`
revealing a corrected amount. Nothing is excluded or changed without an answer.

## 2b. No CSV — the interview

Build the rows through one elicitation form: a group per common item (filing fees,
process server fees, transcripts, expert report fees, photocopying, mediation fees,
court search fees, sheriff fees) with a short amount input each, a
`.elicit-textarea` for anything else, and an `.elicit-files` dropzone in case a
CSV materializes after all.

Assign each answer its `category` yourself, from the seven listed in the workspace
reference.

## 3. Write the state file

Write the finalized rows into `disbursements[]` and save. Every row carries
`date`, `description`, `claimed`, `allowed` (empty) and `category`.

Then report the total claimed and the number of rows.

## Receipts are not gathered here

This member runs before the flagged-item review can exclude or change a row, and it
also serves Form 63 bills. A receipt recorded here could belong to a line that never
reaches the finished bill. Receipts are elicited at binding, by `/assemble` with
`assemble-boc`, against the lines the bill actually carries.

## Stop or continue

End with two choices and no default:

- **Continue to `itemize-boc`** — open it through its front door
  (`/calculate itemize-boc`), never by reading its file directly. For a Form 63
  default-judgment bill there are no tariff items, so the continuation is
  `/publish publish-boc` instead.
- **Stop here** — the state file is saved and the chain resumes whenever the
  practitioner returns.

Never advance without the explicit choice.
