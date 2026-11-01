---
name: invoice-tracking
disable-model-invocation: true
description: Import invoice CSV exports (LEAP, PCLaw, Clio, UNITY, etc.) and store normalized invoice state in the practice database. Use when an invoice export CSV is uploaded or mentioned, to import or update invoice records, or to ask which matters have outstanding invoices. Stores state only; performs no billing-period reasoning.
---

<!-- lawyer v0.17.3 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Scope | Always |
| Consumer Contract | Reading invoice data, or changing a column or its meaning |
| Import Workflow | The practitioner provides an invoice CSV, or a first-ever import has no mapping |
| Queries | The practitioner asks about outstanding invoices, balances or import dates |
| Integration with Other Skills | Before handing work to another skill |
| Anti-Patterns | Always |

# Invoice Tracking

Infrastructure skill — owns the invoice data layer. Ingests invoice CSV exports from the user's practice management system, normalizes invoice state, and stores it in the shared practice database via ``practice-data``. Downstream skills consume this data; none maintain their own copy.

## Scope

This skill tracks **current invoice state only**: invoice number, issue date, amount, amount paid, and status per matter. It does not generate invoices, flag overdue accounts, evaluate billing rates, or make any recommendations — those belong to other skills (invoice-reviewing, ar-follow-up, wip-tracker).

CSV parsing and column mapping live here; all database access goes through ``practice-data``. This skill never touches the database directly.

## Consumer Contract

Downstream skills depend on these field names and semantics. Renaming a field or changing its meaning is a breaking change.

| Field | Item kind | Guarantee |
|-------|-------|-----------|
| `matter_id` | invoice | The `id` of the invoice's matter item — an internal item key, never displayed. Not the matter number; the CSV's `matterID` column maps to the matter's `matt_num` instead. |
| `invoice_number` | invoice | Raw value from accounting system; may be NULL if export doesn't include it |
| `issue_date` | invoice | ISO 8601 date string, or NULL if not in export |
| `date_to` | invoice | ISO 8601 date string — the billing-period end date, when the source export has one; NULL when it doesn't. On re-import, a row that omits this field leaves the stored value untouched (absence of the column isn't evidence the billed period changed); an explicit `null` clears it. |
| `amount` | invoice | Total invoice amount as a positive number; never NULL, never negative |
| `amount_paid` | invoice | Amount received against this invoice; NULL = source didn't provide this column; 0 = confirmed nothing paid |
| `status` | invoice | Normalized to lowercase; raw value from source — not interpreted by this skill |
| `last_import_at` | invoice | ISO 8601 datetime when this invoice was last written |

**Absence semantics:** No invoice for a matter ≠ no outstanding invoices. It means invoice data has not been imported for that matter. Downstream skills must not treat absence as "paid in full."

**Stale data:** Before acting on invoice data, downstream skills should check `last_import_at`. If the most recent `last_import_at` across all invoices is more than 7 days old, surface: "Invoice data last imported [date]. Results may not reflect recent payments."

**Known status vocabulary:** Accounting systems use varied status labels. Values observed in the wild include: `outstanding`, `paid`, `partial`, `void`, `voided`, `written_off`, `write-off`, `credited`. This list is informational — the skill stores whatever string the source provides (normalized to lowercase). Downstream skills are responsible for deciding which statuses represent AR exposure.

## Import Workflow

When the user provides an invoice CSV:

