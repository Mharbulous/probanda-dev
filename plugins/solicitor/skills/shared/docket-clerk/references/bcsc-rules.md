---
page_url: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/168_2009_01
currency_marker_pattern: 'current to ([A-Z][a-z]+ \d{1,2}, \d{4})'
currency_marker: September 29, 2026
---

# BC Supreme Court Civil Rules — Deadline Rules

**Jurisdiction:** British Columbia only
**Sources:** BC Supreme Court Civil Rules (BC Reg 168/2009); Notice to Mediate (General) Regulation (BC Reg 4/2001)
**Last verified:** 2026-07-11 (against the bclaws.gov.bc.ca current consolidation). Rules 8-1 and 16-1 remodelled 2026-10-09 for B.C. Reg. 105/2026 from the text of OIC 264/2026 (see [B.C. Reg. 105/2026](#bc-reg-1052026-remodelled-2026-10-09)).

> **Maintenance note:** BC court rules change. When a rule change is confirmed, update this file and set `review_flag='rule_stale'` on any affected active deadlines so the practitioner can review them.

Shared Interpretation Act reckoning primitives (holiday/weekend landing shift, clear-day counting, latest-permissible inversion) live in [reckoning.md](reckoning.md). The court-registry closure machinery — coverage gate, shift rule, business-day counting, sub-7-day counting, caveat flags — is **BCSC-specific and lives in this file** under [§ Registry Machinery](#registry-machinery); every closure-sensitive rule below links into it, and [Order Terms](#order-terms) are recorded there too.

---

## Anchor Type: `trial_date`

Deadlines calculated backward from the trial date. All offsets are calendar days unless noted. Most rules offset directly from `trial_date` (the **Base** column); a few offset from another rule's *computed* deadline instead — see "Chained (second-order) rules" below.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `expert_report` | −84 days | `trial_date` | Rule 11-6(3) | **Any party** intending to tender an expert's report at trial (other than a court-appointed expert's under Rule 11-5) must serve it on every party of record at least 84 days before trial. Party-neutral — the same date binds plaintiff and defence initial reports alike; record whose reports our client's row covers in `rule_description`. |
| `expert_report_responding` | −42 days | `trial_date` | Rule 11-6(4) | A party intending to tender a report **responding** to an expert report served under 11-6(3) must serve the responding report (with notice) at least 42 days before trial. Defined by responding function, not by defendant status. |
| `expert_objection_notice` | earlier of `tmc_date` and −21 days | `trial_date` / `tmc_date` | Rule 11-6(10) | Notice of any objection to the admissibility of an expert's evidence, served on every party of record by the **earlier of** the TMC date and 21 days before trial. Store a **single** row holding the earlier date and record which constraint governed in `review_note` (same min() pattern as `mediation_session`); when no TMC is scheduled, the −21 branch alone governs; recalculate when either anchor changes. A late objection that could reasonably have been noticed in time is barred (11-6(11)). |
| `trial_record_earliest` | −28 days | `trial_date` | Rule 12-3(3)(a) | Earliest day the trial record may be filed ("not more than 28 days before"). **Earliest-permissible marker, permissive** — record that in `rule_description` (same convention as `application_hearing_earliest`); a `full_closure` landing shifts to the **next** open day (can't file on a closed day). See [Trial-readiness windows](#trial-readiness-windows-trial-record--trial-certificate). |
| `trial_record` | −14 days | `trial_date` | Rule 12-3(1), (3)(a) | Latest day for **the party who filed the notice of trial** (12-3(1)) to file the trial record ("at least 14 days before", 12-3(3)(a)). Ask at calculation time whether our client filed the notice of trial: mandatory if ours; if the other side's, store as **monitoring-only** in `rule_description` (same direction convention as `deemed_admission`). **Latest-permissible** — closure shift inverts. See [Trial-readiness windows](#trial-readiness-windows-trial-record--trial-certificate). |
| `trial_certificate_earliest` | −28 days | `trial_date` | Rule 12-4(2) | Earliest day a trial certificate may be filed ("not more than 28 days before"). **Earliest-permissible marker, permissive** — `full_closure` landing shifts to the **next** open day. See [Trial-readiness windows](#trial-readiness-windows-trial-record--trial-certificate). |
| `trial_certificate` | −14 days | `trial_date` | Rule 12-4(1)–(2) | Latest day for **each party of record** to file a trial certificate (Form 42) — always mandatory for our client. If **no** party files one, the trial is removed from the trial list unless the court otherwise orders (12-4(5)), and a party who fails to file may not make further applications without leave (12-4(6)) — surface both consequences when this deadline is at risk. **Latest-permissible** — closure shift inverts. See [Trial-readiness windows](#trial-readiness-windows-trial-record--trial-certificate). |
| `tmc_requisition` | −42 days | `trial_date` | Rule 12-2(1)(b)(iv) | Last day to file a requisition triggering a trial management conference (TMC), if one isn't otherwise ordered |
| `tmc_date` | −28 days | `trial_date` | Rule 12-2(1.1) | Latest date a TMC may be held, if one takes place. Carries one of two practitioner-confirmed statuses once a date is actually on the calendar — `reserved` (date held; the reserving party has 30 days to file the confirming requisition) or `booked` (requisition filed, date confirmed) — either of which supersedes this calculated placeholder as the stored `tmc_date` (same override pattern as [Order Terms](#order-terms)). See "TMC regime selection" below for how status governs `trial_brief_*`. |
| `tmc_requisition_confirm_by` | +30 days | date the reservation was recorded | BC Supreme Court registry reservation practice (no statutory cite) | Last day to file the confirming requisition after reserving a TMC date, before the reservation lapses. Independent of, and can coexist with, `tmc_requisition` above — record the reservation date (when the practitioner reports the reservation, distinct from the reserved `tmc_date` value itself) as its own fact, same as any other source document. See "TMC regime selection" below for lapse handling. |
| `trial_brief_plaintiff` | −56 days (no TMC) / −28 days (TMC booked) | `trial_date` / `tmc_date` | Rule 12-1.1(1) / 12-1.1(2.1)(a) | Plaintiff's trial brief (Form 41) — see "TMC regime selection" below |
| `trial_brief_other_parties` | −49 days (no TMC) / −21 days (TMC booked) | `trial_date` / `tmc_date` | Rule 12-1.1(2) / 12-1.1(2.1)(b) | Other parties' trial brief (Form 41) — see "TMC regime selection" below |
| `summary_trial_hearing_latest` | −42 days | `trial_date` | Rule 9-7(3) | Latest date a summary trial application may be heard — it must be heard at least 42 days before the scheduled trial date. This is a *latest-permissible* date (see [The shift rule](#the-shift-rule) for its inverted closure handling); only applies when a `trial_date` anchor exists |

> **Verify:** Rule numbers above were confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11. Practitioner should also check whether a Trial Management Conference Order has modified any of these deadlines — order terms override rule defaults.
>
> **Verify (expert-report rows, remodelled 2026-07-11):** Rule 11-6's structure — unamended since the July 1, 2010 overhaul — is: initial reports (any party) −84 days (11-6(3)); responding reports −42 days (11-6(4)); objection notice on the earlier of the TMC date and −21 days (11-6(10)). 11-6(5)/(6) are supplementary reports on a materially changed opinion, due "as soon as practicable" — **no** 21-day report deadline exists. The widely repeated "plaintiff 84 / defendant 42 / rebuttal 21" shorthand was never the rule; the former `expert_report_plaintiff` (−84) / `expert_report_defendant` (−42) / `expert_report_responding` (−21) rows followed that shorthand until remodelled on 2026-07-11.
>
> **Verify (trial-readiness rows):** Confirmed against the current consolidation on 2026-07-11: the trial-record window is Rule 12-3(3)(a) (filer defined in 12-3(1)); the trial-certificate window is 12-4(2), with the removed-from-trial-list consequence in 12-4(5) and the no-further-applications-without-leave sanction in 12-4(6). The former standalone witness-list obligation is repealed — see [Witness lists](#witness-lists-resolved-2026-07-11) below.

**TMC regime selection (resolved 2026-07-09).** Rule 12-1.1 sets two mutually exclusive trial-brief regimes per matter, and the choice turns on `tmc_date`'s status, not merely its existence. (Confirmed against the consolidation 2026-07-11: subrule (2.1), as re-enacted by B.C. Reg. 152/2025, triggers on a TMC being "scheduled to take place" and runs −28/−21 days from "the date set for the trial management conference" — the practitioner-confirmed `booked`/`reserved` mapping below is this skill's reading of "scheduled". Also of note: if **no** party files a trial brief, the trial is removed from the trial list, 12-1.1(5).)

- **No `tmc_date`, or `tmc_date` status `reserved`:** calculate `trial_brief_plaintiff`/`trial_brief_other_parties` under the no-TMC default (Rule 12-1.1(1)/(2), −56/−49 days from `trial_date` directly). A reservation is provisional — it can lapse unconfirmed — so it does not switch the regime on its own.
- **`tmc_date` status `booked`:** switch both to the TMC-based offsets (Rule 12-1.1(2.1)(a)/(b), −28/−21 days from `tmc_date`'s computed date), as a chained rule per [Chained (second-order) rules](#chained-second-order-rules) below.

If a TMC is later booked, the docket-clerk agent's Cascade recalculation (workflow 3) supersedes the existing no-TMC `trial_brief_*` rows with the TMC-regime ones automatically, using the standard same-matter/anchor/deadline_type superseding — no separate flagging needed.

**Reservation confirm-by and lapse (resolved 2026-07-10).** When the practitioner reports a TMC date reservation, set `tmc_date` status to `reserved` and store `tmc_requisition_confirm_by` (reservation date + 30 days) as its own deadline row. It coexists independently with `tmc_requisition` (−42 days from `trial_date`) — a date reserved well before the −42-day mark has its own nearer-term 30-day clock running regardless of the backstop; both stay stored as separate rows rather than collapsed into one, so the practitioner can see which obligation is actually driving the current deadline. If `tmc_requisition_confirm_by` passes without the practitioner reporting the requisition as filed (i.e. `tmc_date` never reaches `booked`), revert `tmc_date` from `reserved` back to the calculated `−28 days` placeholder — superseding the reserved row the same way a confirmation would have — and flag the practitioner: "Reservation lapsed — TMC date no longer held." Since only `booked` (never `reserved`) governs the trial-brief regime above, a lapse doesn't itself trigger a `trial_brief_*` recalculation — those were already on the no-TMC default throughout the reservation window.

**Trial-brief follow-ons (resolved 2026-07-11, read-time notes only).** Two Rule 12-1.1 follow-on obligations are deliberately **not stored**:

- **Amended trial brief (Rule 12-1.1(3), −42 days from trial):** the **plaintiff** (only — 12-1.1(3) confers this on the plaintiff, with no equivalent for other parties) may file an amended trial brief no later than 42 days before the scheduled trial date. Contingent on a change event, so there is no anchor to derive from (same reasoning as the never-stored permission gates — see [Amendment of Pleadings](#anchor-types-amendment-of-pleadings-amended_pleading_filed-amended_pleading_served)); surface the −42-day mark at read time whenever the practitioner (as plaintiff) reports a filed brief needs changing. Past that mark, the "promptly" amendment duty in 12-1.1(6) (see [Witness lists](#witness-lists-resolved-2026-07-11)) still applies — surface, don't assert, whether leave or consent is needed.
- **New brief on rescheduling (Rule 12-1.1(8)):** when a trial is rescheduled, a party who already filed a trial brief under (1) or (2) must file a new one against the new trial date — **unless the new date is less than 6 months from the previously scheduled date, or the court otherwise orders** (12-1.1(8)(a)/(b)). It re-runs (1)/(2); it sets no separate countdown of its own. the docket-clerk agent's Cascade recalculation (workflow 3) delivers the ordinary case by construction — a `trial_date` change supersedes and recalculates the `trial_brief_*` rows — so no separate rule row exists. **But cascade does not know the 6-month carve-out:** when a `trial_date` change moves the trial less than 6 months from the prior date, surface that no new trial brief is required rather than presenting the recalculated date as a fresh obligation.

> **Verify (reconfirmed against the enactment's own text, 2026-07-11):** Rule 12-1.1(3) and (8) confirmed against the bclaws consolidation (current to 2026-07-07). (3): the **plaintiff** "may, at least 42 days before the scheduled trial date, file an amended trial brief" — plaintiff-only, −42 days, confirmed (the note was corrected from "a party" to "the plaintiff"). (8): a party who filed a brief under (1) or (2) "must file a new trial brief under those subrules … in relation to the new scheduled trial date unless (a) the new scheduled trial date is less than 6 months from the previously scheduled trial date, or (b) the court otherwise orders" — it re-runs (1)/(2), sets no own countdown; the previously undocumented **6-month exception** was added to the note above.

### Witness lists (resolved 2026-07-11)

There is **no standalone witness-list deadline** in the current Rules. The old obligation — former Rule 7-4(1), "on or before the earlier of the trial management conference and the date that is 28 days before the scheduled trial date" — was repealed by B.C. Reg. 149/2022 (OIC 357/2022; deposited 2022-06-27, in force **2022-10-03**), which also amended Rule 12-5(28) to key the witness-exclusion sanction to "the witness list set out in a party's trial brief". The witness list now travels **inside the trial brief** (Form 41; Rule 12-1.1, enacted as a standalone rule by B.C. Reg. 176/2023, in force 2023-09-01), so `trial_brief_plaintiff`/`trial_brief_other_parties` above *are* the operative witness-list deadlines — store no separate `witness_list` row. Two non-date obligations remain, surfaced at read time rather than stored: a party must not lead evidence at trial from a witness not listed in a trial brief's witness list, absent leave (Rule 12-5(28)); and an inaccurate or incomplete list must be amended and served "promptly" (Rule 12-1.1(6) — no fixed countdown). (A flat −28-day `witness_list` row, built 2026-07-11 from commentary that still described the repealed Rule 7-4 regime, was removed the same day once the primary text was retrieved.)

### Trial-readiness windows (trial record / trial certificate)

The trial record (Rule 12-3(3)(a)) and trial certificate (Rule 12-4(2)) are **window-shaped**: filed at least 14 but not more than 28 days before the scheduled trial date. Each is modelled as **two rows** (resolved 2026-07-11), so the practitioner sees both edges of the window:

- the **`*_earliest`** row (−28 days) — an earliest-permissible marker, permissive, like the hearing-earliest pair in [`application_service_date`](#anchor-type-application_service_date): a `full_closure` landing shifts **forward** to the next open day, since filing can't happen on a closed day and moving later stays inside the window.
- the main row (−14 days) — the **mandatory latest-permissible** filing date: a `full_closure` landing shifts **backward** to the previous open day, like `summary_trial_hearing_latest` (shifting later would leave fewer than 14 days). `limited`/`regional_exception` landings flag `limited_day` as usual, on either row.

Both deadline pairs are ordinary closure-sensitive **calendar-day** dates — coverage gate, shift rule, and HTML grid all apply. Store the two rows together; a cascade recalculation on `trial_date` change recalculates both.

**Who files.** The trial record is filed by *the party who filed the notice of trial* — ask at calculation time whether that is our client, and mark the rows monitoring-only in `rule_description` when it isn't (a defaulted trial record still puts the trial date at risk for everyone, so keep the rows stored either way). The trial certificate binds *each party of record*, so its rows are always mandatory for our client.

### Chained (second-order) rules

A rule whose Base is another deadline type (not `trial_date` itself) derives its offset from that deadline's own **computed, post-gate date** — the date after any closure-day shift has been applied — not from the raw anchor date. See the docket-clerk agent's "Derive deadlines" workflow for the computation order this requires. Each chained deadline is still stored as its own `deadlines` row and goes through the coverage gate and shift rule independently, exactly like a direct rule.


---

## Anchor Types: Pleadings (`nocc_filed`, `nocc_served`, `response_filed`, `response_served`)

The pleadings phase spans several distinct dated events, each its own anchor. Offsets are **calendar days**, forward-run. All but `nocc_service_expiry` are **closure-sensitive** (coverage gate + shift rule + HTML grid, like the `trial_date` family); `nocc_service_expiry` is flag-only pure calendar arithmetic (see Gating below).

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `response_to_civil_claim` | +21 / +35 / +49 days | `nocc_served` | Rule 3-3(3) | Time for a defendant to file a response to civil claim: **+21** served anywhere in Canada, **+35** served in the USA, **+49** served anywhere else. The tier depends on where *that defendant* was served — see [Service location](#service-location). |
| `counterclaim` | same as `response_to_civil_claim` | `nocc_served` | Rule 3-4(1) | A defendant who wishes to counterclaim must file it within the same time set for the response to civil claim (Rule 3-3(3)). **Permissive** — store only when the client intends one; same date as that defendant's `response_to_civil_claim`. |
| `third_party_notice` | +42 days | `response_filed` | Rule 3-5(4) | A defendant may file a third party notice **without leave** within 42 days after **filing** its response. After that, leave is required. **Permissive** — a without-leave window, not an obligation. |
| `reply` | +7 days | `response_served` | Rule 3-6(1) | A plaintiff may file and serve a reply within 7 days after the response to civil claim **has been served**. **Permissive.** |
| `list_of_documents` | +35 days | *end of pleading period* (derived) | Rule 7-1(1) | Each party of record must prepare and serve a list of documents (Form 22) within 35 days after the **end of the pleading period**. Chained off the derived pleading-period-end, not a raw anchor — see [End of the pleading period](#end-of-the-pleading-period-derived). |
| `nocc_service_expiry` | +12 months | `nocc_filed` | Rule 3-2(1) | An original notice of civil claim remains in force for service for **12 months** after filing; serve or renew before then. **Flag-only** — a soft, renewable limit (Rule 3-2(2)), not a filing deadline. |

**Filed vs served.** `response_filed` and `response_served` are distinct events (registry filing vs service on the parties) and may fall on different dates; `third_party_notice` runs from filing, `reply` from service. Record whichever the practitioner supplies; if one rule is needed and only the other date is known, ask.

**Permissive deadlines.** `counterclaim`, `third_party_notice`, and `reply` are permissive ("may"), not mandatory — the last day to act *without leave*, or a window to exercise an option, not an obligation. Record that in `rule_description` so downstream readers don't treat them as hard (same pattern as the earliest-permissible dates in `application_service_date`).

### Service location

`response_to_civil_claim` (and therefore `counterclaim`) has three tiers keyed on where **that defendant** was served: **+21** (Canada), **+35** (USA), **+49** (elsewhere). The anchor carries no stored service-location attribute — **ask the practitioner where the defendant was served at calculation time**, pick the tier, store one `response_to_civil_claim` row, and record the chosen tier and location in `rule_description` (e.g. "served in USA — 35-day tier, Rule 3-3(3)"). Never assume a tier.

### End of the pleading period (derived)

`list_of_documents` runs +35 days from the **end of the pleading period**, which Rule 1-1(1) defines as *the period for filing a responding pleading to the pleading most recently filed in the action* — so it is **derived, not a supplied anchor**. Compute it as the **latest** of the applicable responding-pleading deadlines already calculated for the action (`response_to_civil_claim` across the stored defendants, plus `reply` and the response to any counterclaim or third party notice), then offset +35. This is a [chained rule](#chained-second-order-rules) whose Base is the latest of a *set* of deadlines rather than a single one; recalculate `list_of_documents` whenever any contributing deadline changes (it is cross-anchor — see the docket-clerk agent's "Cascade recalculation"). The pleading period genuinely closes only once every responding pleading is filed (or its period lapses unused), so record which deadline governed in `rule_description` and surface `list_of_documents` for re-verification if a later or amended pleading is filed.

### Multiple defendants

A notice of civil claim is commonly served on several defendants, on different dates and in different locations, each with its own `response_to_civil_claim` tier and date. The model is **one `nocc_served` anchor and one `response_to_civil_claim` deadline per defendant**, distinguished by the ``practice-data`` `party_label` field: pass the defendant's name (or another stable label the practitioner recognizes) on every `upsert-anchor`/`upsert-deadline` call for that defendant's pleadings rows. `party_label` scopes match/conflict/supersession to that defendant, so two defendants' `nocc_served` anchors — same anchor type, different dates — no longer collide, and each defendant's `response_to_civil_claim` (and `counterclaim`/`third_party_notice`/`reply`, where applicable) supersedes only its own prior row. Ask the practitioner for the defendant's name (or confirm a label) whenever a matter has more than one defendant, before storing that defendant's pleadings anchors. Report each defendant's dates back grouped by `party_label`. The derived pleading-period-end still takes the latest across every stored defendant's responding-pleading deadlines.

**Gating.** `response_to_civil_claim`, `counterclaim`, `third_party_notice`, `reply`, and `list_of_documents` are ordinary closure-sensitive calendar-day deadlines. `nocc_service_expiry` is **flag-only pure calendar arithmetic** — a 12-month in-force window, not a registry filing act; store the raw +12-month date, surface it as a renewal reminder, and apply no closure shift or grid (classed with the `limitation_expiry` family).

> **Verify:** Rules 3-2(1), 3-3(3), 3-4(1), 3-5(4), 3-6(1), 7-1(1) and the Rule 1-1(1) "pleading period" definition were confirmed against the BC Laws consolidation (bclaws.gov.bc.ca) on 2026-07-09. Reconfirm the numbering against the current consolidation before relying on them.


---

## Anchor Types: Petitions (`petition_served`, `petition_hearing_date`, `petition_expert_report_served`)

Petition proceedings carry three anchors: the response deadline and the expert-report chain run **forward** from service events (calendar days, like the pleadings response cluster); the petition record deadline runs **backward** from the scheduled hearing date (business days, like the applications cluster).

### `petition_served` → `response_to_petition`

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `response_to_petition` | +21 / +35 / +49 days | `petition_served` | Rule 16-1(4) | Time for a respondent to file and serve a response to petition (Form 67) and any responding affidavits: **+21** served anywhere in Canada, **+35** served in the USA, **+49** served anywhere else. Same three-tier structure as [`response_to_civil_claim`](#anchor-types-pleadings-nocc_filed-nocc_served-response_filed-response_served) — ask the practitioner where the respondent was served at calculation time, store one row, and record the chosen tier and location in `rule_description` (see [Service location](#service-location)). |

**Gating.** `response_to_petition` is an ordinary closure-sensitive calendar-day deadline — coverage gate, shift rule, and HTML grid all apply, as it is a court-registry filing deadline.

### `petition_hearing_date` → `petition_record`

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `petition_record` | −1 business day (clear) | `petition_hearing_date` | Rule 16-1(11)(e), (12) | Petitioner must provide the petition record to the registry, and serve its index on all respondents, by 4pm one full business day before the scheduled hearing. May be provided no earlier than 3 full business days before (16-1(11)(e)); failure to provide it removes the petition from the hearing list (16-1(11.2)) — surface that consequence when this deadline is at risk. In force to 2026-09-30. |
| `petition_record` | −2 business days | `petition_hearing_date` | Rule 16-1(11)(e)(i), (12) | As amended by B.C. Reg. 105/2026: petitioner must provide the petition record to the registry "no later than 4 p.m. on the business day that is 2 business days before the date set for the hearing", and serve the petition record index on each petition respondent by the same time (16-1(12)). May be provided no earlier than 9 a.m. on the business day that is 5 business days before (16-1(11)(e)(i)). Failure to provide it removes the petition from the hearing list (16-1(11.2), unamended) — surface that consequence when this deadline is at risk. Compute by the **Backward algorithm (latest permissible date)** below at N = 2, and read its **New wording, open construction (2026-10-09)** note with it. In force from 2026-10-01. |

**Backward algorithm (latest permissible date).** For a deadline set at "the business day that is N business day(s) before" the hearing (the old rows' "one full business day", N = 1; the 2026-10-01 rows' "2 business days", N = 2): starting the day **before** the hearing date, step backward one day at a time, counting only business days (skip weekends and `full_closure` days), until N business days have been counted — the Nth counted business day is the deadline. At N = 1 this is the preceding business day. Because business-day counting inherently skips non-business days, no separate landing-day shift is needed (same rationale as the [forward algorithm](#business-day-counting), run in reverse). This is a **mandatory** filing deadline, not an earliest-permissible date like `application_hearing_earliest` — a missed `petition_record` deadline is a real default, so do not mark it permissive. **The wording this count models** is "no later than 4 p.m. on the business day that is one full business day before the date set for the hearing" — Rule 16-1(11)(e)(i) (`Engineering/bcsc-rules-inputs/sccr-168_2009_02.txt` lines 2197–2199), with the same wording in Rules 8-1(13) (`sccr-168_2009_01.txt` line 1911) and 8-1(15)(e)(i) (same file, lines 1939–1941), and in the two index-service provisions, Rules 16-1(12) (`sccr-168_2009_02.txt` line 2216) and 8-1(17) (`sccr-168_2009_01.txt` line 1982). **Worked example:** a hearing on Friday 2026-07-31 gives **Thursday 2026-07-30** under this count (computed by `Engineering/3. Staging/check_748_backward.py`), where the [N-business-day count](#anchor-type-application_hearing_date) at N = 1 gives Wednesday 2026-07-29.

**Unresolved construction (#748, put through the `/legal-research` gate on 2026-09-21).** Asked which day that wording produces for a Friday hearing in a week with no court closure, the `/legal-research` gate answered that "**The saved text does not conclusively settle this.** Two readings are open", and named them: "**Reading A — the clear-business-day reading → Wednesday, 4 p.m.**" and "**Reading B — the preceding-business-day reading → Thursday, 4 p.m.**" Its own conclusion was "**On the better reading of the saved text, Wednesday, by 4 p.m.**", immediately qualified by its "**Plain statement: the saved text does not settle this beyond argument.** Reading B (Thursday, 4 p.m.) is open on the words. Nothing in the four saved files defines 'full business day', and no judicial authority construing the phrase was located". Nothing in that answer is noted up — CanLII was out of bounds for the dispatch. Full answer: the 2026-09-21 answer file in `Engineering/bcsc-rules-inputs/` (one full business day vs at least N business days); findings: `Engineering/bcsc-rules-inputs/research-findings-748.md`. **Direction of harm.** The date this file computes is Thursday, which is Reading B; if Reading A is right, the stored date is one day **late** for a filer — the unsafe side, and the opposite of the Court of Appeal rows in #740, where the stored date is the cautious side. **The count here is unchanged, by the practitioner's decision to leave any change to remodel task 4a095a01**, and this same note governs `application_record`, `application_reply_affidavits` and the two index-service provisions. **Never tell the practitioner that a record is timely or late on a one-day margin that turns on this question** — surface the open construction whenever a date turns on it, as of 2026-09-21; restated by remodel task 4a095a01 on 2026-10-01. **From 2026-10-01 this note governs only the rows in force to 2026-09-30**: B.C. Reg. 105/2026 struck out "one full business day" and substituted "2 business days" in Rules 8-1(15)(e)(i), 8-1(17), 16-1(11)(e)(i), 16-1(12), 16-1(15)(a), 23-6(3.1), 23-6(8.8) and 25-5(3)(b)(ii), and rewrote 8-1(20) with the same 2-business-day time.

**New wording, open construction (2026-10-09).** The rows in force from 2026-10-01 (`petition_record`, `application_record`, `application_reply_affidavits_filing`) model "no later than 4 p.m. on the business day that is 2 business days before the date set for the hearing" as the **2nd business day counted back** from the hearing: a hearing on Friday 2026-10-30, in a week with no closure, gives **Wednesday 2026-10-28**. A second reading is open on the words: two whole business days falling between the deadline and the hearing, which gives Tuesday 2026-10-27. The new words drop "full" and use none of "clear", "at least" or "not less than", the closed trigger list for the s.25.2(3) added day ([reckoning.md](reckoning.md) § Clear-day / exclusive counting, #740), so that adjustment is not engaged on its face. The question has **not** been put to the `/legal-research` gate. **Direction of harm:** if the second reading is right, the stored date is one day **late** for a filer — the unsafe side. **The stored date is the plain reading by the practitioner's decision of 2026-10-09**, as the #748 rows are. **Never tell the practitioner that a record or reply affidavit is timely or late on a one-day margin that turns on this question**; surface it whenever a date turns on it.

**Gating.** Business-day counting requires confirmed calendar coverage for every year the (short) counting window touches, per [the coverage gate](#the-coverage-gate). A `limited`/`regional_exception` day encountered while stepping back sets the `limited_day` flag for practitioner confirmation, same as the forward algorithm.

> **Verify (petition_record row in force to 2026-09-30; response tiers unchanged):** Confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11: the response tiers are Rule 16-1(4)(c)(i)–(iii) (21/35/49 days keyed on where the petition respondent was served), and the petition record deadline is Rule 16-1(11)(e)(i) (no later than 4 p.m. on the business day that is one full business day before the hearing). The record may also be provided **no earlier than** 9 a.m. three full business days before the hearing (16-1(11)(e)(i)), and a petitioner who fails to provide it has the petition removed from the hearing list unless the court otherwise orders (16-1(11.2)).

### `petition_served` / `petition_expert_report_served` → expert reports (forward)

Expert evidence in a petition proceeding has its own service countdowns (Rule 16-1(6.1)–(6.3), enacted by B.C. Reg. 149/2022, in force 2022-10-03). Unlike the trial track's Rule 11-6 clock, these run **forward from service events, not backward from the hearing date** — petitions are affidavit-based chambers matters with no fixed far-off hearing to count back from, so the drafters anchored expert exchange to service (reconfirmed against the current consolidation and the enacting gazette, 2026-07-11 — see Verify note). Every limb opens with "Unless the court otherwise orders," so these are **court-displaceable defaults**, computable the moment service occurs. Offsets are **calendar days**, forward.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `petition_expert_report` | +42 days | `petition_served` | Rule 16-1(6.2)(b) | A **petition respondent** intending to tender an expert's report must serve it on the petitioner and every other party of record within 42 days after being served the filed petition. **Direction matters:** mandatory when **our client is the respondent**; when our client is the petitioner, store as **monitoring-only** in `rule_description` (same convention as `deemed_admission`). Note whose report the row covers. |
| `petition_expert_report_responding` | +49 days | `petition_expert_report_served` | Rule 16-1(6.2)(c) | Any party intending to tender an expert's report **responding** to one served under 16-1(6.2)(b) must serve it within 49 days after being served that report. Runs off the **new anchor** `petition_expert_report_served` (the date a 16-1(6.2)(b) report was served) — no date can be calculated until that service is reported, the same event-anchored pattern as `case_plan_proposal_received`. Mandatory when our client intends to respond; monitoring-only otherwise. |

**Petitioner's supporting reports (read-time note, not stored).** Rule 16-1(6.2)(a): a **petitioner** must serve each supporting expert report **at the same time as serving the filed petition** — a concurrent-with-service obligation with no countdown, so no stored row (same reasoning as the never-stored gates). Surface it when our client is the petitioner and a petition with expert evidence is being served.

**Gating.** Both stored rows are ordinary closure-sensitive calendar-day deadlines — coverage gate, shift rule, and HTML grid all apply. Serving a document is an act whose time is set by enactment, so the Interpretation Act s.25(3) landing-day shift applies (same as the `response_to_petition` / pleadings response cluster).

**Notice of hearing of petition (read-time note, not stored).** Rule 16-1(8): to set a petition down for hearing the petitioner files a notice of hearing (Form 68; "notice of hearing of petition" since B.C. Reg. 105/2026, which changed the wording only). In case **(b)** — where a response to petition has been filed and served under 16-1(4)(c) — it must be served on each petition respondent **at least 7 days before the date set for the hearing**; in case **(a)** — no response served — it may be filed at any time before the hearing, with no fixed period. Surface the 7-day period when a contested petition's hearing is being set — no stored row (a scheduling mechanic, not a docketed obligation).

> **Verify (reconfirmed against the enactments' own text, 2026-07-11):** Rule 16-1(6.2)(a)/(b)/(c) confirmed **forward-from-service** (not backward-from-hearing as modelled in the 2026-07-11 blocked-network build) against the bclaws.gov.bc.ca consolidation (current to 2026-07-07) and the enacting gazette (B.C. Reg. 149/2022, Sch. 1, s. 8; O.C. 357/2022, in force 2022-10-03), independently cross-checked by a research agent. **Corrections made:** (b) = petition respondent's own report, +42 days from being served the petition (was mis-modelled as −42 "responding" off the hearing); (c) = responding report, +49 days from being served a (b) report (was mis-modelled as −49 "initial" off the hearing) — the 42/49 counts and the initial/responding roles were both inverted, and the base anchor and direction were wrong. (6.3) imports only Rule 11-6(2) (proof of qualifications), **not** the trial timing. No amendment after B.C. Reg. 149/2022. 16-1(8)(b)'s 7-day notice confirmed (case (b) only; case (a) has no fixed period).


---

## Anchor Type: `application_service_date`

The date a notice of application (and its supporting affidavits) is served on the application respondents. From it, two things are derived forward, both business-day counted (see [Business-day counting](#business-day-counting)): the **earliest permissible hearing date** — a scheduling constraint (the hearing may not be set any sooner), *not* an obligation to act by a deadline — and the respondent's **application response** deadline, an ordinary mandatory filing deadline.

**Two regimes.** B.C. Reg. 105/2026 (in force 2026-10-01) repealed Rule 8-1(5)–(8), so no hearing floor is counted from service any more. From 2026-10-01 an applicant **serves an unfiled** notice of application (new 8-1(3)), each respondent may serve an application response within the new (9) period, and the applicant may **set the application down** (new (14.1)) only once each respondent has served one or its period has expired by filing a notice of hearing of application in Form 33.01 ((14.4)), filed and served at least 4 business days before the hearing ((14.5)(a)). Each row below states which regime it belongs to, and resolution picks the row in force on the service date (`rule-update.md` §1, §4).

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `application_hearing_earliest` | +8 business days (clear) | `application_service_date` | Rule 8-1(8)(a) | Earliest permissible hearing date for any application other than a Rule 9-7 summary trial (including Rule 9-6) — must be served at least 8 business days before the hearing. Repealed by B.C. Reg. 105/2026 with no successor row. In force to 2026-09-30. |
| `summary_trial_hearing_earliest` | +12 business days (clear) | `application_service_date` | Rule 8-1(8)(b) | Earliest permissible hearing date when the application is a Rule 9-7 summary trial — must be served at least 12 business days before the hearing. Repealed by B.C. Reg. 105/2026 with no successor row. In force to 2026-09-30. |
| `application_response` | +5 business days | `application_service_date` | Rule 8-1(9) | Respondent's deadline to file and serve an application response (Form 33) to any application other than a Rule 9-7 summary trial (including Rule 9-6). In force to 2026-09-30. |
| `summary_trial_response` | +8 business days | `application_service_date` | Rule 8-1(9) | Respondent's deadline to file and serve an application response when the application is a Rule 9-7 summary trial. In force to 2026-09-30. |
| `application_response` | +5 business days | `application_service_date` | Rule 8-1(9) | As re-enacted by B.C. Reg. 105/2026: a person served with the (3) materials who wishes to respond must **serve** (not file) a copy of an unfiled application response (Form 33), and any affidavit or other evidence to be referred to at the hearing not already served, on the applicant and every other party of record "within 5 business days after service". Counted by the [Forward algorithm (deadline to act)](#business-day-counting) — no added day (#747). Mandatory. In force from 2026-10-01. |
| `summary_trial_response` | +21 days | `application_service_date` | Rule 8-1(9) | As re-enacted by B.C. Reg. 105/2026: in the case of an application under Rule 9-7, the same response must be served "within 21 days after service". **Calendar** days, not business days: an ordinary closure-sensitive calendar-day row with the landing-day shift ([The shift rule](#the-shift-rule)). Mandatory. In force from 2026-10-01. |
| `application_set_down_earliest` | latest across respondents (see below) | each respondent's `application_service_date` / `application_response_served` | Rule 8-1(14.1) | Earliest day the applicant may set the application down for hearing by filing under (14.4). **Earliest-permissible marker, not an obligation.** Chained and cross-anchor — see [Set-down (from 2026-10-01)](#set-down-from-2026-10-01). In force from 2026-10-01. |
| `application_hearing_earliest_after_set_down` | +4 business days (clear) | `application_set_down_earliest` | Rule 8-1(14.5)(a) | Earliest hearing date if the notice of hearing of application is filed and served on the `application_set_down_earliest` date, for an application estimated at 2 hours or less: the notice must be filed and served "at least 4 business days before the date set for the hearing". Base `application_set_down_earliest`; counted by the [Forward algorithm (earliest permissible date)](#business-day-counting). **Earliest-permissible marker.** The hearing must also be set for 9:45 a.m. on a date on which the court hears applications, "or at such other time or date as has been fixed by the court or a registrar" ((14.2)) — surface that, since the Court Calendar does not record chambers days. Not for an application estimated over 2 hours: its date is fixed by a registrar ((14.3)) and (14.5)(b) governs the notice ([`application_hearing_date`](#anchor-type-application_hearing_date)). In force from 2026-10-01. |

- **From 2026-10-01** the response pair (`application_response`/`summary_trial_response`) stays a mutually exclusive pair keyed on whether the application is under Rule 9-7 (the recognised types are listed in [Application types](#application-types-2026-10-09)). `application_set_down_earliest` and `application_hearing_earliest_after_set_down` are stored once per application, for either kind; for an application estimated over 2 hours, store `application_set_down_earliest` only. Ask the practitioner for the time estimate when it is not in the spawn prompt.
- **Until 2026-09-30** the four rows split into **two mutually exclusive pairs**, both keyed on the same standard-vs-summary-trial distinction: `application_hearing_earliest`/`summary_trial_hearing_earliest` for the earliest permissible hearing date, `application_response`/`summary_trial_response` for the respondent's reply deadline. Never store both rows of a pair for the same application.
- The hearing-earliest pair's semantics are **earliest permissible date**, not a deadline to act — record that in `rule_description` so downstream readers (`executive-assistant`, query-deadlines) don't treat it as an obligation. The response pair is an ordinary **mandatory** deadline.
- When a `trial_date` anchor also exists, a summary-trial application is *additionally* bound by [`summary_trial_hearing_latest`](#anchor-type-trial_date) (Rule 9-7(3): heard at least 42 days before trial). Both constraints bind — surface both to the practitioner.
- **The response pair takes no added day (#747, 2026-09-22; unchanged from 2026-10-01).** Rule 8-1(9) read "within 5 business days after service" and "within 8 business days after service", and from 2026-10-01 reads "within 5 business days after service or, in the case of an application under Rule 9-7, within 21 days after service". That is "within … after", and it uses none of the words ("clear", "at least", "not less than") that the s.25.2(3) added day is keyed to. The row stores the **Nth counted business day** itself (see [Forward algorithm (deadline to act)](#business-day-counting)). That is the earlier of the two candidate dates, so filing by it is timely on either reading. The former "(clear)" label stored the later candidate, one business day late for the party's own act. #193 found this and was closed without the fix.

> **Verify (rows in force to 2026-09-30):** Confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11 — with one subrule correction: the service periods sit in **Rule 8-1(8)** (8 business days ordinary, 8-1(8)(a); 12 business days for a Rule 9-7 summary trial, 8-1(8)(b)) — subrule (7) lists *what* must be served, (8) sets *when*. The response periods (5 business days ordinary; 8 business days summary trial) are **Rule 8-1(9)** (subrule (10) is the response's required contents, not its timing).

### Application types (2026-10-09)

The application rows recognise three application types:

- **Ordinary:** any application other than a Rule 9-7 summary trial. It uses the ordinary rows (`application_response`, `application_hearing_earliest`, `notice_of_application_service`, `application_reply_affidavits_service`).
- **Rule 9-6 summary judgment:** an ordinary application for timing purposes, so it uses the ordinary rows.
- **Rule 9-7 summary trial:** uses the `summary_trial_*` rows, and `summary_trial_hearing_latest` when a `trial_date` anchor exists.

If the spawn prompt does not state the application type (ordinary, Rule 9-6 summary judgment or Rule 9-7 summary trial), store no row that depends on it and return an open item asking for the type. Never assume an ordinary application.

**Rule 9-6 has no timing of its own.** A Rule 9-6 summary judgment application sets no notice, response, record or hearing period, so the ordinary-application rows apply. Verified on 2026-10-09 by reading Rule 9-6, subrules (1) to (9), in full in the Supreme Court Civil Rules consolidation current to September 29, 2026 (last amended May 4, 2026 by B.C. Reg. 31/2026). That consolidation does not yet incorporate B.C. Reg. 105/2026, and the [B.C. Reg. 105/2026](#bc-reg-1052026-remodelled-2026-10-09) lists below name no Rule 9-6 subrule.

### Set-down (from 2026-10-01)

**New anchor `application_response_served`:** the date a person required to be served under Rule 8-1(3) served its application response on the applicant. Record one per person, distinguished by `party_label` (same pattern as [Multiple defendants](#multiple-defendants)). It feeds `application_set_down_earliest` and the reply-affidavit rows below.

**`application_set_down_earliest` (Rule 8-1(14.1)).** The rule reads: "The applicant must not set an application down for hearing unless (a) the applicant has served the materials referred to in subrule (3) in accordance with that subrule, and (b) one of the following applies to each person required to be served under subrule (3): (i) the person has served on the applicant an application response in accordance with subrule (9); (ii) the period for the person to serve an application response under subrule (9) has expired." Compute it as follows:

1. **The persons.** Take every person required to be served under (3): each party of record and every other person who may be affected by the orders sought. Each needs an `application_service_date` anchor with its `party_label`. Without the list in the spawn prompt, store nothing and return an open item asking for it.
2. **Each person's date.** If that person has an `application_response_served` anchor, take that date. Otherwise take the first business day after the last day of that person's (9) period, which is the `application_response` or `summary_trial_response` date computed off that person's service date.
3. **The row.** The latest of those dates across all the persons is `application_set_down_earliest`. If it is not a business day (a response served on a weekend), use the next business day, since setting down is a registry filing (a modelled reading, not a construction of (14.1)). Store one row without a `party_label`, and record in `rule_description` which person's date governed.

This is a [chained rule](#chained-second-order-rules) whose base is the latest of a set, like `list_of_documents`, and it is **cross-anchor**: recalculate it, and `application_hearing_earliest_after_set_down` after it, whenever any of the persons' `application_service_date` or `application_response_served` anchors is added or changes. **Open question, not resolved here:** "has expired" is modelled as the end of the period's last day, so the earliest set-down is the following business day.

**Worked example (golden case, computed by hand).** An ordinary application estimated at 2 hours or less. The notice of application is served on one respondent on Thursday 2026-10-08, and no early response is served. Monday 2026-10-12 (Thanksgiving) is a `full_closure` day.
- `application_response`: Fri 10-09 (1), Tue 10-13 (2), Wed 10-14 (3), Thu 10-15 (4), Fri 10-16 (5), so **Friday 2026-10-16**.
- `application_set_down_earliest`: **Monday 2026-10-19**.
- `application_hearing_earliest_after_set_down`: Tue 10-20 (1), Wed 10-21 (2), Thu 10-22 (3), Fri 10-23 (4). The hearing may be no earlier than the next business day, **Monday 2026-10-26**. Without the s.25.2(3) added day it would be Friday 2026-10-23.

**The added day (#740).** `application_hearing_earliest_after_set_down` stores the later floor, which is the cautious side for setting a hearing. **Never tell the practitioner that a hearing date is too early on a one-day margin that turns on this added day** ([reckoning.md](reckoning.md) § Clear-day / exclusive counting).

### `application_response_served` → reply affidavits (from 2026-10-01)

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `application_reply_affidavits_service` | +3 business days | `application_response_served` | Rule 8-1(13)(a) | An applicant who wishes to reply to any materials served under (9) must serve on each application respondent any reply affidavits "subject to paragraph (b) of this subrule, within 3 business days after service". Counted by the [Forward algorithm (deadline to act)](#business-day-counting), with no added day. Store per respondent with its `party_label`, and only when our client is the applicant and intends to reply. Mandatory. In force from 2026-10-01. |
| `summary_trial_reply_affidavits_service` | +5 business days | `application_response_served` | Rule 8-1(13)(b) | The same obligation "in the case of an application that is brought under Rule 9-7, within 5 business days after service". Mandatory. In force from 2026-10-01. |

- The two rows are a mutually exclusive pair keyed on Rule 9-7, like the response pair.
- "After service" is modelled as service on the applicant of the materials replied to, which is that respondent's `application_response_served` date. When a respondent serves further evidence under (9) on a later day, the practitioner records that date as the anchor.
- The reply affidavits must also be **filed** by the time `application_reply_affidavits_filing` sets (Rule 8-1(14.6), [`application_hearing_date`](#anchor-type-application_hearing_date)).
- Rule 8-1(14) ("No additional affidavits") now bars affidavits beyond those served under subrules (3), (9) and (13), absent consent or leave.

### B.C. Reg. 105/2026 (remodelled 2026-10-09)

**Source.** OIC 264/2026, approved and ordered 2026-06-26 and deposited as B.C. Reg. 105/2026, in force 2026-10-01. Schedule 1 amends these Rules. Schedules 2 and 3 amend the Supreme Court Family Rules and the Tax Appeals Regulation and are out of scope.
- Text read from the deposited PDF (`https://www.bclaws.gov.bc.ca/civix/document/id/oic/oic_cur/0264_2026`, 18,583,844 bytes, sha256 `af43a993c306a934f4266878aa6c8938787f3cf3de8c1cb6db6d751fee218546`), Schedule 1 ss. 1–9 on pages 2–6 (s. 10, the forms, begins on page 6).
- Every number and quoted phrase above was checked against the page images, because the PDF's text layer is OCR.
- The wording of a subrule amended by striking out and substituting words (8-1(15)(e)(i), 16-1(11)(e)(i), (12)) is the pre-amendment consolidation text with the substitution applied.
- The bclaws consolidation fetched 2026-10-09 ("current to September 29, 2026", "Last amended May 4, 2026 by B.C. Reg. 31/2026") does **not** yet incorporate this amendment.

**Modelled here:** the rows marked "In force from 2026-10-01" in this section, in [`application_hearing_date`](#anchor-type-application_hearing_date) and in the Petitions section, and the repeal of the 8-1(8) rows.

**Amended but not modelled as rows.** No row cites these, so they block nothing but may need new modelling:
- **Rule 8-1:**
  - (14.7), each application respondent must file its served response, affidavit originals and other (9) materials "after the date on which the notice of hearing of application is filed and before the commencement of the hearing", and bring copies to the hearing — a filing obligation on our client when responding, bounded by two events rather than a counted period;
  - (20), return of a retrieved record, 5 to 2 business days before the new hearing date;
  - (21.1), reset of an application adjourned generally: file Form 33.01 and serve it at least 2 business days before the hearing.
- **Rule 16-1(15)(a):** return of a retrieved petition record, 5 to 2 business days.
- **Rules 23-6(3.1), (8.8) and 25-5(3)(b)(ii):** "one full business day" became "2 business days".
- **Content changes with no time period:** Rule 8-1(1), (3), (4)(d) and (f), (10)(b)(ii) and (iv), (11), (14), (15)(b)(iv), (v) and (v.1), (16) and (21).
- **Wording or conforming references only:** Rules 9-7(8)(a), (10)(a), 11-3(8), 16-1(6), (8), (19)(b)(i), 22-8(11), 22-9(1) and 25-14(5).
- **Forms:** 17, 32, 33, 33.01, 68 and 117.1. These are the form-currency check's work (`rule-freshness.json` `forms`).

**Transition, not decided here.** Which regime governs an application served before 2026-10-01 whose period runs past it is a question of law for `/legal-research` under a named matter (`rule-update.md` §1 step 5, `transition_question`).


---

## Anchor Type: `application_hearing_date`

The scheduled chambers application hearing date, known when the practitioner already has a hearing date fixed (e.g. by requisition) and needs to back-calculate the outstanding deadlines — mirrors [`trial_date`](#anchor-type-trial_date) and the Petitions section's `petition_hearing_date` → `petition_record` pattern. Offsets are **business days** (see [Business-day counting](#business-day-counting)) unless a row says otherwise; direction is backward. From 2026-10-01 (B.C. Reg. 105/2026) the hearing date is set by the applicant's notice of hearing of application (Form 33.01, Rule 8-1(14.4)), or, for an application estimated over 2 hours, fixed by a registrar ((14.3)); a new anchor, `application_hearing_fixed`, records the day the registrar fixes it.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `notice_of_application_service` | −8 business days (clear) | `application_hearing_date` | Rule 8-1(8)(a) | Latest permissible day to serve the notice of application (and supporting affidavits) for any application other than a Rule 9-7 summary trial (including Rule 9-6) — the mathematical inverse of `application_hearing_earliest` in [`application_service_date`](#anchor-type-application_service_date). Store this one when the hearing date is known before service has occurred; store that one when service has already occurred and the hearing isn't yet fixed. **Mandatory** — a missed date here is a real default, not an earliest-permissible marker. Repealed by B.C. Reg. 105/2026 with no successor row; `notice_of_hearing_service` is the nearest new obligation. In force to 2026-09-30. |
| `notice_of_application_service_summary_trial` | −12 business days (clear) | `application_hearing_date` | Rule 8-1(8)(b) | Same as above, for a Rule 9-7 summary trial application. Repealed by B.C. Reg. 105/2026 with no successor row. In force to 2026-09-30. |
| `application_record` | −1 business day (clear) | `application_hearing_date` | Rule 8-1(15)(e) | Applicant must provide the application record to the registry, by 4pm, one full business day before the hearing date — same rule shape **and the same one-business-day count** as the Petitions section's `petition_record`, so compute it by that section's **Backward algorithm (latest permissible date)** paragraph, not by the N-business-day algorithm below, and read its **Unresolved construction (#748)** note with it. May be provided no earlier than 3 full business days before (8-1(15)(e)); failure to provide it removes the application from the hearing list (8-1(15.2)) — surface that consequence when this deadline is at risk. In force to 2026-09-30. |
| `application_reply_affidavits` | −1 business day (clear) | `application_hearing_date` | Rule 8-1(13) | Applicant's deadline to file and serve any affidavits **responding to the application response** — Rule 8-1(13) sets an **express statutory deadline**: no later than 4 p.m. on the business day that is one full business day before the date set for the hearing (the same −1 full business day shape **and the same one-business-day count** as `application_record` and the Petitions section's `petition_record`, so compute it by that section's **Backward algorithm (latest permissible date)** paragraph, not by the N-business-day algorithm below, and read its **Unresolved construction (#748)** note with it). 8-1(14) ("No additional affidavits") bars affidavits beyond those served under (7), (9) and (13) absent consent or leave. Store only when our client is the applicant and an application response has been served. Repealed and replaced by B.C. Reg. 105/2026: from 2026-10-01 reply affidavits are **served** within 3 or 5 business days after service of the response (`application_reply_affidavits_service`, in [`application_service_date`](#anchor-type-application_service_date)) and **filed** under (14.6) (`application_reply_affidavits_filing`, below). In force to 2026-09-30. |
| `application_record` | −2 business days | `application_hearing_date` | Rule 8-1(15)(e)(i), (17) | As amended by B.C. Reg. 105/2026: applicant must provide the application record to the registry "no later than 4 p.m. on the business day that is 2 business days before the date set for the hearing", and no earlier than 9 a.m. on the business day that is 5 business days before. The application record index must be served on each application respondent by the same time (8-1(17)). Compute by the Petitions section's **Backward algorithm (latest permissible date)** at N = 2, and read its **New wording, open construction (2026-10-09)** note with it. Failure to provide it removes the application from the hearing list (8-1(15.2), unamended) — surface that consequence when this deadline is at risk. In force from 2026-10-01. |
| `application_reply_affidavits_filing` | −2 business days | `application_hearing_date` | Rule 8-1(14.6) | "The applicant must file the original of every reply affidavit served under subrule (13) no later than 4 p.m. on the business day that is 2 business days before the date set for the hearing." Compute by the Petitions section's **Backward algorithm (latest permissible date)** at N = 2, and read its **New wording, open construction (2026-10-09)** note with it. Store only when our client is the applicant and has served reply affidavits. Mandatory. In force from 2026-10-01. |
| `notice_of_hearing_service` | −4 business days (clear) | `application_hearing_date` | Rule 8-1(14.5)(a) | The notice of hearing of application (Form 33.01) must be filed, and a copy of the filed notice served on each application respondent, "subject to paragraph (b) of this subrule, at least 4 business days before the date set for the hearing of the application". Compute by the **Backward algorithm (N clear business days)** below at N = 4, which carries the #740 added day (the cautious side for our own filing). A Friday hearing returns a Sunday under that count: read the **Open conflict (#748)** note below, which says to surface it and treat the previous business day as the cautious filing date. Applications estimated at 2 hours or less. Mandatory, latest-permissible. In force from 2026-10-01. |
| `notice_of_hearing_service_long_hearing` | earlier of +7 days and −14 days (clear) | `application_hearing_fixed` / `application_hearing_date` | Rule 8-1(14.5)(b) | "if the application is estimated to take more than 2 hours, within 7 days after the registrar fixes the date and time of the hearing of the application and at least 14 days before the date set for the hearing of the application". Store a **single** row holding the earlier of `application_hearing_fixed` + 7 days and `application_hearing_date` − 14 clear days, and record which governed in `review_note` (same min() pattern as `expert_objection_notice`). **Calendar** days, closure-sensitive: the +7 limb is a deadline to act with the ordinary landing-day shift; the −14 limb is latest-permissible, so a `full_closure` landing shifts to the **previous** open day. Recalculate when either anchor changes. Mandatory. In force from 2026-10-01. |

- `notice_of_application_service` and `notice_of_application_service_summary_trial` are mutually exclusive, matching the standard/summary-trial split in `application_service_date`.
- From 2026-10-01, `notice_of_hearing_service` and `notice_of_hearing_service_long_hearing` are mutually exclusive, keyed on whether the application is estimated to take more than 2 hours.
- **The −14 clear-day limb (2026-10-09).** It is labelled "(clear)" and counted with the s.25.2(3) added day, so 14 days fall strictly between the deadline and the hearing ([reckoning.md](reckoning.md) § Clear-day / exclusive counting). The older calendar-day "at least … before" rows in this file (`trial_record`, `trial_certificate`, `cpc_notice_service`) carry no "(clear)" label; that inconsistency is recorded, not fixed here.
- `application_reply_affidavits` deliberately coincides with `application_record`'s date — they are distinct obligations (serving reply evidence on parties vs providing the record to the registry), kept as separate rows so the practitioner sees both, on the same both-rows-despite-same-date reasoning as `notice_of_application_service` vs `application_hearing_earliest` (resolved 2026-07-11).

**Backward algorithm (N clear business days).** Used by `notice_of_application_service` (to 2026-09-30) and `notice_of_hearing_service` (from 2026-10-01). This is a **separate method** from the one-business-day count that `petition_record`, `application_record` and `application_reply_affidavits` use (the **Backward algorithm (latest permissible date)** paragraph in the Petitions section, above), not a generalization of it: **at N = 1 the two land one day apart.** Starting the day before the hearing date, step backward one day at a time, counting only business days (skip weekends and `full_closure` days), until N business days have been counted. The calendar day immediately before the Nth counted business day is the latest permissible date. This mirrors the [forward algorithm](#business-day-counting) run in reverse, and is the exact inverse of `application_hearing_earliest`/`summary_trial_hearing_earliest`: a hearing date computed forward from a given service date, fed back through this algorithm, returns that same service date. **Worked example at N = 1:** a hearing on Friday 2026-07-31 gives **Wednesday 2026-07-29** under this count, against Thursday 2026-07-30 under the one-business-day count (both computed by `Engineering/3. Staging/check_748_backward.py`). No separate landing-day shift is needed at any N — the count only lands on business days by construction, same rationale as the forward algorithm.

**Open conflict, recorded not fixed (#748, 2026-09-21).** The last sentence above does not hold at N = 1: this count can return a Saturday, a Sunday or a `full_closure` day. A hearing on Tuesday 2026-07-28 returns **Sunday 2026-07-26**, and across the 261 weekdays of 2026 the N = 1 result is a non-business day on 52 of them (51 Sundays and the one closure the file names, BC Day Monday 2026-08-03) — all computed by `Engineering/3. Staging/check_748_backward.py`, which states no law. Whether a landing-day shift is owed here, and in which direction, was **not** asked of the `/legal-research` gate on this ticket and is **not** answered here; it is recorded for a follow-on research ticket, as of 2026-09-21; restated by remodel task 4a095a01 on 2026-10-01. The same conflict reaches `notice_of_hearing_service` at N = 4 (a Friday hearing returns Sunday); until it is resolved, surface it and treat the previous business day as the cautious filing date, as of 2026-10-09.

**Gating.** All of these deadlines require confirmed calendar coverage for every year the counting window touches, per [the coverage gate](#the-coverage-gate) and [Business-day counting](#business-day-counting)'s coverage-gate note — same as `application_service_date`. A `limited`/`regional_exception` day inside the window sets the `limited_day` flag for practitioner confirmation.

> **Verify (rows in force to 2026-09-30):** Confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11, with subrule corrections: service periods are **Rule 8-1(8)(a)/(b)** (not (7) — see the `application_service_date` Verify note), response periods are **Rule 8-1(9)**, and the application-record timing is **Rule 8-1(15)(e)(i)** (window: no earlier than 9 a.m. three full business days before, no later than 4 p.m. one full business day before the hearing).
>
> **Verify (reconfirmed against the enactment's own text, 2026-07-11; row in force to 2026-09-30):** Rule 8-1(13) **does** carry an express statutory deadline — "An applicant who wishes to respond to any document served under subrule (9) must file and serve on each application respondent any responding affidavits no later than 4 p.m. on the business day that is one full business day before the date set for the hearing" (bclaws consolidation current to 2026-07-07). The modelled −1 full business day date is therefore the actual statutory deadline, not merely a practical ceiling; the row's characterization was updated accordingly. 8-1(14) bars additional affidavits beyond those under (7)/(9)/(13) absent consent or leave, confirmed.


---

## Anchor Types: Discovery / Case Planning (`notice_to_admit_served`, `cpc_date`, `cpc_notice_served`, `case_plan_proposal_received`)

Interlocutory discovery and case-planning deadlines. The notice-to-admit and case-plan-proposal clocks run **forward** (calendar days) from a service or receipt event; the CPC notice-service dates run **backward** (calendar days) from the scheduled conference, like `trial_date`.

### `notice_to_admit_served` → response / deemed admission

The anchor is the date a notice to admit (Form 26) was served. **Direction matters** — the same 14-day clock is a hard obligation on the receiving party and a monitoring date for the serving party, so it is modelled as two deadline types (practitioner-confirmed 2026-07-11); store exactly one per notice, chosen by who served whom. Ask the practitioner which direction applies before storing; where several notices are in play, distinguish them with `party_label` (same pattern as [Multiple defendants](#multiple-defendants)).

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `notice_to_admit_response` | +14 days | `notice_to_admit_served` | Rule 7-7(2) | **Our client was served.** Deadline to serve a written response to the notice to admit. **Mandatory and unforgiving** — silence past the deadline deems the facts true and the documents authentic (Rule 7-7(2)), and a deemed admission can be withdrawn only by consent or with leave (Rule 7-7(5)). |
| `deemed_admission` | +14 days | `notice_to_admit_served` | Rule 7-7(2) | **We served the notice.** The date the opposing party's response period expires — if no written statement has been served by then, their deemed admissions crystallize. **Monitoring-only** — no act is required of our client; record that character in `rule_description` so downstream readers don't treat it as an obligation (same convention as the permissive pleadings deadlines). |

**Gating.** Both types are ordinary closure-sensitive calendar-day deadlines (coverage gate + shift rule + HTML grid), consistent with `reply` — the response is an act whose time limit is set by enactment, so the Interpretation Act s.25(3) landing-day shift applies. A shifted `notice_to_admit_response` implies the mirror-image `deemed_admission` on the other side shifts identically.

### `cpc_date` → notice service (backward-run)

The scheduled case planning conference date. The notice of CPC (Form 19) must be served **at least 35 days** before a **first** CPC in the action, but only **at least 7 days** before a **subsequent** one — a **mutually exclusive pair** keyed on first-vs-subsequent (practitioner-confirmed 2026-07-11, mirroring the standard/summary-trial pattern in [`application_service_date`](#anchor-type-application_service_date)): ask which applies at calculation time and store only one row. Both are "or any shorter period that the court may order", and the whole subrule yields to party agreement ("Unless the court otherwise orders or the parties of record otherwise agree") — a court-ordered or agreed shorter period overrides via [Order Terms](#order-terms).

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `cpc_notice_service` | −35 days | `cpc_date` | Rule 5-1(3)(a) | Latest permissible day to serve the notice of case planning conference for the **first** CPC in the action. **Mandatory** — late service invalidates the notice period, not an earliest-permissible marker. |
| `cpc_notice_service_subsequent` | −7 days | `cpc_date` | Rule 5-1(3)(b) | Same, for any CPC **after the first** in the action. |

**Gating.** Calendar-day counted, closure-sensitive. These are **latest-permissible** dates, so the `full_closure` shift direction inverts — shift to the **previous** open day, like `summary_trial_hearing_latest` (see [The shift rule](#the-shift-rule)). `limited`/`regional_exception` landings flag `limited_day` as usual.

### `cpc_notice_served` / `case_plan_proposal_received` → case plan proposals (forward-run)

Both sides must file and serve case plan proposals (Form 20) on 14-day clocks before the first CPC (Rule 5-1(5)), but the two clocks run from **different events**: the requesting party's runs from its own service of the notice of CPC (`cpc_notice_served`); each other party's runs from **receipt of the requesting party's filed proposal** — a distinct real-world event, stored as its own anchor `case_plan_proposal_received` when the practitioner reports it. Whichever row binds **our client** is mandatory; the opposing side's row may be stored as monitoring-only (record that in `rule_description`), same direction convention as the notice-to-admit pair above.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `case_plan_proposal_requesting` | +14 days | `cpc_notice_served` | Rule 5-1(5)(a) | The party who requested the CPC must file its case plan proposal and serve it on all other parties of record within 14 days after serving the notice of CPC. |
| `case_plan_proposal_other_parties` | +14 days | `case_plan_proposal_received` | Rule 5-1(5)(b) | Each other party of record must file and serve its own case plan proposal within 14 days after **receipt of the requesting party's case plan proposal**. No date can be calculated until that receipt is reported — the notice of CPC alone does not start this clock. Rule 5-1(5)'s chapeau also requires all proposals to be filed **before the first CPC** — surface that ceiling if the computed date lands on or after `cpc_date`. |

**Gating.** Both are ordinary closure-sensitive calendar-day deadlines (registry filing acts) — coverage gate, shift rule, and HTML grid all apply.

> **Verify:** Confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11: Rule 7-7(2) (14-day response / deemed admission on silence), Rule 7-7(5) (withdrawal only by consent or leave), Rule 5-1(3)(a)/(b) (35/7-day notice periods), and Rule 5-1(5)(a)/(b) (14-day proposal clocks). The previously flagged base-event question for `case_plan_proposal_other_parties` is **resolved by the primary text**: Rule 5-1(5)(b) reads "within 14 days after receipt of the case plan proposal referred to in paragraph (a)" — the receipt-based reading, not the notice-based reading modelled before 2026-07-11; the row was rebased accordingly.


---

## Anchor Type: `mediator_appointment_date`

The mediation-session deadline under the Notice to Mediate (General) Regulation, BC Reg 4/2001, s. 24 (made under the Law and Equity Act). The 60-day clock runs from the **appointment of the mediator** — **not** from delivery of the Notice to Mediate. These are distinct dated events: participants must jointly appoint a mediator within 14 days after the Notice is served (21 days if 5 or more parties) (s. 6); failing that, a roster organization selects one, and the appointment date is fixed as the date that selection notice is sent (ss. 8–10). The appointment therefore lands materially later than — and separately from — service. Store the **mediator's appointment date** as the anchor once known.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `mediation_session` | +60 days | `mediator_appointment_date` | BC Reg 4/2001 s. 24 | A mediation session must occur within 60 days after the mediator's appointment, subject to the trial − 7 ceiling below |

**Ceiling composition (trial − 7 days).** Section 24 also caps the session at "not later than 7 days before the date of trial." The effective `mediation_session` deadline is the **earlier** of:

- `mediator_appointment_date` + 60 days, and
- `trial_date` − 7 days (only when a `trial_date` anchor exists for the matter).

Store a **single** `mediation_session` deadline row holding that earlier date. Record both candidate dates and which constraint governed in `review_note`; leave `review_flag` NULL — the choice is resolved, not provisional. When no `trial_date` anchor exists, only the +60 constraint applies. The ceiling has two statutory escape hatches: a later date governs if (a) all participants agree **and** the mediator confirms that agreement in writing, or (b) the court orders it — treat a practitioner-confirmed agreed/ordered date as authoritative over the calculated ceiling (same override pattern as [Order Terms](#order-terms)).

**Cross-anchor cascade.** `mediation_session` depends on **two** anchors — its own (`mediator_appointment_date`) and, via the ceiling, `trial_date`. Recalculate it whenever *either* changes, re-running the full min() (a trial adjournment can flip governance from the ceiling back to the +60 offset, or vice versa). The default single-anchor cascade won't surface it on a `trial_date` change — see the docket-clerk agent's "Cascade recalculation" note.

**Gating:** exempt — `mediation_session` takes **no** coverage gate, **no** closure-day shift, and **no** HTML grid. A mediation session is a private meeting among the participants and a mediator, not a court-registry filing act, so the Court Calendar's closure categories don't govern whether it can be held, and BC Reg 4/2001 contains no next-open-day provision. It is calculated by plain date addition, like the `limitation_expiry` family. (Note for a future editor: the trial − 7 ceiling is a *latest-permissible* bound — if closure shifting were ever added here, it would shift **earlier**, like `summary_trial_hearing_latest`, never to the next open day.)

> **Verify:** Section 24's operative text ("within 60 days after the appointment of the mediator but not later than 7 days before the date of trial") and the appointment mechanics (ss. 6–10) were confirmed against the official BC Laws consolidation (bclaws.gov.bc.ca) on 2026-07-09. Reconfirm the section numbers against the current consolidation before relying on them. **On the holiday-landing question (primary text read 2026-07-11):** SCCR Rule 22-4 does not apply (it governs only the Civil Rules' own periods), but the Interpretation Act does apply to BC Reg 4/2001 as an enactment — on its face, s.25(3)(a) extends a period ending on a "holiday" (s.29: Sundays and statutory holidays, **not** Saturdays) to the next non-holiday, and the trial − 7 ceiling, as an "at least … before" bound, would move **earlier** under s.25(3)(b). This section still stores the raw date per the map's ruling — a mediation session isn't a registry act and the parties control its scheduling — but when a computed `mediation_session` lands on a holiday, surface the possible s.25(3) extension to the practitioner rather than asserting either reading.


---

## Anchor Types: Amendment of Pleadings (`amended_pleading_filed`, `amended_pleading_served`)

Rule 6-1 splits into a **permission gate** (when amendment without leave is still available) and two **real countdowns** that run once an amendment is actually made. Per the default-judgment precedent (the docket-clerk agent's Anti-Patterns), this skill stores only the countdowns — the gate is never stored as a deadline or status row.

**The permission gate (not stored).** A party may amend a pleading once **without leave** at any time **before service of the notice of trial** (Rule 6-1(1)(a)); after the notice of trial is served, amendment needs leave of the court or the written consent of the parties (6-1(1)(b)). (The pre-2019 rule closed the gate at the *earlier of* notice-of-trial service and the first case planning conference; B.C. Reg. 104/2019 removed the CPC branch, so the gate now turns on notice-of-trial service alone.) Whether the gate is open is a read-time computation for the consumer — it turns on whether a notice of trial has been served, a registry fact evaluated against the `notice_of_trial_served` anchor *when it is stored*, not a date this skill can calculate in advance. `notice_of_trial_served` may be stored as a **fact-only anchor** (no derived deadline rows of its own in this section) so the gate has something to be read against; do not emit an "amendment needs leave" boolean or marker row (same reasoning as `default_judgment_eligible` — see the docket-clerk agent's Anti-Patterns).

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `amended_pleading_service` | +7 days | `amended_pleading_filed` | Rule 6-1(4)(a) | The amending party must serve a copy of the filed amended pleading on all parties of record within 7 days after filing. (An amended *originating* pleading must additionally be served personally, "promptly", on served non-responding persons — 6-1(4)(b), no fixed countdown.) **Direction matters:** mandatory when **our client** filed the amendment; when the opposing party filed, store as **monitoring-only** in `rule_description` (same convention as `deemed_admission`). |
| `response_to_amended_pleading` | +14 days | `amended_pleading_served` | Rule 6-1(5)(b) | A party served with an amended pleading may amend its responding pleading (only with respect to matters raised by the amendments) and must serve the amended responding pleading within 14 days after being served. **Direction matters:** mandatory when **our client** was served; monitoring-only when we served our amendment on them. If no amended responding pleading is served in time, the original responding pleading is **deemed** to respond to the amended pleading and new facts are deemed outside the responding party's knowledge (6-1(6)) — surface that deemed effect when the monitoring date passes (same character as `deemed_admission`). |

Where several parties' amendments are in play, distinguish them with `party_label` (same pattern as [Multiple defendants](#multiple-defendants)).

**Gating.** Both are ordinary closure-sensitive calendar-day deadlines (registry filing / service acts) — coverage gate, shift rule, and HTML grid all apply.

> **Verify:** Confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11: the countdowns sit in Rule 6-1(4)(a) (+7 days service) and 6-1(5)(b) (+14 days response), with the deemed-response default in 6-1(6). One stale-law correction: the commentary's "earlier of notice-of-trial service and first CPC" gate formulation was pre-2019 law — the current 6-1(1) (as amended by B.C. Reg. 104/2019) keys the once-without-leave gate on notice-of-trial service alone.


---

## Anchor Type: `offer_to_settle_served` (fact-only)

A Rule 9-1 offer to settle carries **no date arithmetic**: there is no fixed countdown to accept, and the costs consequences (Rule 9-1(4)–(6)) attach only when the court exercises its discretion **after judgment** — the offer may not be brought to the court's attention until judgment on all other issues has been pronounced. Store the service of an offer as an **anchor fact with zero derived deadline rows** (resolved 2026-07-11):

- Record `offer_to_settle_served` with the service date, **direction** (our client's offer vs one received) noted in the source record, and `party_label` where several parties or offers are in play — the fact and its date are what the costs stage needs later.
- Derive **nothing** from it. Reminding the practitioner that a live offer exists as judgment approaches is surfacing/urgency work, which belongs to `executive-assistant`, not this skill.

**Gating:** not applicable — no deadline rows exist to gate or shift.

> **Verify:** Confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11: the reserved-right sentence is Rule 9-1(1)(c)(iii); non-disclosure until all issues other than costs are determined is 9-1(2); the court's costs discretion and options are 9-1(4)–(6) (options in (5)); and a counter offer does not expire the offer (9-1(8)). No fixed acceptance countdown exists — the fact-only model stands.


---

## Anchor Types: Costs Assessment (`order_pronounced`, `assessment_hearing_date`, `assessment_certificate_date`)

Rule 14-1 costs assessment has **no deadline running from the order** — an appointment to assess costs may be taken out any time after the order providing for costs is entered, so `order_pronounced` is stored as a **fact-only anchor** (no derived countdown; resolved 2026-07-11). The pre-hearing dates run **backward** from the scheduled assessment appointment before the registrar, mirroring the [`application_hearing_date`](#anchor-type-application_hearing_date) pattern; one **forward** date follows the assessment itself — the review window, below.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `assessment_appointment_service` | −5 days (holidays not counted) | `assessment_hearing_date` | Rule 14-1(21)(c) | Latest permissible day to serve the filed appointment (Form 49, bill of costs attached) and any supporting affidavits on the other party — "at least 5 days before" the date scheduled for the assessment. Because the period is under 7 days, **holidays are not counted** (Rule 22-4(1); "holiday" per Interpretation Act s.29 includes Sundays and statutory holidays but **not** Saturdays) — step backward counting only non-holiday days, clear-days exclusive (s.25.2(2)(b)/(3)(b)). **Mandatory, latest-permissible** — a `full_closure` landing shifts to the **previous** open day (see [The shift rule](#the-shift-rule)). |
| `assessment_hearing_record` | −1 business day (clear) | `assessment_hearing_date` | Registrar-hearing practice (bccourts.ca costs package; no Civil Rules subrule identified) | The party who filed the appointment must provide the registry a hearing record by 4pm one full business day before the hearing — same shape and same one-business-day count as `application_record`/`petition_record`, so compute it by the Petitions section's **Backward algorithm (latest permissible date)** paragraph, not by the N-business-day algorithm in [`application_hearing_date`](#anchor-type-application_hearing_date). Its source is registrar practice with **no Civil Rules subrule**, so the #748 research answer — which construes only the Rules' "one full business day" wording — does not reach this row; that row's **Unresolved construction (#748)** note is carried here as a practical caution on a one-day margin, not as law about this deadline, as of 2026-09-21; restated by remodel task 4a095a01 on 2026-10-01. |

**Gating.** `assessment_appointment_service` is a closure-sensitive latest-permissible date counted in **non-holiday days** per Rule 22-4(1) (see the row description; `full_closure` landing shifts to the **previous** open day; `limited`/`regional_exception` flags `limited_day`). `assessment_hearing_record` uses backward **business-day** counting with the standard coverage gate. Both need confirmed coverage for the years their (short) windows touch.

> **Verify:** Confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11: the ≥5-day appointment-service requirement is Rule 14-1(21)(c) (Form 49, bill of costs attached per 14-1(21)(b)(iii)). The counting question is resolved by **Rule 22-4(1)**: a period under 7 days set out in the Rules does not count holidays. Rule 14-1 contains no hearing-record subrule — `assessment_hearing_record`'s registrar-practice sourcing stands (reconfirm against the current bccourts.ca costs package when relying on it).

### `assessment_certificate_date` → review of the assessment

The registrar's decision on an assessment is reviewable by the court, and the review clock is the one **forward-running** date in this family (resolved 2026-07-11: an appeal-like, rights-forfeiting deadline, same character as `notice_of_appeal`). Record `assessment_certificate_date` — the date the registrar **certifies the costs** (by endorsing the original bill or issuing a certificate of costs in Form 64, Rule 14-1(27)) — as an anchor when the practitioner reports a contested assessment outcome. The trigger is the certification act, not the later filing of the certificate by the party.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `assessment_review` | +14 days | `assessment_certificate_date` | Rule 14-1(29) | Last day to apply to the court for a review of the registrar's decision on the assessment. **Mandatory and rights-forfeiting** — an unexercised review window forfeits the challenge. |

**Gating.** An ordinary closure-sensitive forward calendar-day deadline — coverage gate, shift rule, and HTML grid all apply (applying for a review is a court-registry filing act). At 14 days the period is not under 7 days, so ordinary calendar counting applies — Rule 22-4(1)'s holidays-not-counted model does **not** apply here (contrast `assessment_appointment_service` above).

> **Verify (reconfirmed against the enactment's own text, 2026-07-11):** Rule 14-1(29) confirmed against the bclaws consolidation (current to 2026-07-07): "A party who is dissatisfied with a decision of a registrar on an assessment of costs may, within 14 days after the registrar has certified the costs, apply to the court for a review of the assessment." The 14-day count is confirmed; the triggering event is **the registrar certifying the costs** — under 14-1(27) done "by endorsing the original bill or by issuing a certificate of costs in Form 64." So the `assessment_certificate_date` anchor is correct, keyed on the certification act (bill endorsed or Form 64 issued), not the later filing of the certificate by the party.


---

## Modifier: Fast-Track Action (Rule 15-1, `fast_track_notice_filed`)

Fast track is **not an anchor family and not an offset modifier** (resolved 2026-07-11, correcting the #7 catalog's premise): Rule 15-1 changes **none of the date offsets modelled elsewhere in this file** — expert-report timing (Rule 11-6) and the TMC/trial-brief regime (Rule 12-2/12-1.1) apply in a fast-track action exactly as in an ordinary one — and adds exactly **one** track-specific countdown, modelled below. Its other effects are **constraints, not countdowns**:

- **Application gate (Rule 15-1(7)–(9)):** a party must not serve a notice of application or supporting affidavit unless a CPC or TMC has been conducted — a permission gate evaluated at read time, never stored as a deadline (same treatment as the Rule 6-1 amendment gate above); exceptions in 15-1(8), court relief in 15-1(9).
- Examination for discovery capped at **2 hours** (15-1(11)); **fixed costs** (15-1(15): $8,000 / $9,500 / $11,000 by trial length). (A former **one-expert limit** on damages — 15-1(12.1), enacted alongside Rule 11-8 by B.C. Reg. 18/2019 — was repealed by B.C. Reg. 207/2020, in force **2020-08-10**, after Rule 11-8 was held ultra vires in *Crowder v. British Columbia (Attorney General)*, 2019 BCSC 1824. **No expert limit survives** in the current rule.)
- Trial scheduling is registrar-driven: if a trial date is applied for within 4 months of the action entering fast track, the registrar must set trial within 4 months of the application (15-1(13)) — court-driven, no stored countdown.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `fast_track_discoveries_complete` | −14 days | `trial_date` | Rule 15-1(12) | All examinations for discovery in a fast track action must be **completed** at least 14 days before the scheduled trial date ("unless the court otherwise orders or the parties to the examination consent"). Store only when `fast_track_notice_filed` is present and a `trial_date` anchor exists. In force unamended since 2010-07-01. |

**Gating:** exempt — like `mediation_session`, an examination for discovery is a private examination, not a court-registry filing act, so no coverage gate, closure shift, or HTML grid applies; pure calendar arithmetic. It is a *latest-permissible* bound — if closure shifting were ever added, it would shift **earlier**, never to the next open day.

Record `fast_track_notice_filed` (Form 61 — notice of fast track action) as an anchor when a matter enters the fast track, deriving nothing from it directly — the one track-specific countdown above is keyed on this anchor's **presence** but derived from `trial_date`, exactly the mechanism this section reserves for track-dependent rules.

> **Verify:** Confirmed against the bclaws.gov.bc.ca current consolidation on 2026-07-11: the application gate (15-1(7)–(9)), the 2-hour discovery cap (15-1(11)), the discovery-completion deadline (15-1(12)), the fixed-costs tiers (15-1(15)), and the absence of any 15-1 change to the Rule 11-6/12-2/12-1.1 offsets. Amendment history (Courthouse Libraries tracker + BC Gazette): 15-1(12) is original 2010 text, never amended; the only 15-1 date-related change ever was the 15-1(12.1) expert limit's enactment (B.C. Reg. 18/2019, deposited 2019-02-11) and repeal (B.C. Reg. 207/2020, 2020-08-10).

---

## Order Terms

When a court order contains deadline terms (e.g., a Trial Management Conference Order specifying "witness lists due 14 days before trial"), those terms override the rule defaults above.

Store each order term as a separate `deadlines` row:
- `source_type = 'order_term'`
- `rule_ref` = paragraph or term number in the order
- `rule_description` = the term as written
- `source_document` = order name and date (e.g., "TMC Order 2025-11-14")

If an order term conflicts with a rule default for the same deadline type, the order term governs. Mark the rule-default row `status='superseded'`.


---

## Registry Machinery

The court-registry closure machinery — coverage gate, shift rule, business-day counting, sub-7-day counting, and caveat flags — is BC Supreme Court–specific: it depends on the ingested BC Supreme Court Court Calendar. Only a court-registry filing deadline (BCSC, or an arbitration set-aside that files in the BCSC registry) pulls it in. The Interpretation Act primitives it builds on (the weekend/holiday landing shift and clear-day counting) live in [reckoning.md](reckoning.md).

### Working Day vs Calendar Day

The BC Supreme Court Civil Rules use two day-counting models: **calendar days** (the default, for most pre-trial deadlines) and **business days** (for the application and petition periods — see [Business-day counting](#business-day-counting) below). Under the **calendar-day** model, where a deadline's **final day** falls on a Saturday, Sunday, or a court closure day, it shifts to the **next open day** (Interpretation Act (RSBC 1996, c 238) s.25(3)/s.25.5(1), with "holiday" defined in s.29 — the Rules themselves contain no landing-day shift provision; their Time rule is **Rule 22-4**, not 22-3). This applies to every calendar-day BCSC date above **and to limitation-period expiries** — a limitation deadline that expires on a day the registry is closed is extended to the next open day, so limitations are *not* exempt from the shift.

**Short periods (under 7 days).** Rule 22-4(1): if a period of less than 7 days is set out by the Rules or an order, **holidays are not counted**. "Holiday" (Interpretation Act s.29) includes Sundays and statutory holidays but **not** Saturdays, so this is a third counting model — stricter than raw calendar days, looser than business days. Currently it governs only [`assessment_appointment_service`](#anchor-types-costs-assessment-order_pronounced-assessment_hearing_date-assessment_certificate_date) (5 days) among modelled rows; apply it to any future sub-7-day rule.

Closure and limited-court-open days come from the ingested BC Supreme Court Court Calendar (see the docket-clerk agent's "Ingest BC Supreme Court Court Calendar" workflow), not a hardcoded list — the calendar's own closure categories vary year to year and go beyond the fixed statutory holiday set.

The gate, shift, and flag logic below is the rule of record for **what** the answer is; the docket-clerk agent's "Derive deadlines" workflow is the procedure for producing it.

### Business-day counting

A minority of rules count **business days**, not calendar days — the Rule 8-1 application periods in the [`application_service_date`](#anchor-type-application_service_date) and [`application_hearing_date`](#anchor-type-application_hearing_date) families (to 2026-09-30 the 8-1(8) service periods; from 2026-10-01 the (9) period for an ordinary application (the Rule 9-7 limb is 21 calendar days), the (13) periods, the (14.5)(a) notice of hearing and the (14.6) and (15)(e)(i) filing times) and the petition record. A **business day** is a weekday on which the court registries are open for business: not a Saturday, a Sunday, or a `full_closure` day in the ingested Court Calendar. Unlike the calendar-day model (which counts raw days and shifts only the landing day), business-day counting classifies **every** intervening day, so it inherently skips weekends and closures as it counts.

**Clear-days counting.** Rule 8-1(8) (to 2026-09-30) and Rule 8-1(14.5)(a) (from 2026-10-01) are phrased "at least N business days before the date set for the hearing". Under the Interpretation Act (RSBC 1996, c 238) s.25.2(3), an "at least … days before" period is counted **exclusively** — both the start day (service) and the end day (hearing) are excluded, so N business days must fall *strictly between* them. (Section numbers confirmed against the current consolidation 2026-07-11: the base counting rule is s.25.2(2), and s.25.2(3) adds the one-day extension for "clear"/"at least"/"not less than" periods.) **That s.25.2 reaches a period expressed in *business* days is an assumption, not a verified construction — see [reckoning.md](reckoning.md) § Clear-day / exclusive counting, "Assumption, not verified construction (#740)". The response pair, `application_response` and `summary_trial_response`, is a forward deadline *to act*, where an added day would shorten the party's own time. It is phrased "within … after" and carries no added day (#747). No row in this file adds the s.25.2(3) day to a forward deadline to act.**

**Forward algorithm (earliest permissible date).** Starting the day **after** the service date, count forward, incrementing only on business days (skip weekends and `full_closure` days). The earliest permissible hearing date is the **first business day after** the Nth counted business day. No separate landing-day shift is needed — because the count only lands on business days, the result is already an open day.

**Forward algorithm (deadline to act).** For the "within N business days after" response rows, count the same way. The deadline is the **Nth counted business day** itself, with no day added after it.

**Coverage gate.** Business-day counting requires confirmed calendar coverage for **every year the counting window touches** — the same gate as the calendar-day model (`court-calendar-coverage` / `court-calendar-days`). If any touched year is unconfirmed and cannot be ingested, fall back to a raw weekday-only count (Saturdays/Sundays excluded, closures not yet known), store it, and flag `shift_pending` per [Caveat flags](#caveat-flags-on-the-deadline-row). A `limited` or `regional_exception` day inside the window counts as a business day but sets the `limited_day` flag for practitioner confirmation, consistent with the shift-rule philosophy. **No new ``practice-data`` operations or schema fields are required** — `review_flag`/`review_note` already carry the provisional semantics.

**Worked example (golden case, rows in force to 2026-09-30).** A Rule 9-7 summary trial application served Tuesday 2026-07-14 needs 12 clear business days before the hearing. Excluding the service day, the business days are Jul 15–17 (3), Jul 20–24 (8), Jul 27–30 (12); no BC holiday falls in the window (BC Day is Mon Aug 3). The 12th clear business day is Thu Jul 30, so the earliest permissible hearing date is the next business day, **Fri 2026-07-31**. For the regime in force from 2026-10-01, see the [Set-down (from 2026-10-01)](#set-down-from-2026-10-01) worked example.

### The coverage gate

**Never apply a closure shift against a year whose calendar has not been confirmed.** Applied per deadline, keyed on the year `Y` its calculated date lands in (and the adjacent year `Y+1` when a shift could walk a late-December date across the boundary):

- **`Y` beyond the horizon** (horizon = current calendar year + 1, the window BC reliably publishes): store the raw arithmetic date with **no shift**, flag `shift_pending`. Do not attempt a fetch — that calendar cannot exist yet. This is where the long-duration `limitation_expiry` family (`basic_limitation` +2y, `ultimate_limitation` +15y) normally lands: the raw addition is stored and flagged provisional, never silently treated as final.
- **`Y` within the horizon**: confirm coverage via ``practice-data`` `court-calendar-coverage`.
  - `confirmed` → apply the shift rule below.
  - not confirmed → the ingest workflow fetches `CourtCalendar{Y}.pdf`. A **404** (provably not published) → store the raw date + `shift_pending`. A **successful** fetch → complete the HITL ingest review, then apply the shift. Any other fetch failure → stop and ask the practitioner for a copy.

Every anchor family runs this same gate — a near-term `basic_limitation` landing in a covered year shifts off a closure exactly like a trial-adjacent deadline. The only difference between families is *where* their dates land, not a special exemption.

### The shift rule

Query ``practice-data`` `court-calendar-days` for the deadline's month(s). For the landing day:

- **`full_closure`** → auto-shift to the next open day (skipping weekends and further closures). Record the raw→final change in `review_note`; leave `review_flag` NULL — the shift is resolved, not provisional.
- **`limited` or `regional_exception`** → do **not** shift. Store the calculated date, flag `limited_day`, because no public source resolves whether limited court operation legally shifts a filing deadline (regional exceptions affect only named courthouses — surface for the practitioner to judge relevance rather than asserting).
- **ordinary open day** (including after a resolved shift) → NULL `review_flag`.

**Latest-permissible-date rules** (e.g. `summary_trial_hearing_latest`, Rule 9-7(3)) invert the `full_closure` direction: because shifting *later* would push the date past the legal limit, a closure landing day shifts to the **previous** open day instead. A `limited`/`regional_exception` landing is flagged `limited_day` and surfaced for the practitioner, as above.

### Caveat flags on the deadline row

`upsert-deadline` carries `review_flag ∈ {shift_pending, limited_day}` (NULL = clean) and `review_note` (the human-readable reason). A non-null flag means the stored date is **provisional** — downstream readers (`executive-assistant`, query-deadlines) must surface it, never treat it as hard. When a `shift_pending` year is later ingested, the deadline's cascade recalculation resolves the shift and clears the flag.

### The one true exemption: `appeal_date`

The `appeal_date` family is the sole exemption from the coverage gate *among court-registry filing deadlines* — not because its dates are far off, but because **the Court of Appeal publishes no calendar at all** (no Reading Break / Winter Break / Limited-Court-Open concept exists to gate against; confirmed by the Court-of-Appeal-calendar research). `appeal_date` deadlines shift only under the plain s.29 / Court of Appeal Rules r. 2 statutory-holiday rule. See the `appeal_date` section's Gating note in `bcca-rules.md`.

(`mediation_session`, `nocc_service_expiry`, and `fast_track_discoveries_complete` are also un-gated and un-shifted, but for a distinct reason — none is a court-registry filing act (a private mediation session; a 12-month in-force/renewal window; private examinations for discovery), so registry-closure rules never bear on them; all are pure calendar arithmetic. See their sections above.)

When in doubt about whether a specific day qualifies, surface it to the practitioner.
