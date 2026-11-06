---
journey: Broad sweep to verified authority
actor: practitioner, then research-agent agent
trigger: the practitioner has a vague sense of the legal issue but cannot yet frame a research question
outcome: every authority slot the argument needs is filled by a verified BC authority, or marked dead-end; tier-3 leads are visible on the mockup throughout and never appear in the filed face of any document
preceded_by:
  - Draft the submission skeleton (submissions with open authority slots)
followed_by:
  - Fill the authority slot (excerpt captured verbatim, pinpoint recorded)
  - Render and review the mockup
schema:
  - authorities (url_or_locator, disposition)
  - statements_of_law (excerpt, pinpoint, verification — renamed from excerpts, schema v3 #328/#323; `verification` carries the tier-3-lead state, moved here off the authority in schema v25 #502)
  - law_assertions (proposition, dead_end — renamed from argument_authorities.point_of_law/slot_state, schema v3 #328/#323)
machinery:
  - legal-research gate / research-agent agent (the only writer of `verification='verified'` — what "tier 1–2" names on the shipped column)
  - `/legal-research` (westlaw-query-optimizer) + law-getter (the Westlaw run)
  - renderer: tier-3 lead statements render on the mockup (the practitioner's review surface) and are never emitted into the filed face, same rule as disposition = reserved, proved by the deterministic tests; the 🔬 a lead raises renders on its proposition's line in every mockup
work_markers: 🏛️/📖 open slot → 📜 authority excerpt needed → 📍 authority pinpoint missing → 🔬 a lead in hand, not yet verified → filled; 🚧 dead end
documents: VanIAC written argument; Form 32 Part 3
source: issue 301 grilling, 2026-08-19
status: verified (#305, 2026-08-19)
---

# Broad sweep to verified authority

## The journey

1. The practitioner has a vague idea of the legal issue, not sharp enough to formulate a research query. They search the internet as a broad initial sweep.
2. They find an article on a law-firm website that answers the question as they understand it. The firm is in another province or state. It is not clear whether BC law is the same, and even if it is, the website is not a valid authority and cannot be cited.
3. The statement of law from the website is still useful: it is a concrete proposition to research. It is recorded in the database as a **tier-3 lead** — the `authorities` row carries `url_or_locator` (where it was found); the proposition itself is a `law_assertions` row, and the statement of law hanging off it is a `statements_of_law` row (`excerpt`, `pinpoint`, `verification`). The lead state sits on that statement, as `verification = 'lead'`, not on the authority: an authority is a lead exactly when none of its statements is verified. The proposition's line reads 🔬 *scrutinize* from that moment — a lead is in hand, so 📖 *doctrinal basis needed* no longer fits — and the statement itself prints on no venue face.
4. The research-agent agent reads the open authority slots and the tier-3 leads attached to them, and uses the lead to shape the Westlaw query (via `/legal-research` (westlaw-query-optimizer) and law-getter). Without the lead, the query has to be invented from the argument alone.
5. Research either finds a BC authority for the proposition (entered only through the legal-research gate, its statement written `verification='verified'`, the slot becomes `filled`) or does not (the slot becomes `dead_end`, 🚧). Verification is the one act that clears 🔬.
6. The tier-3 row stays in the database as a breadcrumb: it records that this lead was already run down, so a second session on the same matter does not repeat the sweep. Its own statement keeps `verification='lead'`, so it keeps its own 🔬 Proposal; the proposition's line clears once a verified statement joins it, because that rung asks whether *any* statement behind the proposition is verified.

## Where tier-3 leads are visible

The mockup is the practitioner's only review surface (#290), so a tier-3 lead **must render on the mockup** — beside the open slot it informs, or in the trailing *Held in reserve* section alongside `disposition = reserved` rows. What a tier-3 lead must never do is appear in the **filed face**: the text of the Notice of Application, requisition, order, or submissions package as it would be delivered to the forum. "Never reaches a document" is the wrong sentence; a mockup is a document. The rule is: rendered for the human, withheld from the forum.

## Why the data is shaped this way

- `statements_of_law.verification` exists because the database holds support of two different natures — citable law and uncitable leads — and the renderer must tell them apart without judgment. A tier-3 lead reaching the filed face would be a citation of a law-firm blog.
- `authorities.url_or_locator` exists because a lead is only useful if the next reader can open it.
- The axis that measures precedential weight (`binding | persuasive`) cannot express "unverified lead", which is why the lead state needs a column of its own. (Flagged in #300, made firm in #301.) It was to be a third `tier` value; what shipped instead is `statements_of_law.verification` (`verified` ⊕ `lead`, NOT NULL, no default — schema v25, #502), seated on the statement rather than the authority so that one authority can support a verified statement and an unchecked one at once.
- The legal-research gate (CLAUDE.md) remains the sole writer of `verification='verified'`. The sweep may write `verification='lead'`. This amends A13 in the requirements ledger.

## What would break if this were deleted

Striking `verification` and `url_or_locator` forces the sweep's leads out of the database. The research lawyer then starts every query cold, and parallel or successive sessions re-run the same sweep. The "not sure ⇒ strike" rule does not apply: this journey names the reader.
