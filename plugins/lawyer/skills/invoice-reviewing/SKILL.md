---
name: invoice-reviewing
disable-model-invocation: true
description: Review a draft invoice against time entries and invoice data before sending. Use to check, review, or sanity-check a draft invoice or a matter's billing before sending, or whether entries are missing or amounts look unusual.
---

<!-- lawyer v0.21.12 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Design Principles | Always |
| Data Availability | Before fetching entries or invoice data, or when a check seems to need unsupported data |
| Review Workflow | Every review, first |
| Available Now: Time Entry Checks | Running the time-entry checks A to E |
| Invoice-Level and Line-Item Checks — Not Supported | Reporting which invoice-level checks cannot be performed |
| Output Format | Presenting the checklist |
| Integration with Other Skills | Invoice data is absent or stale, or work belongs to another skill |
| Anti-Patterns | Always |

# Invoice Reviewer

QA skill — read-only. Reads time entries and invoice state from the shared practice database (via
``practice-data``) and produces an itemized checklist of potential issues before the draft invoice
reaches the client. Never writes, updates, or deletes any record.

## Design Principles

The five principles from `vision.md` that govern every output:

1. **Read-only** — never modify DB state. Any code path that writes a row or updates a field violates the skill boundary.
2. **Surface every issue** — report all detected anomalies, even if the list is long. Never filter by severity; the practitioner decides what is intentional.
3. **Cite the data** — every flag must state the record ID, the observed value, and why it is anomalous. "Unusual amount on matter 1042" is not actionable. "Time entry #447 (2.5 hrs, 2026-04-18, matter 1042) is 3× the median entry duration for this matter" is.
4. **Warn on stale data** — if invoice data or time entry data was last updated beyond the staleness threshold, flag it before presenting any checklist.
5. **Always report what was checked** — when no issues are found, state that explicitly and list which checks were performed and against which data range.

## Data Availability

All practice-database access goes through ``practice-data``. This skill never opens the database, never
writes SQL, and never reads accounting CSVs directly. Two operations supply everything:

- **`time-entries`** (`practice_data__time_entries_query`) — per-entry rows (`id`, `entry_date`,
  `hours`, `description`, `created_at`) for a matter, optionally within a date range, enriched with
  matter/client context. Powers all time-entry checks (A–E).
- **`invoice-data`** (`practice_data__invoices_query`) — invoice header rows (`invoice_number`,
  `issue_date`, `date_to`, `amount`, `amount_paid`, `status`, `last_import_at`) for a matter.
  `date_to` is the last day the invoice covers, or NULL when the source export had no such column.
  Powers invoice presence and the invoice-side staleness check.

**Not supported by practice data:** a billing-period start, and per-line records of an invoice
that is still a draft. Checks that would need them are **not available** unless the practitioner names
the draft's lines file, which Check F uses. Report them as unsupported in the "checks performed" list
rather than probing for them. If the practitioner needs line-item verification, say so explicitly; do
not fabricate it.

**Billing-period overlap is not performed.** Invoices record a period end (`date_to`) but no period
start, and this skill defines no overlap rule on that basis. Report the check as not performed.

### Draft Invoice Entry Point

Invoice-reviewing does not parse raw invoice files. The practitioner exports a draft invoice listing
from their practice management system (LEAP or similar) and imports it via invoice-tracking before
running a review. If the invoice data returned by `invoice-data` is absent or stale, tell the
practitioner to run invoice-tracking first.

## Review Workflow

When the practitioner invokes invoice-reviewing for a matter (or a set of matters):

1. Resolve the matter from the practitioner's description (name, file number, or matter number).
2. Run the **Stale Data Check**.
3. Fetch entries via `time-entries` for the matter — if none exist, stop early and report.
4. Run all applicable checks from **Available Now: Time Entry Checks**.
5. Note invoice presence via `invoice-data`; report unsupported invoice-level/line-item checks.
6. Present the checklist.

### Early Exit: No Entries

Call `time-entries` for the matter. If it returns `{rows: []}`, stop immediately:

> "No time entries found for [matter]. Nothing to review. If entries exist in your practice
> management system, import them, or run time-entry-drafting if the timekeeper plugin is
> installed, before reviewing."

Do not run any other checks.

### Stale Data Check

Before any other checks, assess data currency from the tool returns:

- **Invoice data:** the `last_import_at` returned by `invoice-data`. Flag if NULL (no invoices
  imported) or more than **7 days** before today.
- **Time entries:** the maximum `created_at` across the rows returned by `time-entries`. Flag if
  NULL (no entries) or more than **14 days** before today.

