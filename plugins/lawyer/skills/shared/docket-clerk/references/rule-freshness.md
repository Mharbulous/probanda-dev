# Rule-Freshness Machinery — verifying the rule files against current BC law

The calc-time check that the locally-maintained rule files still match the real BC law before a deadline is trusted (vision.md Principle 5). It is **cross-enactment**, not proceeding-specific: it gates whichever enactment(s) govern the routed rule file, so it lives in its own reference file rather than inside any one proceeding's rules — unlike the BCSC-only [§ Registry Machinery](bcsc-rules.md#registry-machinery).

**When it runs:** step 0 of the docket-clerk agent's workflows 2 (Derive), 3 (Cascade), and 5 (Query) — before any deadline is calculated, recalculated, or reported. It answers one question: *has the governing BC law changed since the rule files were last verified?* If yes, the affected stored deadlines are **hard-blocked** (`review_flag='rule_stale'`) until the rule file is re-verified.

**Detection oracle:** the bclaws CiviX API (`www.bclaws.gov.bc.ca`) — the enactment's own text, no auth, plain HTTPS, King's Printer Licence. Fetching it is **not** a data-sovereignty breach (vision.md §1) — only client/privileged data must stay local; public law is fetched freely. Catalogued in issue #114.

**Jurisdiction:** British Columbia only. Governs the five enactments in `references/rule-freshness.json`.

---

## The snapshot: `references/rule-freshness.json`

Per-enactment record of *the state of the law the rule files were last verified against*: `currency_date`, `last_amending_reg`, `pit_watermark`, `pending_changes[]`, `last_checked`, plus the civix ids to fetch (`civix_id`, `pit_id`/`tlc_id`) and which `rule_files` each enactment governs.

This JSON is **metadata about the sibling rule files**, so it must be bumped in the **same commit** as any rule-file change — never desynced. It is the "as-of" the check compares live bclaws against; a live signal ahead of the snapshot means the rule files are potentially stale.

The five enactments and their governed files:

| Enactment | Coarse-fetch id | Section-level id | Governs |
|---|---|---|---|
| Supreme Court Civil Rules (B.C. Reg. 168/2009) | `168_2009_00` (TOC part) | PIT `168_2009_pit` | `bcsc-rules.md` |
| Court of Appeal Rules (B.C. Reg. 120/2022) | `120_2022` | PIT `120_2022_pit` | `bcca-rules.md` |
| Arbitration Act (SBC 2020 c 2) | `20002` | TLC `e4tlc20002` (no PIT) | `bc-arbitration-rules.md` |
| Interpretation Act (RSBC 1996 c 238) | `96238_01` | PIT `96238_pit` | `reckoning.md` (shared) |
| Limitation Act (SBC 2012 c 13) | `12013_01` | PIT `12013_pit` | `limitation-rules.md` |

The coarse-fetch id is the JSON entry's `coarse_doc_id` when present, else its `civix_id`. The SCCR is multi-part: a **bare** `168_2009` fetch returns no currency string (confirmed live 2026-07-13), which is why `coarse_doc_id` names the TOC part `168_2009_00`. The **part** documents are not bare — `168_2009_01` returned both coarse signals (`current to July 21, 2026` and `Last amended May 4, 2026 by B.C. Reg. 31/2026`, measured live 2026-07-28) — so a fetcher already holding a part document reads currency off it instead of fetching the TOC a second time. `civix_id` (bare `168_2009`) is still what the PIT id and folder navigation build on.

The **Interpretation Act is always in play** — every deadline calc loads `reckoning.md` — so the step-0 gate always checks it *plus* the routed proceeding enactment (e.g. a BCSC derive checks `168_2009` **and** `96238_01`; a limitation question checks `12013_01` **and** `96238_01`). **Gate only the routed enactment(s)** — a Court of Appeal change never blocks a BCSC calc.

## Step 0a: elapsed pending changes (no fetch)

