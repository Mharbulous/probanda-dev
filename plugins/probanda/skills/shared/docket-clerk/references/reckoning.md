---
page_url: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96238_01
currency_marker_pattern: 'current to ([A-Z][a-z]+ \d{1,2}, \d{4})'
currency_marker: July 7, 2026
---

# Shared Deadline Reckoning — Interpretation Act primitives

The Court-Calendar-independent time-reckoning rules every BC deadline uses: the statutory-holiday/weekend landing shift, clear-day counting, and the latest-permissible inversion. A deadline-calculation session loads this file **plus exactly one** proceeding rule-set file (`bcsc-rules.md`, `bc-arbitration-rules.md`, or `bcca-rules.md`) — or `limitation-rules.md` for a pre-proceeding limitation question.

**Court-registry closure machinery lives elsewhere.** The coverage gate, the ingested BC Supreme Court Court Calendar, business-day counting, the HTML grid, and the `shift_pending`/`limited_day` caveat flags are a **BC Supreme Court** concept and live in [`bcsc-rules.md` § Registry Machinery](bcsc-rules.md#registry-machinery). Only a court-registry filing deadline pulls them in; arbitration party/tribunal-delivery deadlines and Court of Appeal deadlines use only the primitives below.

**Jurisdiction:** British Columbia only
**Last verified:** 2026-07-11 (against the bclaws.gov.bc.ca current consolidation)
**Sources:** Interpretation Act (RSBC 1996, c 238) ss. 25, 25.2, 25.5, 29

---

## The landing-day shift (Interpretation Act s.25(3))

Where a period set by an enactment ends on a **holiday**, the period is extended to the next day that is not a holiday (Interpretation Act (RSBC 1996, c 238) s.25(3)/s.25.5(1)). "Holiday" is defined in s.29: it includes **Sundays and statutory holidays**, but **not Saturdays**.

The BC Supreme Court Civil Rules contain no landing-day shift provision of their own — their Time rule is **Rule 22-4**, not 22-3 — so the shift comes from the Interpretation Act, which applies to every BC enactment (the Civil Rules, the Court of Appeal Rules, the Arbitration Act, BC Reg 4/2001, and the Limitation Act alike).

This baseline shifts a landing on a **Sunday or statutory holiday** to the next non-holiday. A landing on a **Saturday** is *not* shifted by s.29 alone; the court-registry overlay in [`bcsc-rules.md` § Registry Machinery](bcsc-rules.md#registry-machinery) is what additionally treats Saturdays (and Court-Calendar closures) as closed for BCSC filing deadlines.

## Clear-day / exclusive counting (Interpretation Act s.25.2)

Under s.25.2(2), a period expressed as a number of days is counted by excluding the first day and including the last. Under **s.25.2(3)**, a period expressed as "at least", "not less than", "clear", or "… days before" is counted **exclusively at both ends** — both the start day and the end day are excluded, so the stated number of days must fall *strictly between* them.

(Section numbers confirmed against the current consolidation 2026-07-11: the base counting rule is s.25.2(2), and s.25.2(3) adds the one-day extension for "clear"/"at least"/"not less than" periods.)

**Assumption, not verified construction (#740, 2026-09-20).** s.25.2(2) governs "a period of one day or consecutive days", and the Interpretation Act defines no "business day" — that term belongs to the governing Rules (e.g. Court of Appeal Rules R. 1(1)). **Every row in this skill that counts business days and then adds the s.25.2(3) day assumes s.25.2 applies, with "day" read as that Rules' "business day".** Ticket #740 put the question to the research gate and **no authority was located either way**, so the construction is open. If s.25.2 does *not* reach a business-day period, each such date moves one day toward its reference day: a backward filing deadline becomes one business day **later**, and the forward earliest-permissible-hearing floor one day **earlier**. **The modelled dates are the cautious side for a party's own act** — filing by the stored date is timely on either reading, and a hearing set on or after the stored floor is permissible on either. That holds only because no forward deadline *to act* takes the added day: there the added day would store the later date, the unsafe side, so those rows ("within N business days after", e.g. BCSC `application_response`) count without it (#747). **The exposure runs the other way: never tell the practitioner that a filing is late, that the other side is late, or that a hearing date is too early, on a one-day margin that turns on this added day.** Surface the assumption whenever a date turns on it. One limit of the adjustment is settled: s.25.2(3) is keyed to "clear", "at least" and "not less than" only, so a "not more than" period takes no added day on any reading. Full record, including the arithmetic and the parked Westlaw query: `Engineering/bcca-appeal-books-inputs/research-findings-740.md`.

**Confirmed as a permanent assumption (#746, 2026-09-21).** The follow-on ticket ran the routes #740 left open and they are exhausted. **All three of #740's unread leads were retrieved and read in full, plus the two authorities they rest on**, and the research gate's final answer is that there is **no located authority, at any level, deciding whether s.25.2 reaches a period whose unit is the business day — either way**; the assumption is "unsupported by authority and uncontradicted by authority" (`/legal-research` gate, 2026-09-21). None of the five is on point: *C.G. Coyle & Associates Inc. v. Hastings Sunrise Development Ltd.*, 2008 BCSC 527 and *Jim Pattison Industries Ltd. v. 1854 Holdings Ltd.* (1990), 52 B.C.L.R. (2d) 279 (C.A.) are **months** cases, which in the present structure belong to s.25.3, not s.25.2; *AES Engineering Ltd. v. Khan*, 2021 BCSC 1384 and *Cimolai v. British Columbia (Medical Services Commission)*, 2022 BCSC 528 are **calendar-day** cases deciding the inverse question, whether a calendar-day period may be counted in business days (it may not); and 2022 BCCA 396 never reached counting, so 528's analysis stands unreviewed rather than affirmed. **Note especially that *AES*, the only decision in the chain that did the s.25.2 work, expressly disclaimed s.25.2(3) at [23] as "not applicable here"** — so nothing located speaks to the "at least"/"not less than" adjustment itself. The Court of Appeal's published practice directives and completion instructions were swept in full and **state no counting rule**; "clear day" appears nowhere in them, nor in the Rules, nor in this Act. The Westlaw route stays parked in #740 (it is fail-closed on a client-matter code and #746 ran as unbilled firm work) and **a future run is a new ticket, not a reopening**. One piece of registry practice was found and is recorded as administration, not construction: on CA51722 the Vancouver registry refused a response book for a Friday 2026-09-04 hearing as filed one day late, describing the period as "the 2 clear business days deadline" (CSO Registry Notice, Package 4377698, 02-SEP-2026) — which is the date this skill computes, and a day earlier than the no-added-day reading would allow. **The caution in the preceding paragraph stands unaltered and is the operative rule.** Full record: `Engineering/bcca-appeal-books-inputs/research-findings-746.md`.

## Latest-permissible inversion

Most deadlines are *obligations to act by* a date — a landing on a closed day shifts **forward** to the next open day (you can still act later). But some deadlines are **latest-permissible** bounds — the *last* day something may lawfully happen (e.g. `summary_trial_hearing_latest`, `cpc_notice_service`, the trial-record −14-day edge). For these, shifting *forward* would push the date past the legal limit, so a landing on a closed day shifts **backward** to the previous open day instead.

This inversion is a property of the deadline's direction, not of any particular proceeding. Each rule that is latest-permissible says so in its own row; when it is, apply the shift in the inverted direction wherever the shift rule (the weekend/holiday baseline here, or the Court-Calendar overlay in [`bcsc-rules.md` § Registry Machinery](bcsc-rules.md#registry-machinery)) is applied.

When in doubt about whether a specific day qualifies as a holiday or how a landing shifts, surface it to the practitioner rather than asserting.
