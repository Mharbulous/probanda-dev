---
name: calculate-boc
description: >
  Total a BC Supreme Court Form 62 bill of costs: tariff fees at the chosen
  scale, GST and PST on those fees, disbursements as claimed, and the grand
  total, then put the summary to the practitioner for approval and write the
  fill context. Form 62 only — a Form 63 default judgment bill is totalled by
  its own engine under /publish.
---

# Calculate Bill of Costs

Third member of the bill-of-costs chain. It computes the totals, puts them to the
practitioner, and on approval writes the context file `/publish` fills from.

**In Cowork, stop here.** In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_lawyer_data__<name>`), stop before any tool
call or file write. This step runs on the PC, in a Claude Code session in the
desktop app's Code tab, where the Probanda plugin is installed, not in a
Cowork cloud sandbox, which cannot see the matter-data folder this chain works in
(#1273, as for `publish-boc` under ADR 0026). Tell the practitioner so, and how
to run it there: open a Code-tab session in the matter's folder and ask for
the same bill-of-costs step. Do not retry or probe in Cowork.

Read `references/bill-of-costs-workspace.md` before doing anything: it defines the
working folder, the state file and the Sources of Authority that bind this member.
This member needs a state file that already carries the header, `tariffScale`,
`unitValue`, `tariffItems[]` and `disbursements[]`. If any of those is missing, say
which member fills it and stop.

Practitioner input renders per `.claude/skills/shared/elicitation-widget.md` —
plain chat text only as that file's fallback rung, never as the primary ask.

## 1. The summary

Every figure is computed by the script, never in chat. Run:

```bash
python subskills/calculate-boc/scripts/boc_context.py \
    --state "<matter-data folder>/bill-of-costs/bill-of-costs.json"
```

Resolve `subskills/calculate-boc/scripts/` from `/calculate`'s own folder: in a
repo checkout run it from the repo root as
`python .claude/skills/calculate/subskills/calculate-boc/scripts/boc_context.py`;
from an installed plugin, run it from the folder this front door was opened from
(its `Base directory for this skill:` line).

It prints one JSON line and writes `boc-context.json` into the same working
folder. Show the practitioner:

```
BILL OF COSTS SUMMARY
=====================
Style of Cause: [style of cause]
Court File No.: [number]
Scale: [A/B/C] at $[amount]/unit

PART 1 -- TARIFF FEES
  Total units:      [n]
  Fees subtotal:    $[subtotal]
  GST (5%):         $[gst]
  PST (7%):         $[pst]
  Total Part 1:     $[fees total]

PART 2 -- DISBURSEMENTS
  Total disbursements:  $[disb total]

GRAND TOTAL:  $[grand total]
```

## 2. What the figures mean

- **Sales tax on tariff fees.** GST at 5% and PST at 7% both apply to the tariff
  fee subtotal. The script computes both from the subtotal and adds them to it.
- **No sales tax line on disbursements.** A disbursement is claimed at its actual
  cost, including any GST or HST paid. Do not strip tax out of a disbursement and
  do not add tax to one.
- **The Allowed column stays empty** on every tariff item and every disbursement.
  The registrar fills it at the assessment hearing; a bill that arrives with it
  filled in has answered a question that was not the claiming party's to answer.

## 3. Approval

Put the summary to the practitioner with three pills, none preselected:

- **Approve and publish** — the context file is written; open `/publish` with
  `publish-boc` through its front door.
- **Approve, stop here** — the context file is written and nothing else happens.
- **Adjust first** — with a required `.elicit-textarea` describing the
  adjustments. Route the change to the member that owns it: disbursements to
  `gather-disbursements`, scale or units to `itemize-boc`, header details to
  whichever member is open.

A skipped form is not approval.

## Re-running after an edit

If the practitioner edits the state file after approval, run this member again.
There is no timestamp check: the matter tree syncs through OneDrive, where file
times are the sync's, not the edit's, so a stale-context check built on them would
be wrong in both directions.