1. Check `probanda.json` for `accounting.invoice_mapping` (path resolution and config live in ``practice-data``).
2. **If `invoice_mapping` is missing:** run the **First Import Protocol** below, then continue from step 3.
3. Load column mapping from `accounting.invoice_mapping`.
4. Parse the CSV with Python's `csv` module using the confirmed mapping. Build one normalized row object per CSV line with these keys:
   - `matt_num` — the mapped matter value (matches the matter's `matt_num` / `file_number`)
   - `invoice_number` — mapped value, or omit/`null` if the export has no invoice-number column
   - `issue_date`, `date_to` (billing-period end — omit the key entirely if the export has no such column; do not send `null` unless you mean to clear a previously-stored value), `amount` (number), `amount_paid` (number or omit), `status` (raw string — the tool lowercases it)
5. Hand the full array of normalized rows to ``practice-data`` `import-invoices` in a single call. The tool performs matter-matching, skips and separately counts negative amounts (credit notes) and unmatched matters, dedups NULL-invoice-number rows per matter, lowercases `status`, and stamps `last_import_at`. It returns `{ imported, skipped_no_matter, skipped_negative, not_saved, questions }`: `not_saved` counts rows Probanda's Cloud did not save, and `questions` holds its question for each refused matter.
6. Report from the tool's return: rows imported, rows skipped (no matter match), rows skipped (credit notes/negative amount), and rows not saved (`not_saved`), relaying each of `questions` to the practitioner as it stands. For an outstanding count, call ``practice-data`` `invoice-data` and count rows whose `status` is not one of `paid`, `void`, `voided`, `written_off`, `write-off`, `credited` — computed skill-side over the returned rows.
7. If `skipped_no_matter` exceeds 20% of the CSV rows, warn the user: "N rows had no matching matter in the database — verify that matter numbers in the CSV match the matters' `matt_num`."

**Credit notes / negative amounts:** Some systems export credits as negative-amount invoices. The tool skips these (they would break the positive-`amount` contract) and reports them in `skipped_negative`. Surface that count as "N rows skipped — negative amounts (credit notes) are not supported."

**Cutoff-regression confirmation:** `import-invoices` refuses the whole import (no rows written) if it would move any matter's effective billing cutoff *backward* — a `date_to` correction to an earlier date, most often. It returns/throws naming every regressed matter with its old and new cutoff dates rather than the usual result shape. When this happens: tell the practitioner exactly which matter(s) regressed and the two dates, and ask — "Has the Solicitor Client folder been searched for evidence of a more-recently-sent bill for this file?" Only on an affirmative answer, re-invoke `import-invoices` with `confirm_regression: true` on the same rows. A *forward* cutoff move never triggers this — a fresh invoice import is itself the evidence — and neither does a matter's first-ever import.

### First Import Protocol

When `accounting.invoice_mapping` is absent:

1. Ask the user what accounting system they use (if not already in `accounting.system`). Write it back to `probanda.json`.
2. Show the user a sample of the CSV headers (first row).
3. Ask the user to confirm which column maps to each required field:

   | Internal field | Meaning |
   |---|---|
   | `matterID` | Matter or file number matching the matter's `matt_num` |
   | `invoiceNumber` | Invoice identifier (mark as `null` if absent) |
   | `issueDate` | Date invoice was sent |
   | `dateTo` | Billing-period end date (mark as `null` if the export has no such column) |
   | `amount` | Total invoice amount |
   | `amountPaid` | Amount paid to date (mark as `null` if absent) |
   | `status` | Invoice status (e.g. outstanding, paid, partial) |

4. Confirm the date format (e.g. `YYYY-MM-DD`, `MM/DD/YYYY`).
5. Write the confirmed mapping to `probanda.json` under `accounting.invoice_mapping`:

```json
"invoice_mapping": {
  "csv_report_name": "<name of the invoice listing report>",
  "date_format": "<date format>",
  "column_map": {
    "matterID": "<column name>",
    "invoiceNumber": "<column name or null>",
    "issueDate": "<column name>",
    "dateTo": "<column name or null>",
    "amount": "<column name>",
    "amountPaid": "<column name or null>",
    "status": "<column name>"
  }
}
```

6. Confirm with the user before proceeding to import.

## Queries

All queries route through ``practice-data`` `invoice-data` (`practice_data__invoices_query`), which returns invoice rows (optionally filtered by matter or status) plus the latest `last_import_at`. Compute any aggregation skill-side over the returned rows.

| Question | Action |
|---|---|
| Which matters have outstanding invoices? | `invoice-data` for all matters; keep rows whose `status` is not a closed status (`paid`, `void`, `voided`, `written_off`, `write-off`, `credited`); group by matter and sum `amount − COALESCE(amount_paid, 0)`. Surface `last_import_at` if stale. |
| What invoices are on file [matter]? | `invoice-data` with the matter ref; order the returned rows by `issue_date`. |
| What is the outstanding balance for [matter/client]? | `invoice-data` with the matter ref; sum `amount − COALESCE(amount_paid, 0)` over non-closed statuses. |
| When were invoices last imported? | The `last_import_at` value returned by `invoice-data`. |
| Import this invoice CSV | Run the import workflow above. |

**Note on `amount_paid`:** When the source doesn't include a payment column, `amount_paid` is NULL. Treating NULL as zero (for an outstanding-balance sum) means no payment recorded, not confirmed unpaid. Downstream skills should be aware that an outstanding balance may overstate exposure when `amount_paid` is not tracked.

## Integration with Other Skills

| Skill | Relationship |
|---|---|
| **practice-data** | Gatekeeper — routes all invoice reads/writes to the `practice_data__*` tools. |
| **ar-follow-up** | Reads invoice data to include outstanding amounts in the AR list |
| **invoice-reviewing** | Reads invoice data to cross-reference against draft billing |
| **retainer-tracking** | Parallel data layer — trust balances and invoice state are separate imports |

## Anti-Patterns

- **Flagging or prioritizing invoices** — this skill stores; ar-follow-up interprets
- **Generating or drafting invoices** — data enters only via user-exported CSV
- **Treating absence as paid** — no row for a matter = no data, not zero balance
- **Treating NULL `amount_paid` as zero** without noting the distinction to consumers
- **Embedding queries, schema, or direct database access** in this skill — all practice DB access goes through ``practice-data``
- **Serving stale data silently** — always surface `last_import_at` to downstream skills when it exceeds 7 days
- **Bypassing the column mapping** — never hardcode column names; source format varies by accounting system
- **Filtering write-offs or voids before storing** — status semantics belong to downstream consumers, not here
- **Storing negative amounts** — credit notes from accounting systems must be skipped, not inverted
