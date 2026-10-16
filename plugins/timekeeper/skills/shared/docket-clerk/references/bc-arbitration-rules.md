---
page_url: https://vaniac.org/arbitration/rules-of-procedure/domestic-arbitration-rules/
pdf_url: https://vaniac.org/wp-content/uploads/2020/09/VanIACDomesticRulesEffectiveSeptember12020.pdf
pdf_sha256: 855d23a2a57c299f1466fea2e8f7b038523b7027f142b58364509c4494e561df
accessed: 2026-08-15
checked: 2026-09-25
currency_marker_pattern: 'Domestic Arbitration Rules \(as amended ([A-Z][a-z]+ \d{1,2}, \d{4})\)'
currency_marker: September 1, 2020
fetch_note: vaniac.org answers 403 to a non-browser User-Agent; fetch with a browser User-Agent.
items:
  - rule_ref: R. 7(a)
    passage: Unless Rule 24(e) of the Expedited Procedures applies, a Notice of Counterclaim shall be delivered to the Centre and the required fee paid as set out in the Fee Schedule for Domestic Arbitration within 21 days of the commencement of the arbitration.
  - rule_ref: R. 24(e)
    passage: A Notice of Counterclaim delivered in response to a Notice of Arbitration that meets the requirement of Rule 24(a)(ii) shall be delivered within 10 days of commencement of the arbitration with the required fee set out in the Fee Schedule for Domestic Arbitration.
  - rule_ref: R. 31(c)
    passage: An appeal shall be brought by delivering a Notice of Appeal to the Centre and the other parties within 21 days of the date of any final or partial final Award along with the required appeal commencement fee as set out in the Fee Schedule for Domestic Arbitration.
  - rule_ref: R. 25(b)(iv)
    passage: all written material shall be exchanged by no later than 90 days from the appointment of the Arbitral Tribunal.
  - rule_ref: R. 25(c)
    passage: Any party may apply for an oral hearing within 5 days following delivery of all written material.
  - rule_ref: R. 26(a)(i)
    passage: the Arbitral Tribunal shall issue an award within 30 days of the last written material received by the Arbitral Tribunal where no oral hearing has been ordered; and
---

# BC Domestic Arbitration Deadline Rules