If stale, open the checklist with:

> **Data currency warning:** Invoice data last imported [date] ([N] days ago). Time entries last
> recorded [date] ([N] days ago). Review results reflect data as of those dates — entries or
> payments recorded since then are not included.

Do not suppress this warning even if the practitioner has already acknowledged it.

### Billing Period

The billing period scopes which entries several checks examine. Resolve it in this order:

1. **Practitioner-supplied:** if the practitioner specified a date range when invoking the review, use it.
2. **Derived from entries:** otherwise use `MIN(entry_date)` and `MAX(entry_date)` across the
   `time-entries` rows for this matter and note: "Billing period derived from entry dates ([start] to
   [end]) — no billing period supplied." (Invoice records carry a period end, `date_to`, but no
   period start, so this skill does not read the period from the invoice record.)

Never silently assume the billing period. Always state which source was used in the output header.

---

## Available Now: Time Entry Checks

Fetch entries once via `time-entries` with the matter ref and the billing period as
`from_date`/`to_date`; run the statistics skill-side over the returned rows (`id`, `entry_date`,
`hours`, `description`). For the NULL/zero-hours check, fetch the matter's entries without a date
filter so error rows outside the assumed period are still caught.

#### Check F: Each Line's Support, and Hours That Tie

For an entry with a `source_key`: flag one with neither `proposal_ids` nor an `estimate` holding a
basis, as `Entry #{id} ({entry_date}): nothing recorded supports it.` Name each one whose `provenance`
is `estimate` so the practitioner sees it. When the practitioner names the draft's `invoice_lines.json`,
read it. For each row, sum `billed_seconds` over the entries for that date and person, and flag a row whose
`unrounded_hours` differ, as `Line {date}, {user}: {unrounded_hours} h on the draft against {sum} h recorded.`
Flag a row with no such entries, and any row carrying unavailable sources, with their reasons.

#### Check A: NULL or Zero Hours

Before statistical analysis, flag entries with NULL or zero hours — these are likely recording errors
and will corrupt any downstream calculation. Over the unfiltered entries, flag each row where `hours`
is NULL or `0`:

> `Entry #{id} ({entry_date}): hours is {NULL/0} — possible recording error.`

Filter these out of subsequent checks: keep only rows with truthy `hours`.

#### Check B: Statistical Outliers (Duration)

Require at least 5 entries with valid hours. If fewer, note: "Statistical outlier check skipped —
fewer than 5 entries with recorded hours."

If all entries have identical duration (zero variance), note: "Statistical outlier check skipped —
all entries have the same duration ({hrs} hrs); no outliers possible."

Otherwise compute the median of the durations. For each entry:
- if `hours > 3 × median`: `Entry #{id} ({hours} hrs, {entry_date}): {hours/median:.1f}× the median entry duration ({median:.1f} hrs) for this matter.`
- if `hours < 0.1`: `Entry #{id} ({hours} hrs, {entry_date}): duration below 6 minutes — possible recording error.`

#### Check C: Entry Gaps

Sort the in-period rows by `entry_date`. Flag any gap of **5 or more calendar days** between
consecutive entries:

> `Gap of {gap_days} days between entry #{prev_id} ({prev_date}) and #{curr_id} ({curr_date}).`

A gap is not necessarily an error (weekends, vacations, hearing-only days). Surface it; the
practitioner decides.

#### Check D: Near-Duplicate Entries

Over the in-period rows, compare every pair on the same `entry_date` (skill-side, each pair once).
Flag a pair when the trimmed lowercased descriptions match, or when the hours are equal:

> `Possible duplicate: entry #{id1} and #{id2} ({entry_date}) — same {description/hours}.`

Cite both descriptions and hours.

#### Check E: Entries with Missing or Minimal Descriptions

Flag any in-period entry where `description` is NULL, empty, or fewer than 10 characters:

> `Entry #{id} ({hours} hrs, {entry_date}): description {is blank / is too short (N chars)}.`

---

## Invoice-Level and Line-Item Checks — Not Supported

The practice schema stores invoice **header** state only (number, issue date, period end,
amount, amount paid, status, last import). It does not store a per-invoice hourly rate, a period
start, or per-line invoice items. Consequently these checks are unavailable and must be reported as
such:

- **Invoice total vs entry hours** — needs a stored hourly rate. Not supported.
- **Billing-period overlap** — the invoice has a period end (`date_to`) but no period start, and this
  skill defines no overlap rule. Not performed.
- **Rate mismatch across entries** — needs line items. Not supported.
- **Entries in DB but absent from draft / mis-attributed line items / total vs sum of line items /
  entries outside billing period** — all need `invoice_line_items`. Not supported.

