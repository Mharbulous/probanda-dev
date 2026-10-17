# The firm rule overlay: resolution, reconciliation and rule updates

A court rule can change between plugin releases. The shipped rule files (`bcsc-rules.md`, `bcca-rules.md`, `bc-arbitration-rules.md`, `limitation-rules.md`) change only when the plugin's maintainer remodels them and a plugin release ships them. The **firm rule overlay** lets a practitioner record a verified change locally, so every later calculation uses the rule in force on the relevant date.

Overlay records are kept by ``practice-data``: `upsert-rule-overlay` writes one record, and `rule-overlay` reads them, filtered by deadline type, amending reg or status. The record contract is spec `Engineering/1. Design/2026-10-05_deadline-rule-overlay-spec.md` §6. A record is firm-wide and never carries matter content: no matter code, party name, file name or fact, in any field.

## 1. Resolution (every calculation)

Run this after reading the routed rule file, in workflows 2, 3 and 5 and in any what-if.

1. Call ``practice-data`` `rule-overlay` once per session for the deadline types in play (or unfiltered), and reuse the result.
2. For each deadline type the calculation needs, the candidates are the shipped row and every overlay record of that `deadline_type`.
   - A shipped row is in force from the beginning of time until the earliest `effective_from` of a `verified` record whose `supersedes` names `shipped:<deadline_type>` or that has the same `deadline_type`. A shipped row may also state its own dates (section 4).
   - A record is in force from its `effective_from` through its `effective_to`, inclusive. A null `effective_to` means it is still in force.
3. Pick the candidate in force on the **base date**: the date of the row's base, which is the service date for a service-based row and the hearing date for a hearing-based row.
4. Apply it:
   - **Overlay record.** Compute from its `offset`, `counting` and `base`, using the method its `counting` names: `calendar` is the calendar-day model with the landing-day shift; `forward_n_business_days` is the Forward algorithm, `backward_n_business_days` the Backward algorithm (N clear business days), and `backward_full_business_days` the Backward algorithm (latest permissible date), all in `bcsc-rules.md`. The coverage gate and closure handling apply as for a shipped row. Store `rule_ref` and `description` from the record, and put `overlay:<record_id>` in `review_note`.
   - **Repeal record** (`offset: null`). Store no row of that type. Report "repealed by `<amending reg>` from `<effective_from>`".
   - **Semantics.** Carry the record's `semantics` into `rule_description` the same way the rule files mark earliest-permissible and permissive rows.
   - **New deadline type.** A record whose `deadline_type` appears in no shipped rule file is computed like any other, but its `rule_description` begins "[not in shipped vocabulary]" so `executive-assistant` and query consumers show it plainly.
   - **Open questions.** When a computed date turns on one of the record's `open_questions`, show the question beside the date, every time.
5. **Transition.** When the base date falls before a record's `effective_from` but the computed date falls on or after it, compute under the row in force on the base date. Put `transition_question: <amending reg> commenced <date>` in `review_note`, report it, and route the question of which regime governs to `/legal-research` under the named matter. Never decide it here.
6. **Records that never drive a date.** An `unverified` record is shown as "pending verification" and is not used. A `superseded_by_shipped` record is not used. A `conflict` record blocks its deadline type (section 2).

`rule_stale` keeps its hard-block meaning (`rule-freshness.md`). Manual and `order_term` rows are never recalculated from an overlay record.

## 2. Reconciliation after a plugin update

At each resolution, compare each `verified` record with the routed shipped rule file.

- **The shipped file now carries the same row.** It is the same row when it has the same `deadline_type`, cites the same `rule_ref`, states the same `effective_from` (section 4), and has the same offset (value, unit, direction and clear). Write the record back through `upsert-rule-overlay` with `status: superseded_by_shipped`. The shipped row governs from then on. Tell the practitioner once.
- **The shipped file carries a different row** for the same `deadline_type`, `rule_ref` and `effective_from`. Write the record back with `status: conflict`. Do not calculate that deadline type. Show the shipped row and the record side by side under `/show-me` and ask the practitioner to choose.
  - If they choose the shipped row, set the record to `superseded_by_shipped`.
  - If they choose the record, set it back to `verified` and append "practitioner kept this record over the shipped row on `<date>`" to its `open_questions`. The comparison then reports the difference on each calculation without blocking. Create a ``practice-data`` to-do naming the difference, and ask the practitioner to send `/legal:suggestion` asking for the shipped row to be corrected in a plugin release.

## 3. Workflow 10: update a rule from its primary source

**Triggers.** The rule-freshness gate reports a change, including an elapsed pending commencement, or the practitioner says a modelled rule has changed.

**Live issue.** Recording a rule is legal work. Run it only for the named matter whose calculation needs the rule, or as unbilled firm work the practitioner expressly authorizes (`shared/live-issue-test.md`). The matter is never written into the record.

The docket-clerk agent runs these steps over three spawns (its workflow 10): its caller, the `/rule-update` skill, does step 2's fetch and collects step 5's approval.

1. **Identify the instruments.** Record the enactment, the amending regulation number, the OIC number and the commencement date from the instrument itself. Never infer them.
2. **Fetch the primary source** with `sources__fetch`: the bclaws consolidation if it already shows the change, otherwise the deposited regulation or OIC (for example `https://www.bclaws.gov.bc.ca/civix/document/id/oic/oic_cur/0264_2026`, a PDF). Extract each affected subrule verbatim. No rule from memory, a summary or another decision.
3. **Map subrules to deadline types.** Search the routed rule file for each changed `rule_ref`, as `rule-freshness.md` does in its backward gate. A changed subrule that no modelled deadline cites is listed as "may need new modelling" and blocks nothing.
4. **Draft the records** (spec §6): `deadline_type`, `anchor_type`, `base`, `offset`, `counting`, `semantics`, `rule_ref`, `verbatim`, `source` with its fetch date, `effective_from`, and `supersedes` naming each shipped row it ends.
   - A repealed rule with no successor gets a repeal record (`offset: null`, with `counting`, `semantics` and `base` null) and no new row.
   - An earlier overlay record the new one replaces gets its `effective_to` set to the day before the new `effective_from`.
   - A construction question met while drafting goes in `open_questions` and is never resolved here. An example is whether "at least 4 business days before" takes the Interpretation Act s. 25.2(3) added day (#740, `reckoning.md`).
5. **Approval.** Present each record under `/show-me`, one decision at a time: the current shipped row in full, the proposed record in full, and the source passage itself.
6. **Write.** On the practitioner's approval, write each record through ``practice-data`` `upsert-rule-overlay` with `status: verified`, `verified_by: practitioner` and `verified_at` set to today. Nothing is written before approval. Workflow 10 never writes an `unverified` record.
7. **Recalculate.** Run workflow 3 (cascade) for every active deadline flagged `rule_stale` against the changed sections. Each recalculated row carries `overlay:<record_id>` in `review_note`.

## 4. Effective dates on shipped rows

A shipped row may state when it is in force by ending its Description with `In force from YYYY-MM-DD.`, `In force to YYYY-MM-DD.`, or both. A row that states neither is in force from the beginning of time until a record supersedes it (section 1). Section 2's same-row test reads `effective_from` from this sentence.

## 5. Rule records stay with the firm

Probanda does not share rule records between firms. Workflow 10 ends with its cascade and report, and a detected rule change ends with its block, report and to-do. Neither offers anything further.
