---
name: itemize-boc
description: >
  Map a BC Supreme Court matter's litigation steps to Appendix B tariff items for
  a Form 62 bill of costs: pick the costs scale and unit value, verify the tariff
  against live BC sources, run the closed-question interview through categories A
  to I, and assign units to every range item. Form 62 only — a Form 63 default
  judgment bill has no tariff items.
---

# Itemize Bill of Costs

Second member of the bill-of-costs chain. It fills `tariffScale`, `unitValue` and
`tariffItems[]` in the shared state file and nothing else.

**In Cowork, stop here.** In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_legal_data__<name>`), stop before any tool
call or file write. This step runs on the PC, in a Claude Code session in the
desktop app's Code tab, where the Probanda plugin is installed, not in a
Cowork cloud sandbox, which cannot see the case-data folder this chain works in
(#1273, as for `publish-boc` under ADR 0026). Tell the practitioner so, and how
to run it there: open a Code-tab session in their Coclerk checkout and ask for
the same bill-of-costs step. Do not retry or probe in Cowork.

Read `references/bill-of-costs-workspace.md` before doing anything: it defines the
working folder, the state file, the "Bill of costs details" form and the Sources
of Authority that bind this member. If the state file does not exist yet, render
the details form and create it first.

Practitioner input renders per `.claude/skills/shared/elicitation-widget.md` —
plain chat text only as that file's fallback rung, never as the primary ask.

**Form 63 bills do not come here.** A bill of costs for a default judgment under
Rule 3-8 is Form 63 under Rule 14-1 (20), and Schedule 1 replaces the tariff
entirely. Send it to `/publish` with `publish-boc`.

## 1. Scale, unit value, and the tariff check

Elicit the costs scale as three cards — "Scale A — $60/unit", "Scale B —
$110/unit", "Scale C — $170/unit" — with Scale B initially selected as the
default, recorded if the form comes back untouched or skipped. Write `tariffScale`
and `unitValue` to the state file.

While the practitioner answers, spawn a background subagent from
`subskills/itemize-boc/agents/tariff-checker.md`, replacing `{SKILL_DIR}` with the
resolved path to `subskills/itemize-boc/`. Announce "Tariff rates being checked by
subagent."

## 2. The interview

Walk the tariff categories in order, one elicitation form per category. Each
question in the category is one `.elicit-group`: yes/no items as plain pills;
bracketed counts as pills (List of Documents: "Under 100" / "100–500" / "Over
500"); day counts as a range slider or pill row with a `data-other` numeric input;
conducting-versus-being-examined as multi-select pills where both can apply. Keep
every question closed — the form's options are the question; free text appears
only behind `data-other`.

**A — Commencement (Items 1, 5, 6).** Pre-litigation investigations or
correspondence (Items 1–5); originating pleading filed (Item 6); amendments to
pleadings filed after service.

**B — Defence and counterclaim (Items 7–9).** Item 7 is a single block covering
all of the defendant's process: filing the Response, defending, and
counterclaiming. Response to Civil Claim filed (Item 7); counterclaim also filed
(still Item 7); if acting for the plaintiff and the defendant counterclaimed, did
the client respond (Item 9); Third Party Notice filed (Item 8 — third party
proceedings only, never a counterclaim).

**C — Discovery (Items 10–16).** List of Documents prepared or received, and how
many: under 100 is Item 10, 100–500 is Item 11, over 500 is Item 12. Document
demands, inspection requests, production disputes (Items 13–15). Electronic
discovery (Item 16).

**D — Expert evidence and witnesses (Items 17–18).** Expert reports obtained and
served (Item 17); lay witnesses required to attend (Item 18).

**E — Examinations for discovery (Items 19–20).** Examinations conducted, and how
many days; conducting (Item 19) or being examined (Item 20), or both.

**F — Applications, hearings, conferences (Items 21–32).** Interlocutory
applications brought, opposed or unopposed, and hearing length (Items 21–22);
applications by the other side responded to (Items 23–24); applications heard in
writing only (Item 25); appeals of an associate judge's order (Item 28); Case
Planning Conference (Item 29), Trial Management Conference (Item 30), Settlement
Conference (Item 31), Judicial Case Conference (Item 32).

**G — Trial (Items 34–38).** Trial completed, and how many days (Item 34, 5 units
per day preparation, flat; Item 35, 10 units per day attendance, flat); written
argument after trial (Item 37 preparing, Item 38 oral argument). If there was no
trial, how the matter resolved.

**H — Registry steps (Items 39–42).** Notice of Trial filed (Item 39, 1 unit
flat); jury notice filed (Item 40, 1 unit flat); other registry attendances
(Items 41–42).

**I — Miscellaneous (Items 43–48).** Mediation conducted, and how many days
(Item 43); settlement negotiations or Rule 9-1 offers (Item 44); travel required
(Items 45–48).

## 3. Handle the tariff-checker report, then map

Wait for the subagent if it has not returned.

- **"ALL CURRENT" / "READY TO PROCEED":** confirm and proceed. Nothing to elicit.
- **"UPDATE NEEDED":** elicit with pills — "Update the references" / "Decline —
  proceed with warning". On the update return, spawn the second tariff-checker in
  bootstrap mode. **Bootstrap mode writes into the skill tree, which an installed
  plugin cannot do.** In a session that cannot write the skill tree (an installed
  plugin), offer only "Proceed with warning" or "Stop", and say plainly that the
  update has to be run from a repo session.
- **"UNABLE TO VERIFY":** say in chat which sources failed and the last
  verification date from `subskills/itemize-boc/references/source-versions.md`,
  then elicit with pills — "Proceed anyway" (`data-accent="warning"`) / "Stop
  until verified". A skipped form stops. Proceeding on unverified rates is never a
  default.

Read `subskills/itemize-boc/references/tariff-appendix-b.md` and map the confirmed
litigation steps to tariff items. Fill in the fixed unit count for every flat-rate
item; leave `unitsClaimed` empty for range items. Write `tariffItems[]` to the
state file.

Report: how many items were mapped, how many carry fixed units, and how many range
items remain.

## 4. Units for the range items

One item at a time, one elicitation form each:

1. Name the item and state its range in chat ("Item 2 — Investigating and
   advising, 1–30 units").
2. Explain in chat, above the form, what drives the count for this item.
3. Render the options as cards, each titled with a concrete unit number and
   subtitled with the reasoning: low end (straightforward), mid range (moderate
   complexity), high end (significant complexity), and a "Custom number" card with
   `data-other` and a paired `.elicit-other` numeric input.
4. Write the answer into the state file before rendering the next item's form.

Two rules the registrar will hold you to: many items are flat rates per day or per
step, not discretionary ranges — always check the reference rather than assuming a
range exists; and unit assignment is professional judgment. Suggest a count with
reasoning, but the lawyer decides, and erring conservative is right, because
registrars reduce inflated claims.

## Stop or continue

End with two choices and no default:

- **Continue to `calculate-boc`** — open it through its front door
  (`/calculate calculate-boc`), never by reading its file directly.
- **Stop here** — the state file is saved and the chain resumes whenever the
  practitioner returns.

Never advance without the explicit choice.