`invoice-data` still confirms whether any invoice has been imported for the matter; if none has, note:
"No invoice record found for this matter. Run invoice-tracking to import the draft invoice." Do not
attempt to reconstruct line items or rates from other data.

---

## Output Format

Always use this structure:

```
Invoice Review — [Matter Number]: [Matter Description]
Date: [today]
Billing period: [start] to [end] — source: [practitioner-supplied / derived from entries]
Data as of: invoices imported [date or "not available"], time entries through [date]

[Data currency warning if applicable]

CHECKLIST — [N issues found / No issues found]
──────────────────────────────────────────────

[If issues found:]
  1. [Check type]: [Specific citation with record ID, observed value, and why anomalous]
  2. ...

[If no issues found:]
  No issues detected.

CHECKS PERFORMED
──────────────────────────────────────────────
  ✓ NULL/zero hours ([N] entries; [M] flagged)
  ✓ Statistical outlier detection ([N] entries analyzed; median [X] hrs) [or: skipped — reason]
  ✓ Entry gap detection ([N] gaps checked)
  ✓ Near-duplicate detection
  ✓ Description completeness
  — Invoice amount vs entry hours: not supported (no hourly rate in cloud invoice schema)
  — Billing period overlap: not performed (invoices record a period end only)
  — Rate mismatch / line-item cross-check: not supported (no invoice_line_items)
```

**Zero-issues example:**

```
Invoice Review — L8948: Smith v Jones
Date: 2026-04-23
Billing period: 2026-03-01 to 2026-03-31 — source: derived from entries
Data as of: invoices imported 2026-04-22, time entries through 2026-04-20

CHECKLIST — No issues found
──────────────────────────────────────────────
No issues detected.

CHECKS PERFORMED
──────────────────────────────────────────────
  ✓ NULL/zero hours (18 entries; 0 flagged)
  ✓ Statistical outlier detection (18 entries analyzed; median 1.2 hrs)
  ✓ Entry gap detection (no gap ≥ 5 days)
  ✓ Near-duplicate detection (no duplicates)
  ✓ Description completeness (all 18 entries have descriptions)
  — Invoice amount vs entry hours: not supported (no hourly rate in cloud invoice schema)
  — Billing period overlap: not performed (invoices record a period end only)
  — Rate mismatch / line-item cross-check: not supported (no invoice_line_items)
```

**Issue example:**

```
CHECKLIST — 4 issues found
──────────────────────────────────────────────

1. [NULL hours] Entry #389 (2026-03-05): hours is NULL — possible recording error.

2. [Outlier — duration] Entry #447 (2.5 hrs, 2026-03-18): 3.1× the median entry duration
   (0.8 hrs) for this matter. Verify this was a multi-session drafting day.

3. [Entry gap] 8-day gap between entry #432 (2026-03-07) and entry #433 (2026-03-15).
   No recorded work during this period. If a CMC or correspondence occurred, add the entry.

4. [Missing description] Entry #441 (1.0 hrs, 2026-03-12): description is blank.
```

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| **practice-data** | Gatekeeper — routes all entry and invoice reads through the `practice_data__*` tools. |
| **invoice-tracking** | Populates invoice header state. Run this before invoice-reviewing to ensure current data. |
| **retainer-tracking** | Not directly used, but both skills read matter data — no conflict. |
| **ar-follow-up** | Downstream consumer of invoice data; shares data source but different purpose. |

## Anti-Patterns

- **Writing to the DB** — this skill is read-only. Any write is a boundary violation.
- **Filtering anomalies by severity** — all flags go to the practitioner. Do not rank or suppress.
- **Omitting record IDs from flags** — "possible duration issue on April 18" is not actionable.
- **Proceeding without staleness check** — always surface data currency before presenting the checklist.
- **Treating absence of an invoice row as "no invoice"** — it means no data was imported. Say so.
- **Coercing NULL hours to 0** — NULL and zero are different signals; report both, filter both from calculations.
- **Running statistical checks when all entries have identical duration** — median is defined but outlier detection is meaningless; skip and note it.
- **Assuming a billing period when none is specified** — always derive or request it and state the source.
- **Embedding queries or opening the database directly** — all access goes through ``practice-data``.
- **Fabricating line-item or rate checks** — the cloud schema does not store them; report unsupported, do not reconstruct.
- **Parsing accounting CSVs directly** — data enters only through invoice-tracking.
- **Reporting "no issues" without listing what was checked** — the practitioner cannot assess whether the review was meaningful without knowing what was and wasn't verified.