**Jurisdiction:** British Columbia only
**Sources:** Arbitration Act (SBC 2020, c 2); VanIAC Domestic Arbitration Rules (as amended **Sept. 1, 2020**); Interpretation Act (RSBC 1996, c 238) ss. 25, 25.2, 29
**Last verified:** 2026-07-11 — Act against the bclaws.gov.bc.ca current consolidation (current to 2026-07-07, [#62](https://github.com/Mharbulous/CoClerk/issues/62)); VanIAC Rules fetched live from vaniac.org ([#64](https://github.com/Mharbulous/CoClerk/issues/64))

This file governs a **single arbitration proceeding**. The BCSC Civil Rules, the VanIAC Domestic Arbitration Rules, and the BC Court of Appeal Rules are mutually exclusive rule sets — a matter may run an arbitration and a court action concurrently, each scoped to its own proceeding. Load this file (plus [`reckoning.md`](reckoning.md)) only for an arbitration anchor type; the award-recourse rows that *end* in a court filing cross-load the court files named per row.

The VanIAC Domestic Arbitration Rules are treated as a **first-class stored rule set**, not a per-matter override (practitioner direction, 2026-07-11 — see the [#62 amendment](https://github.com/Mharbulous/CoClerk/issues/62#issuecomment-4949914504)): in practice no one modifies them and they apply in almost every BC domestic arbitration. Version-stamp every VanIAC-sourced row "VanIAC Domestic Rules, Sept. 1, 2020" in `rule_description`.

---

## Reckoning for this proceeding — the party/tribunal-delivery class

Every deadline in this file is a **party or tribunal delivery** act — a document delivered to the tribunal, the Centre, or another party — **not** a court-registry filing. The two exceptions are the award-recourse deadlines that end in a court filing: the set-aside application (BCSC) and leave to appeal (Court of Appeal), each of which pulls in its destination court's gating (below).

For the delivery-class rows, reckoning uses **only** the Interpretation Act primitives in [`reckoning.md`](reckoning.md):

- Calendar-day counting (the Act is an enactment; Interpretation Act ss. 25, 25.2 govern its periods).
- **No court-registry closure machinery** — no coverage gate, no ingested Court Calendar, no business-day counting, no HTML grid. The Court Calendar's closure categories (Reading Break, Winter Break, Conference, regional exceptions) never move an arbitration delivery date, because no registry is involved.
- **Saturdays do not extend** a period (Interpretation Act s.29 defines "holiday" as Sundays and statutory holidays, not Saturdays).
- A **holiday landing** (Sunday or s.29 statutory holiday) is **surfaced** to the practitioner as a possible s.25(3)(a) extension rather than asserted — the [`mediation_session`](bcsc-rules.md#anchor-type-mediator_appointment_date) precedent, and doubly apt here since s.64 delivery can occur electronically on any day.
- **SCCR Rule 22-4 does not apply** — these are not Civil Rules periods, so the sub-7-day holidays-not-counted model is never used, even for the short VanIAC periods.

The VanIAC Rules reach the same reckoning independently: Rule 3(a) rolls a Saturday/Sunday/holiday landing to the next non-such day; Rule 3(b) excludes the first day and includes the last; Rule 1(b)(iii) imports the Interpretation Act meaning of "holiday." (A secondary web source claims VanIAC "day" means a business day excluding weekends/holidays from the *interval* — that is an **older/shorter** ruleset; the current Sept. 1, 2020 Rules count **calendar** days and roll only the landing day. Count calendar days.)

---

## Regime: Standard vs Expedited (VanIAC Part B)

VanIAC arbitrations run under one of two regimes, and the regime changes some offsets and adds Expedited-only deadlines — a **regime switch** analogous to the BCSC TMC-based vs no-TMC trial-brief regimes ([#22](https://github.com/Mharbulous/CoClerk/issues/22)).

**Expedited Procedures (Part B) apply automatically** where no claim or counterclaim exceeds **$250,000** (excluding interest and costs) — Rule 24(a)(ii) — **or** the parties agree (24(a)(i)). They are **disapplied** by a multi-arbitrator agreement, an opt-out, or a Centre unsuitability determination (24(c)).

**Determine the regime once per proceeding**, before calculating any regime-sensitive deadline, and record the answer and its basis (claim amount / agreement / disapplication) in the `rule_description` of every regime-sensitive row. Reuse that determination for all such rows rather than re-asking. The regime gates both the counterclaim offset (below) and the Expedited-only material-exchange backstop (below).

**Regime flip.** If a subsequently filed claim or counterclaim exceeds $250,000, the proceeding flips from Expedited to Standard. When that happens, **recalculate every regime-sensitive deadline** under the new regime via the standard cascade — `upsert-deadline` supersedes the old row and inserts the new one. (No `review_flag` is used for this: the flip is a real recalculation, not a provisional-date caveat; the audit trail lives in the superseded row and the new `rule_description`.)

---

## Cluster 1 — Award recourse (anchor `arbitral_award_received`)

**Anchor: `arbitral_award_received`** — the date **our client** received the award. Section 60(1) keys every recourse window on the *applicant's own* receipt. Record a **fresh anchor** for each subsequently received correction, interpretation, or additional award — s. 60(1) runs a fresh 30 days for recourse *based on* that instrument.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `award_set_aside_application` | +30 days | `arbitral_award_received` | Arbitration Act ss. 58, 60(1) | Last day to apply to the **BCSC** to set aside the award. **Mandatory, rights-forfeiting.** Court-registry filing → closure-sensitive (see Gating). Commenced by petition (⚠ verify commencing form, SCCR R. 2-1(2)); once filed, the [Petitions machinery](bcsc-rules.md#anchor-types-petitions-petition_served-petition_hearing_date-petition_expert_report_served) in `bcsc-rules.md` governs downstream — this row owns only the *entry* deadline. |
| `award_leave_to_appeal` | +30 days | `arbitral_award_received` | Arbitration Act ss. 59(3), 60(1) | Last day to apply to the **Court of Appeal** for leave to appeal the award (or, on consent, s. 59(2)(a)). **Mandatory, rights-forfeiting.** `appeal_date` class → no coverage gate, plain s.29 holiday shift (see Gating). s. 60's 30 days is the governing entry window; CoA Rules r. 6(2)'s own 30-day rule yields where "an enactment otherwise provides" (⚠ verify that interplay). Downstream, the [`appeal_date`](bcca-rules.md) family and CoA Rules govern. |
| `award_correction_request` | +30 days | `arbitral_award_received` | Arbitration Act s. 56(1) | Last day to request the tribunal correct or interpret the award. **Permissive** (the window forfeits, the request need not be made); **delivery to the tribunal**. **Agreement-variable** — s. 56(1) applies "unless another period of time has been agreed"; ask whether the arbitration agreement changes it. (Adopting the VanIAC Rules is **not** such an agreement — Rule 32(e) preserves the s. 56 remedies and sets no substitute period, so the Act default survives under VanIAC.) |
| `award_additional_award_request` | +30 days | `arbitral_award_received` | Arbitration Act s. 56(4) | Last day to request an **additional award** on a claim presented but omitted from the award. Permissive; delivery to the tribunal. |

- **Set-aside and leave are separate rows despite the same date** — different courts, different reckoning classes (the same both-rows-despite-same-date reasoning as `application_reply_affidavits` vs `application_record` in `bcsc-rules.md`).
- **Deemed receipt can set the anchor (s. 64(4)(b), +5 days).** If the award was delivered by a s. 64(2)(d)/(e) or (3)(d)/(e) record-of-receipt method, receipt is **deemed 5 days after delivery** unless actual later receipt is shown — **ask the practitioner how the award was delivered** before fixing the anchor date.
- **Fraud/corruption variant (s. 60(2)) is discovery-anchored, not receipt-anchored.** For a set-aside on the fraud/corruption ground, the 30 days run from when the applicant **first knew or reasonably ought to have known** of the ground — not from receipt. Store this only when the practitioner reports a discovery date: record a distinct anchor `arbitral_fraud_discovered` and derive `award_set_aside_fraud` (+30 days, same BCSC closure-sensitive gating as `award_set_aside_application`). This is the knowledge-based pattern of the Limitation Act discovery date; do not compute it speculatively.
- **Monitoring the opponent's recourse window runs off *their* receipt date**, which we generally don't know — **surface, don't calculate**. It matters for enforcement timing: s. 61(3)(a)/(4)(d) requires the opponent's set-aside/appeal window to have elapsed before recognition/enforcement proceeds unconditionally.

**Gating (per row).** `award_set_aside_application` (and `award_set_aside_fraud`) are ordinary **closure-sensitive** BCSC filing deadlines — coverage gate, shift rule, and HTML grid all apply, via [`bcsc-rules.md` § Registry Machinery](bcsc-rules.md#registry-machinery). `award_leave_to_appeal` is the **`appeal_date` class** — no calendar ingestion, no coverage gate, plain Interpretation Act s.29 statutory-holiday shift ([reckoning.md](reckoning.md)), exactly as [`bcca-rules.md`](bcca-rules.md). `award_correction_request` and `award_additional_award_request` are **delivery-class** — no gate, holiday landing surfaced only (see Reckoning above).

> **Verify:** Day-counts and provisions verified against the enactment's own text at the bclaws.gov.bc.ca current consolidation (current to 2026-07-07) in [#62](https://github.com/Mharbulous/CoClerk/issues/62): the s. 60(1) 30-day family (set-aside s. 58, leave to appeal s. 59(3), reckoned from receipt of the award/correction/interpretation/additional award), s. 56(1)/(4) 30-day correction/additional-award windows, s. 60(2) discovery-anchored fraud/corruption variant, and s. 64(4)(b) 5-day deemed receipt. ⚠ Unverified at build: the BCSC commencing form for a set-aside (SCCR R. 2-1(2) — petition assumed) and the s. 60 vs CoA Rules r. 6(2) 30-day interplay.

---

## Cluster 2 — Commencement / limitation interface (anchor `court_stay_ordered`)

**Anchor: `court_stay_ordered`** — the date court proceedings were stayed under s. 7 pending arbitration.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `arbitral_recommencement` | +30 days | `court_stay_ordered` | Arbitration Act s. 12 | Making the claim **in arbitration** within 30 days of the stay preserves the limitation-period suspension back to the original court filing. Mandatory in effect — miss it and the suspension is lost. Delivery-class (commencing an arbitration is delivery of a notice under s. 8(2), not a registry act). |

Interface notes (no additional stored rows):

- **s. 11(1) puts the [`limitation_expiry`](limitation-rules.md) family in charge of arbitral commencement** — the Limitation Act applies to commencing an arbitration exactly as to a court action. **One wrinkle:** `limitation-rules.md` runs a limitation expiry that will be met by a *court filing* through the registry coverage gate and closure shift; but commencing an **arbitration** is **not** a registry act, so for an arbitration-bound claim the court-closure shift does **not** apply — a holiday landing surfaces the plain Interpretation Act s.25(3)(a) extension instead (see Reckoning above). Surface this distinction at calc time when the claim is subject to an arbitration agreement.
- **s. 10 contractual time-bars** (a commencement limit written into the specific arbitration agreement itself, distinct from adopted institutional rules) are **per-agreement facts** — model as [Order-Terms-style rows](bcsc-rules.md#order-terms) sourced to the agreement when a matter has one, never as rules here. Escape hatch: the BCSC may extend for undue hardship (s. 10(1)), on application made "without undue delay" (s. 10(2)).

> **Verify:** s. 12's 30-day re-commencement window and the s. 11(1)/s. 10 interface confirmed against the bclaws consolidation (current to 2026-07-07) in [#62](https://github.com/Mharbulous/CoClerk/issues/62). The `limitation-rules.md` s. 12 caveat pointer is already in place; this file is the source of truth for s. 12.

---

## VanIAC Domestic Rules — Tier-1 deadlines

All VanIAC offsets run **forward** (there are no backward-from-hearing deadlines). Reckoning: the delivery class above for every row. Version: VanIAC Domestic Rules, Sept. 1, 2020.

| Deadline Type | Offset | Base | Rule | Description |
|---|---|---|---|---|
| `arbitration_counterclaim` | **+21 days** (Standard) / **+10 days** (Expedited) | `arbitration_commenced` | VanIAC R. 7(a); R. 24(e) (Expedited) | Deadline to deliver a counterclaim. **Offset is regime-dependent** — determine Standard vs Expedited once per proceeding (see Regime above) and record the chosen offset + $250k basis in `rule_description`. **Direction matters:** mandatory when **our client** counterclaims; monitoring-only when the opposing party does (same convention as [`deemed_admission`](bcsc-rules.md#notice_to_admit_served--response--deemed-admission)). A late or amended counterclaim needs tribunal consent (R. 24(h)). |
| `arbitration_vaniac_appeal` | +21 days | `arbitral_award_date` | VanIAC R. 31(c) | Internal VanIAC Notice of Appeal to a VanIAC Appeal Tribunal. Runs from the **date of the (final or partial final) award**, *not* from receipt — a **different anchor** from the Act's court recourse (see Interplay below). **Rights-forfeiting** for the appellant; monitoring for the respondent. Exists **only** where the arbitration agreement provides for a VanIAC Appeal Tribunal *or* all parties consent (R. 31(a)) — store only then. |
| `arbitration_expedited_material_exchange` | +90 days | `arbitral_tribunal_appointed` | VanIAC R. 25(b)(iv) | **Expedited only.** Backstop by which the parties' written material exchange must complete, running from appointment of the Arbitral Tribunal. The tribunal's own procedural schedule governs within this window and may extend it (R. 25(i)(ii)). Store only when the proceeding is under the Expedited regime. |
| `arbitration_expedited_oral_hearing_application` | +5 days | `arbitration_written_material_delivered` (provisionally `arbitration_expedited_material_exchange`) | VanIAC R. 25(c) | **Expedited only.** Last day for any party to apply for an oral hearing, "within 5 days following delivery of all written material". Permissive. Until delivery of all written material is recorded, cascade provisionally from the R. 25(b)(iv) row and say so in `rule_description`. |
| `arbitration_expedited_award` | +30 days | `arbitration_last_written_material_received` (provisionally `arbitration_expedited_material_exchange`) | VanIAC R. 26(a)(i) | **Expedited only. Monitoring** — the tribunal's act, not a party's: award due "within 30 days of the last written material received by the Arbitral Tribunal where no oral hearing has been ordered". Provisional from the R. 25(b)(iv) row until the last receipt is recorded. Where an oral hearing is ordered, R. 26(a)(ii)'s 45 days from the conclusion of that hearing replaces this row; carry that as a note on this row until a hearing concludes, not as its own dated row. |

**Anchors introduced here.** `arbitration_commenced` — the Rule 6 commencement date (deemed on delivery of the Notice to Arbitrate plus the filing fee). `arbitral_award_date` — the date of the award itself (distinct from `arbitral_award_received`; see Interplay). `arbitral_tribunal_appointed` — the date the Arbitral Tribunal was appointed. `arbitration_written_material_delivered` — the date delivery of all written material completed. `arbitration_last_written_material_received` — the date the tribunal received the last written material.

**Expedited cascade notes.**

- **Defaults, not orders.** The R. 25(b)(iv), 25(c) and 26(a) periods apply "unless otherwise agreed by the parties or directed by the Arbitral Tribunal". The tribunal sets the procedural schedule (R. 25(b)(iii)) and may extend any Part B deadline (R. 25(i)(ii)). Where the matter holds an agreed or directed schedule, store the varied date, citing the rule with the directing order or agreement.
- **Past dates still register.** A first registration often lands after the R. 24(e) counterclaim date has passed. Store it anyway; the cascade is a complete record.
- **One-sided delivery is an open question of law.** Whether one party's delivery alone is "delivery of all written material" (R. 25(c)) or starts the R. 26(a)(i) period is not answered by the rules' text. Keep both rows provisional from the R. 25(b)(iv) date until both parties' delivery is recorded or a `/legal-research` return settles the trigger. Never treat either anchor as triggered by one-sided delivery without that return.

(R. 25(c) and R. 26(a) moved here from the retired VanIAC submissions skill's deadline stage, 2026-09-17, read against the published Rules at https://vaniac.org/arbitration/rules-of-procedure/domestic-arbitration-rules/, accessed 2026-08-15.)

> **Verify:** VanIAC citations read from the primary rules text (vaniac.org, fetched live 2026-07-11 via a browser User-Agent — agent UAs 403) in [#64](https://github.com/Mharbulous/CoClerk/issues/64):
>
> To re-fetch: vaniac.org returns **403** to agent User-Agents (both `WebFetch` and curl's default UA); a browser User-Agent returns 200 from a local session.
> `curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" https://vaniac.org/arbitration/rules-of-procedure/domestic-arbitration-rules/`
> That page is the **current** domestic ruleset; the "Revised", "Previous", and "Shorter" pages are archived older versions — do not read them as current.
> Citations verified against it: counterclaim R. 7(a) / R. 24(e) (21 d Standard / 10 d Expedited), internal appeal R. 31(c) (21 d from award date), Expedited material-exchange R. 25(b)(iv) (90 d from appointment), the $250k Expedited trigger R. 24(a)–(c), and the Rule 3 calendar-day reckoning. Nothing secondhand.

---

## VanIAC ↔ Arbitration Act interplay

- **Computation** — the Rules import the Interpretation Act via R. 1(b)(iii); no VanIAC-specific reckoning displaces it.
- **s. 56 correction / interpretation / additional award** — the Act's default periods (Cluster 1) **survive unmodified** under VanIAC. R. 32(e) preserves the s. 56 remedies before the tribunal and the Rules set no substitute period, and s. 56(1) is agreement-variable but adopting the Rules is not an agreement to a different period. Model s. 56 from the **Act**, not the Rules.
- **ss. 58–60 court recourse (set-aside, leave to appeal)** — the mandatory Act periods (Cluster 1: **30 days from our client's receipt**) are **not displaced** by the Rules.

> ⚠ **Rule 32 contractual toll — surface, do not assert (never modelled).** VanIAC R. 32(a)/(b) *purports* to contractually toll the statutory ss. 58–60 court-recourse clocks until the VanIAC Appeal Tribunal's final decision, and R. 32(c) stays already-commenced court proceedings. **Whether a private agreement can validly extend a *statutory* recourse deadline is unresolved on the primary law — no BC authority settles it.** The skill therefore **never** treats the statutory clock as suspended (vision.md §1; ruling deferred to a Fable design pass, 2026-07-11): `award_set_aside_application` and `award_leave_to_appeal` are always stored as live, independent 30-day-from-receipt deadlines, regardless of any pending or contemplated internal appeal. When an internal appeal is in play, **surface the caveat** at calc time and record it in each statutory row's `rule_description` — a practitioner must not silently rely on the toll; the set-aside/leave clock may still be running, and a protective filing or a court-ordered extension should be considered. (The caveat is recorded in `rule_description`, not `review_flag`: the statutory *date* is firm at receipt + 30, so it is not "provisional" in the `review_flag` sense — only its tolling is contested. The `review_flag` vocabulary is also constrained to `shift_pending`/`limited_day`, so no schema change is implied.)

- **Anchor divergence on a VanIAC award** — the internal VanIAC appeal (`arbitration_vaniac_appeal`) runs **21 days from the award date**; the Act's court recourse (`award_set_aside_application` / `award_leave_to_appeal`) runs **30 days from our client's receipt**. Different offsets **and** different anchor events (`arbitral_award_date` vs `arbitral_award_received`) — on a single award **both clocks run concurrently**. Track them as separate rows; never collapse or conflate the two anchors.

---

## Enforcement (read-time note only)

Arbitration Act s. 61 recognition/enforcement carries **no time limit in the Act**. Whether the BC Limitation Act sets one for enforcement applications (e.g. whether s. 7's 10-year "local judgment" period reaches arbitral awards) is **unresolved on the primary text** — ⚠ surface, do not assert, when the question arises. Timing gate worth surfacing: enforcement evidence must address whether the opponent's set-aside/appeal window has elapsed (s. 61(3)(a)), and the court may stay enforcement while it has not (s. 61(4)(d)/(5)).

**Further appeals.** BCSC decisions under ss. 58 and 61 are appealable to the Court of Appeal **with leave** (ss. 58(6), 61(7)) — those run on the existing [`appeal_date`](bcca-rules.md) machinery. Every other BCSC decision under the Act is **not appealable** (ss. 9(6), 10(3), 14(8), 18(6), 19(3), 23(8), 29(10), 52(5), 53(4), 55(5)) — read-time notes, no stored rows.

---

## Out of scope for this build (Tier-2 — catalogued, not modelled)

Left in the map's fog with the [#62](https://github.com/Mharbulous/CoClerk/issues/62#issuecomment-4949875642) and [#64](https://github.com/Mharbulous/CoClerk/issues/64#issuecomment-4950305246) catalogs as their spec; these all presuppose an arbitration already under way and graduate only when the practitioner confirms mid-proceeding tracking matters for this practice:

- **Act Tier-2** — challenge/jurisdiction recourse (ss. 18(2)/18(4)/23(7)) and procedural mechanics (ss. 8(4), 55(3), 38(4)).
- **VanIAC Tier-2** — event-driven party deadlines (appointment-list responses R. 8(c)/28(b); emergency-arbitrator challenge R. 12; tribunal fee deposits R. 23(b)/33(h); appeal-panel responses R. 33(b)/(c)) and Centre/tribunal-internal monitoring periods (R. 11/13/14/16/20/33/34).