Runs first, before any fetch, so it applies offline too. bclaws often lags commencement by days or weeks, and until it consolidates, the coarse compare and the PIT table both read fresh. A recorded amendment whose commencement date has passed is a **known** change in force, so it is treated as detected staleness whatever bclaws shows.

For each gated enactment, read its `pending_changes[]`. For each entry whose `commencement_date` is on or before today (the calculation date, not any hypothetical date):

1. **Map sections to deadline types.** Each `sections` string names a rule and the subrules it changes (e.g. `Rule 8-1 (1),(9); (5)-(8) repealed`). A range such as `(5)-(8)` covers every subrule in it. A row's `rule_ref` **matches** when it cites the same rule and either citation contains the other: `Rule 8-1(8)(a)` matches a listed `(8)`, and `Rule 8-1(15)(e)` matches a listed `(15)(e)(i)`. A `rule_ref` naming the rule with no subrule matches any listed subrule of it, and a rule listed with no subrules matches every row citing that rule. Find the matching deadline types by searching the routed rule file, as in [backward gate](#the-backward-gate-coarse--precise) step 3. A section that matches no modelled deadline type is reported as "may need new modelling" and blocks nothing. An entry's `forms` list is not mapped here and blocks no deadline type.
2. **Overlay.** If this file has an "Overlay coverage" section, apply it to the matched deadline types first. Covered deadline types do not block. Without that section, every matched deadline type is uncovered.
3. **For each uncovered deadline type:**
   - Flag the matter's matching active rows as in [On detected staleness → block](#on-detected-staleness--block) step 1, with a `review_note` naming the enactment, the sections, the amending reg and the commencement date. Its exemptions (step 2) apply unchanged.
   - **Refuse** any new calculation of that type, hypotheticals included. This departs from that section's step 3, which still runs the calculation: here the rule file is known to model a repealed or amended rule. Say: "`<amending reg>` in force `<commencement_date>`; rule set not updated for `<rule_ref>`. Run `/rule-update` (docket-clerk workflow 10) or wait for a plugin release that ships it." Deadline types the entry does not reach calculate normally.
4. **To-do.** Read ``practice-data`` `open-tasks`. If no open to-do names the amending reg, create one with `upsert-task` whose description begins `Rule change:` and names the enactment, the amending reg, the commencement date and the uncovered deadline types. The prefix is how `executive-assistant` finds it.

The block ends when a plugin release ships the remodelled rule file with the entry's `sections` set to `[]` (see [Snapshot maintenance](#snapshot-maintenance)).

## The fetch (bclaws CiviX, per enactment)

**Route.** A session's own web tool cannot be relied on for bclaws: its `robots.txt` admits only search-engine crawlers, so WebFetch refuses it (`ROBOTS_DISALLOWED`, observed 2026-10-06). When the gated enactment's rule file carries a source record in its front matter, the first route is `sources__check`, which fetches on the practitioner's machine and returns facts, never rule text. Today that covers the Supreme Court Civil Rules (`bcsc-rules.md`), the Limitation Act (`limitation-rules.md`) and the Interpretation Act (`reckoning.md`), with their Point-in-Time records `168_2009_pit.md`, `12013_pit.md` and `96238_pit.md` in `references/pit/`. The SCCR record reads part `168_2009_01`, which carries the same `current to` stamp as every other part, so one part is enough. Every other enactment, and any `gap` result, falls back to the ladder in `shared/bclaws-sccr-doc-map.md` § Access notes. Read a source-record result this way:

