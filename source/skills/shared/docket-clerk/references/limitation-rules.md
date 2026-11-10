---
page_url: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/12013_01
currency_marker_pattern: 'current to ([A-Z][a-z]+ \d{1,2}, \d{4})'
currency_marker: July 7, 2026
---

# BC Limitation Periods

**Jurisdiction:** British Columbia only
**Sources:** BC Limitation Act (SBC 2012, c 13)
**Last verified:** 2026-07-11 (against the bclaws.gov.bc.ca current consolidation)

Limitation periods are pre-proceeding — they govern *commencing* an action or an arbitration, so they don't belong to any single proceeding's rule set. The Interpretation Act shift primitives are shared via [reckoning.md](reckoning.md). Because a limitation expiry that will be met by a **court filing** is a registry act, run it through the coverage gate and closure shift in [`bcsc-rules.md` § Registry Machinery](bcsc-rules.md#registry-machinery); the coverage gate's beyond-horizon rule ([`bcsc-rules.md#the-coverage-gate`](bcsc-rules.md#the-coverage-gate)) is where the long-duration dates below normally land — raw arithmetic, flagged `shift_pending`, never asserted as final at a 2–15 year horizon. When commencement will be by **arbitration** instead, no registry is involved, so only the plain reckoning.md weekend/holiday shift applies — no coverage gate, no Court Calendar.

---

## Anchor Type: `limitation_expiry`

The limitation expiry date is itself an anchor, not a derived deadline. It is calculated when the practitioner provides the **discovery date** (when the plaintiff knew or ought reasonably to have known of the claim and the identity of the defendant).

| Deadline Type | Offset | Rule | Description |
|---|---|---|---|
| `basic_limitation` | +2 years from discovery | Limitation Act s. 6 | Basic limitation period — commencing an action |
| `ultimate_limitation` | +15 years from act/omission | Limitation Act s. 21 | Ultimate limitation period regardless of discovery |

Store two anchor rows per matter when tracking limitation periods:
- `anchor_type='discovery_date'` — date of discovery (from instructions or documents)
- `anchor_type='act_date'` — date of act or omission (for ultimate period)

Then derive `limitation_expiry` (basic) and `ultimate_limitation_expiry` from those anchors.

> **Note:** Limitation Act exceptions exist (minors, persons under disability, fraud, concealment — ss. 7–18). When any exception may apply, flag it to the practitioner rather than calculating silently.


> **Caveat — arbitration stays:** the Arbitration Act s.12 preserves this limitation suspension for a further 30 days after a s.7 stay of court proceedings pending arbitration lapses without re-commencement. See [`bc-arbitration-rules.md`](bc-arbitration-rules.md) for the operative content — that file is the source of truth for s.12; this is a pointer only.

---

## Tolling periods

A tolling agreement suspends the basic limitation clock for a stated period. Model each period as two anchors and fold them into `basic_limitation`. This section is arithmetic only: whether an agreement is effective, and what any event does to the clock, is for `/apply-to-facts`.

### Anchors

| Anchor type | Date | Source |
|---|---|---|
| `tolling_start` | First day of the suspension | `source_document` = the agreement; `source_excerpt` quotes the clause fixing the day (e.g. "cl. 1 of the agreement") |
| `tolling_end` | Last day of the suspension | The same, quoting the clause fixing the end |

- `party_label` names the party the agreement binds: the same label as that party's `discovery_date` anchor and `basic_limitation` row. Omit it only on a single-party matter, where every period applies.
- `proceeding_label` names the agreement or period (e.g. `tolling agreement 1`, `tolling agreement 2`). A limitation period is pre-proceeding, so the label is free for this use. A `tolling_start` and a `tolling_end` sharing both labels are one period. A matter may have any number of periods.
- An agreement extended by a later agreement keeps its one pair: amend its `tolling_end` (docket-clerk workflow 3). A separate, later suspension is a new pair with its own `proceeding_label`.
- A `tolling_*` anchor derives no row of its own. Storing or changing one re-derives `basic_limitation` for its party.

### "Running from" dates

When the practitioner gives the date a limitation period is "running from", store it as `discovery_date` and say so in the report.

### Deriving the tolled `basic_limitation`

1. **Untolled expiry:** the two-year anniversary of `discovery_date`, by the anniversary reckoning recorded in [`bcca-rules.md` § The inactive appeal list and dismissal as abandoned](bcca-rules.md#the-inactive-appeal-list-and-dismissal-as-abandoned) ("One year" is anniversary reckoning), 29 February included. That paragraph is the source of truth; this is a pointer.
2. **Suspended days for each period**, from the agreement's own wording:

   | The clause makes | Suspended days |
   |---|---|
   | Both ends inclusive ("from and including … to and including …") | `tolling_end − tolling_start + 1` |
   | One end exclusive | `tolling_end − tolling_start` |
   | Both ends exclusive | `tolling_end − tolling_start − 1` |
   | No statement either way | `tolling_end − tolling_start`, flagged: the inclusive reading lands one day later |

   The silent-clause count stores the earlier date, the cautious side for commencing. Never tell the practitioner that a claim is in or out of time on the one-day margin between the two readings.
3. **Total:** take the periods in date order and add each one's days, counting a calendar day once where periods overlap. Tolled expiry = untolled expiry + total.
4. **Store** with `upsert-deadline` under the `discovery_date` anchor, with that anchor's labels. `rule_ref`: "Limitation Act s. 6" followed by each agreement and clause applied. `rule_description`: the untolled expiry, then each period with its day count. `review_note`: each clause quoted as applied, plus any flag below.
5. **Landing day:** shift the tolled date exactly as an untolled one (top of this file). For a court filing that means the coverage gate, normally a raw date flagged `shift_pending` at this horizon. For arbitration it means the plain `reckoning.md` shift.

The arithmetic is the same whether the result is past or future. Whether a past date may be stored is governed by the docket-clerk agent's Uncertainty Rules.

### Stop and ask

Store no tolled date, and say what is missing, when:

- a `tolling_start` has no matching `tolling_end`: the period is open and the expiry cannot yet be fixed;
- an end date turns on an event whose occurrence or effect is disputed, such as a termination notice or a contested extension (the docket-clerk agent's Uncertainty Rules).

### Before storing: flag-only checklist

Report each item that fires, with the facts that fired it. Never resolve one, never let one change the arithmetic, and route its effect to `/apply-to-facts`.

- **Demand:** a demand for payment or performance was made at or soon after the date the clock is said to run from. Report it as a possible exception under the ss. 7–18 note above.
- **Earlier commencement:** a notice of civil claim, another proceeding, or a notice to arbitrate on the same claim is dated before or during a tolling period.
- **Exceptions:** any of the ss. 7–18 exceptions in the note above.
- **Period placement:** a tolling period starts before `discovery_date`, starts after the running expiry (untolled expiry plus earlier periods), or overlaps another period.
- **Ultimate period:** tolling is present, and `ultimate_limitation` is still stored as `act_date` + 15 years, not extended. Its `review_note` says that whether tolling extends the s. 21 period is unresolved and goes to `/legal-research` before anything relies on it.

### Worked example (invented dates)

Single-party matter, commencement by court filing. `discovery_date` 2031-05-14, so the untolled expiry is 2033-05-14.

- **One period.** `tolling agreement 1` runs 2031-09-02 to 2031-11-15 and is silent on its end day: 74 days. Tolled expiry 2033-05-14 + 74 = **Wed 2033-07-27**. `review_note` flags that the inclusive reading (75 days) gives Thu 2033-07-28.
- **Two periods.** Add `tolling agreement 2`, 2032-02-03 to 2032-02-17, "from and including … to and including": 15 days. Total 89 days, giving **Thu 2033-08-11**. The inclusive reading of agreement 1 gives Fri 2033-08-12.
- Neither date is a weekend or holiday on its face. The 2033 Court Calendar is normally beyond the confirmed horizon, so each is stored raw and flagged `shift_pending`.