- **Coarse:** `sources__check` with `files: [{tree: "skill_source", path: "shared/docket-clerk/references/<rule file>"}]`. `marker_matches: true` is a coarse match. `marker_matches: false` is a coarse mismatch, and `marker_found` holds the live `current to` date. The recorded `currency_marker` is the snapshot's `currency_date` in long form.
- **Section-level, on a coarse mismatch:** `sources__check` on `shared/docket-clerk/references/pit/<pit_id>.md`. Ignore `marker_matches`. Take the latest date in `marker_found` (the list is sorted as text, so parse each date first). A date after the snapshot `pit_watermark` is a real in-force change. If there is none, the mismatch is consolidation churn. The dates do not name the section, so on a real change, localize it through the fallback ladder; if no rung succeeds, block at enactment level as in [Offline / sandbox degrade](#offline--sandbox-degrade).
- **A consolidation behind the rule file is not staleness.** The source-record check compares only the `current to` date. bclaws can show a `Last amended` regulation older than the snapshot's `last_amending_reg` when a rule file already models an amendment the consolidation has not yet incorporated. For the SCCR that is B.C. Reg. 105/2026, modelled on 2026-10-09, while the September 29, 2026 consolidation still reads B.C. Reg. 31/2026. Only a live signal ahead of the snapshot suggests a change. When a later consolidation moves the `current to` date, the PIT escalation finds no date after the `pit_watermark` of 2026-10-01, and a 2026-10-01 row for 105/2026 is not after it, so the result is churn. The 105/2026 `pending_changes[]` entry has `sections: []`, so step 0a reaches no deadline type either. Neither route flags the remodelled 2026-10-01 rows `rule_stale` because of this lag.

Reuse the Court Calendar **fetch-and-24h-cache** shape. For each enactment to be gated:

1. If its `last_checked` is under 24 hours old, use the cached snapshot — **do not re-fetch**. Otherwise fetch. (`sources__check` also memoizes each URL for 24 hours in its own process.)
2. **Coarse signals** — `GET https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/<coarse-fetch id>` (follow one 302; use the coarse-fetch id from the table above — for the SCCR that is `168_2009_00`, not bare `168_2009`). Regex out:
   - `current to <Month D, YYYY>` → live `currency_date`.
   - regulations only: `Last amended <date> by B.C. Reg. <n>/<yyyy>` → live `last_amending_reg` (also appears as the "latest incorporated reg" in the SCCR intro).
3. **Section-level** (only on a coarse mismatch — see below) — `GET .../statreg/<pit_id>` returns the Point-in-Time table as `(SECTION, EFFECTIVE DATE)` rows plus the amending instrument. The rows are **ordered by section, not by date** (checked live 2026-10-06), so the section-change watermark is the latest effective date anywhere in the table, not the top row. The Arbitration Act has **no** PIT table — use the Table of Legislative Changes doc `e4tlc20002` instead, at enactment-level granularity. Don't detect "no PIT" by HTTP status: `20002_pit` returns a 200 HTML shell (not a 404), so confirm an actual `(SECTION, EFFECTIVE DATE)` table is present before trusting a PIT response for any enactment.
4. **Pending amendments** (forward look-ahead) — the enactment's `Amendments Not in Force` subfolder (navigate via `GET .../content/complete/statreg/<ancestor-path>/<id>`) and BC Gazette Part II (`.../content/bcgaz2/bcgaz2/<year>/`) list enacted-but-not-yet-in-force changes with commencement dates.

A session never writes `last_checked` (see [Snapshot maintenance](#snapshot-maintenance)). The 24-hour memo in `sources__check` stands in for it.

## The backward gate (coarse → precise)

Per gated enactment, cheapest-first:

1. **Coarse compare.** Live `currency_date` == snapshot `currency_date` **and** live `last_amending_reg` == snapshot `last_amending_reg` → **fresh**; stop (no further fetch). The currency date advances on every province-wide consolidation cycle (~biweekly) even when nothing relevant changed, so a coarse match is a reliable *all-clear* but a coarse mismatch is only a *suspicion*, not yet a confirmed change.
2. **Escalate on mismatch.** Fetch the PIT table (or TLC for the Arbitration Act). A row whose effective date is **after** the snapshot `pit_watermark` is a real in-force section change; its `SECTION` and `EFFECTIVE DATE` localize it. A moved `currency_date` with **no** PIT row after the watermark is consolidation churn — **not** stale; treat as fresh and refresh `last_checked` only.
3. **Map changed section → affected deadline types.** The rule files are themselves the section↔deadline map: each stored deadline cites its `rule_ref` (e.g. `Rule 16-1(4)`, `s. 60(1)`). For each changed section, search the routed rule file for that citation to find the affected deadline types. Do **not** maintain a separate mapping table — it would duplicate the rule files and desync. A changed section that matches **no** modelled deadline affects no stored row: surface it in the report ("`<enactment> <section>` changed <date> — no modelled deadline cites it; may need new modelling") but block nothing.
4. **Arbitration Act (no PIT).** Escalation is enactment-level only: a coarse mismatch that the TLC/ANIF confirms is a real change flags **every** active arbitration deadline (the granularity ceiling — bclaws cites no finer for this enactment).

## Overlay coverage

`rule-freshness.json` ships with the plugin, so a matter session cannot bump it. A change the practitioner has already recorded in the firm rule overlay (`rule-update.md`) must not block again on every calculation. Before blocking, check coverage:

1. For a detected change, which is a PIT row dated after the watermark or a `pending_changes[]` entry whose commencement date has passed, map its sections to deadline types (step 0a step 1, backward gate step 3), then read ``practice-data`` `rule-overlay` filtered by that change's amending reg.
2. A deadline type is **covered** when a `verified` record carries that amending reg and either has that `deadline_type` or names `shipped:<that deadline_type>` in `supersedes`. A repeal record counts. A record's `rule_ref` never widens coverage: a record for one deadline type covers no other type, whatever rule or subrule it cites.
3. Covered deadline types do not block. Every uncovered deadline type still blocks as below. Report each covered type once: "`<enactment> <section>` changed `<date>` — `<deadline_type>` covered by the firm rule overlay (`<amending reg>`)".
4. The Arbitration Act's enactment-level detection is covered only when the practitioner confirms the overlay records cover the whole change. Otherwise it blocks as today.

Coverage never edits `rule-freshness.json`, and it does not clear an existing `rule_stale` row. Clearing is still workflow 3's cascade.

## On detected staleness → block

A confirmed change that the [overlay](#overlay-coverage) does not cover means the rule files may be behind current law, so every deadline computed from an affected section is suspect regardless of when it was individually calculated:

1. Retrieve the current matter's active deadlines (``practice-data`` `active-deadlines`). For each whose `rule_ref` cites a changed section and whose deadline type is uncovered, batch ``practice-data`` `upsert-deadline` with `review_flag='rule_stale'` and a `review_note` naming the **enactment, section, amending reg, and effective date**. `rule_stale` is a **hard block** — no consumer may treat the date as valid until the rule is re-verified (``practice-data`` Consumer Contract; stronger than the provisional `shift_pending`/`limited_day`).
2. **Exemptions — never auto-flag:** `source_type='manual'` and order-term (`source_type='order_term'`) deadlines. List them in the report as "not auto-flagged — please review" (mirrors the manual-deadline cascade convention).
3. **The current calc still runs** — compute and store the requested deadline from the current (best-available) rule file, but flag it `rule_stale` alongside the rest. Lead the report with the staleness: the practitioner must re-verify the rule file before any affected date is trusted.
4. The flag targets the **current matter's** affected active rows. Other matters are caught on their own next calc's step-0 gate — this skill does not sweep every matter (that would be a heavier design, out of scope here).

**Clearing a `rule_stale` block** is a two-step the practitioner drives: (a) a plugin release ships the remodelled rule file with its `rule-freshness.json`, or the practitioner records the change in the firm rule overlay (docket-clerk workflow 10); then (b) cascade-recalculate (workflow 3), which supersedes each blocked row with a freshly-computed, un-flagged one. Clearing *is* a cascade — no separate mechanism.

## Offline / sandbox degrade

If the coarse fetch itself cannot run — offline, or a Cowork sandbox where bclaws turns out to be unreachable (not a categorical block: work the access ladder in `shared/bclaws-sccr-doc-map.md` § Access notes before concluding it) — **never block on inability-to-check**. A `gap` from the coarse `sources__check`, with every fallback rung also failing, is this case. Calculate normally and note in the summary: "freshness not verified (offline); rules last verified `<currency_date>`." This is distinct from *detected* staleness (a coarse fetch that succeeded and confirmed a change) → that still blocks. Only genuine inability-to-reach-bclaws degrades. Step 0a needs no fetch, so it still blocks offline.

Edge case: a coarse fetch **succeeds** but the PIT/TLC escalation fetch fails (for a PIT source record, a `gap` with every fallback rung failing). The change is detected but cannot be localized to sections. This is detected staleness, not inability-to-check: block **conservatively at enactment level** — flag every active deadline routed to that enactment — with a `review_note` recording that section-precision was unavailable. Better to over-block a real change than to let a suspected-stale date read as valid.

## Forward diarize (enacted but not yet in force)

Runs on the same 24h cadence as the coarse gate. For each pending amendment to a gated enactment (from ANIF / Gazette Part II) whose commencement date is in the future:

1. If it is **not already** in that enactment's `pending_changes[]`, and no open ``practice-data`` to-do names its amending reg, create a ``practice-data`` **to-do** via `upsert-task`: `next_nudge_date` = commencement date, with no `nudge_interval_days`; description begins `Rule change:` and names the enactment, section, amending reg, and the affected modelled deadline types (map its section via the rule files, as in the backward gate). `executive-assistant` surfaces the to-do on the day. Pure-data boundary intact — this skill writes the to-do; `executive-assistant` surfaces it.
2. Never append it to `pending_changes[]` yourself: `rule-freshness.json` is read-only in an installed plugin (see [Snapshot maintenance](#snapshot-maintenance)). The open to-do is the dedup ledger, so the to-do is created once. Ask the practitioner to send `/legal:suggestion` naming the enactment, section, amending reg and commencement date, so a plugin release adds the entry as a calc-time backstop.
3. Once a `pending_changes[]` entry's commencement date has passed, [Step 0a](#step-0a-elapsed-pending-changes-no-fetch) blocks the uncovered deadline types reached by the sections it names. When the change is folded into a re-verification, clear the entry as [Snapshot maintenance](#snapshot-maintenance) says.

## Snapshot maintenance

`rule-freshness.json` ships with the plugin and is read-only in an installed copy. Only the plugin maintainer's rule remodel writes it, and a plugin release ships the result. A session working for a practitioner never writes it. The bullets below govern the maintainer's remodel.

- **On a successful live check with no relevant change:** nothing is written. `currency_date`/`last_amending_reg`/`pit_watermark` stay as-is (consolidation churn is not a re-verification).
- **On a re-verification** (the practitioner reconciled the rule file with the amended law): bump `currency_date`, `last_amending_reg`, and `pit_watermark` to the freshly-verified values, **in the same commit as the rule-file change**. The JSON and the rule files it certifies never move apart.
- **Atomicity is the invariant:** `rule-freshness.json` MUST be bumped in the same commit as any rule-file update. A rule file ahead of its snapshot (or vice-versa) silently breaks the gate.
- **Source-record markers are part of the snapshot.** Where a rule file carries a source record, its `currency_marker` is the enactment's `currency_date` in long form, and the matching `references/pit/<pit_id>.md` marker is its `pit_watermark`. A bump of either field moves the marker in the same commit.
- **A `pending_changes[]` entry has two halves.** `sections` is this skill's: when the remodelled rule file ships, set `sections: []` in the same commit, and step 0a then reaches no deadline type. `forms` belongs to the litigation server's form-currency check (ADR 0038): each form in it clears when that form's `/publish` identity file lists the amending reg under `conformed_to:`. Delete the entry only when `sections` is empty and every form in `forms` is conformed.
