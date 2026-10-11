# Operation: resolve-privilege (decide a pending privilege call)

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3. Every read below runs through `case_data__query` and every write through `case_data__execute`, with `matter_root` on every call. `case_data__execute` takes no per-statement `params` channel: inline every value as a SQL literal, single quotes doubled.

A main-store source with `privilege_status = 'pending'` is a document whose privilege call the practitioner has not made yet. It gets there two ways: `ingest-extract.md` Path B registered it when the practitioner answered "Unclear — decide later", or the v8.6 → v8.7 migration promoted a legacy `PRIVILEGE REVIEW PENDING…` note. While pending, its facts are held back from the drafting and evidence reads, it cannot be listed, and nothing may cite it as proof or as a party's position (`../references/design-decisions.md` #49). This operation takes **one** such document to a decision. The worklist is [`query.md`](query.md)'s `@query_28_pending_privilege_review`.

**The decision is the practitioner's, never yours** (decision #2: privilege turns on client intent and waiver). Auto mode, batch instructions, and a caller in a hurry do not waive the question in Step 3.

**Caller supplies:** one `source_id`. One document per run; for the next document, run the operation again.

---

## Step 1 — Load the source and refuse anything not pending

```sql
SELECT source_id, title, file_path, category, date, last_ingested_at, notes,
       privilege_status, listed, proceeding_id, file_hash, parent_source_id
FROM main.sources
WHERE source_id = ?1;
```

Refuse, with no write, when there is no row or when `privilege_status` is not `'pending'`. Say which: NULL means the source was never put in review, and `'cleared'` means the call is already made. Neither is this operation's to change.

## Step 2 — Count everything that references the source

```sql
SELECT
  (SELECT COUNT(*) FROM main.facts             WHERE source_id = ?1) AS facts,
  (SELECT COUNT(*) FROM main.evidence_links    WHERE source_id = ?1) AS evidence_links,
  (SELECT COUNT(*) FROM main.positions         WHERE source_id = ?1) AS positions,
  (SELECT COUNT(*) FROM main.admissions        WHERE source_id = ?1) AS admissions,
  (SELECT COUNT(*) FROM main.relief_items      WHERE source_id = ?1) AS relief_items,
  (SELECT COUNT(*) FROM main.relief_positions  WHERE source_id = ?1) AS relief_positions,
  (SELECT COUNT(*) FROM main.source_references
     WHERE source_id = ?1 OR target_source_id = ?1)                  AS source_references,
  (SELECT COUNT(*) FROM main.sought_orders     WHERE source_id = ?1) AS sought_orders,
  (SELECT COUNT(*) FROM main.witnesses         WHERE report_source_id = ?1) AS expert_reports,
  (SELECT COUNT(*) FROM main.causes_of_action  WHERE source_id = ?1) AS causes_of_action,
  (SELECT COUNT(*) FROM main.sources           WHERE parent_source_id = ?1) AS child_sources;
```

Count every row, closed and rejected ones included: each is a foreign key a delete would have to clear. Every column except `facts` is an **other reference**, and any non-zero other reference blocks the Privileged outcome in Step 4b.

Then read the facts for the presentation:

```sql
SELECT fact_id, source_locator, description, verified
FROM main.facts
WHERE source_id = ?1
ORDER BY fact_id;
```

## Step 3 — Show the document, then ask

Show the evidence itself, not a description of it. Before any question, render:

- `title`, `file_path`, `category`, the document's own `date`, and `last_ingested_at` (the date ingested);
- the full `notes` text, verbatim;
- the fact count, and the facts verbatim with their locators. Show them all when there are 12 or fewer. Otherwise show 12 spread across the document (the first, the last, and the rest evenly between in `fact_id` order), say how many are not shown, and show the rest on request;
- the Step 2 counts, naming every table with a non-zero other reference.

Give the `file_path` so the practitioner can open the document itself. Then ask, per `/show-me`, one plain-text question ending the turn, three options:

- **Cleared** — not privileged. The document stays in the main store.
- **Privileged** — the document moves to the privileged store.
- **Not yet** — leave it pending.

## Step 4a — Cleared

One `case_data__execute` call:

```sql
UPDATE main.sources
SET privilege_status = 'cleared',
    notes = <remaining notes as a literal, or NULL>
WHERE source_id = <source_id>
  AND privilege_status = 'pending';
```

`notes`: remove the leading pending-review statement (the `PRIVILEGE REVIEW PENDING…` text) and keep any other text verbatim, or NULL when nothing else remains. When the notes do not begin with such a statement, drop the `notes` assignment and leave them as they are. If it is not plain where that statement ends, show the proposed remaining text and ask before writing.

Nothing else changes. `listed` stays 0 (listing is [`../references/playbooks/lod-amendment.md`](../references/playbooks/lod-amendment.md)'s job), `category` stays, and the facts are untouched. The source's facts rejoin the drafting and evidence reads from this write on, and positions and evidence links may cite it again.

## Step 4b — Privileged

**First, the stop rule.** If Step 2 found any other reference, **stop**. Report each table and its row count to the practitioner and write nothing. Do not close, delete, or re-point those rows to clear the way: each one is a stance, a proof link, or a record someone relied on, and deciding what becomes of it is a separate instruction from the practitioner.

Otherwise ask with `AskUserQuestion` for the privileged category: `solicitor_client`, `privileged_correspondence`, `privileged_work_product`, or `other`. Then run **one** `case_data__execute` script, the four statements in this order:

```sql
-- 1. Register the document on the privileged side, recording its lineage.
INSERT INTO privileged.privileged_sources
  (proceeding_id, category, title, description, date, file_path, file_hash,
   verified, notes)
SELECT proceeding_id, '<privileged_category>', title, description, date,
       file_path, file_hash, verified,
       'Re-homed from main.sources source_id <source_id> on '
         || date('now','localtime')
         || ' after privilege review; formerly category ' || category
FROM main.sources
WHERE source_id = <source_id>
  AND privilege_status = 'pending';

-- 2. Each fact keeps where it was learned, as privileged provenance. The new
--    privileged row is found by its lineage note; MAX picks this run's row if
--    an earlier re-home reused the same main source_id. Statements 1-4 each
--    re-check that the source is still pending, so if another session decided
--    it after Step 1, the whole script is a no-op.
INSERT INTO privileged.fact_provenance
  (fact_id, source_id, source_locator, verified)
SELECT f.fact_id,
       (SELECT MAX(ps.source_id) FROM privileged.privileged_sources ps
        WHERE ps.notes LIKE 'Re-homed from main.sources source_id <source_id> on %'),
       f.source_locator,
       f.verified
FROM main.facts f
WHERE f.source_id = <source_id>
  AND EXISTS (SELECT 1 FROM main.sources
              WHERE source_id = <source_id> AND privilege_status = 'pending');

-- 3. The facts stay in main, cut loose from the main-store source.
UPDATE main.facts
SET source_id = NULL, source_locator = NULL
WHERE source_id = <source_id>
  AND EXISTS (SELECT 1 FROM main.sources
              WHERE source_id = <source_id> AND privilege_status = 'pending');

-- 4. The document leaves the non-privileged store.
DELETE FROM main.sources
WHERE source_id = <source_id>
  AND privilege_status = 'pending';
```

Never set `human_reviewed`, and never change a fact's `verified` value: the provenance row copies it. Afterwards, confirm with `case_data__query` that the `main.sources` row is gone and that the new privileged source has one `fact_provenance` row per re-homed fact. Do this before any retry (conventions §2.3).

**Why the main row is deleted, when promotion never deletes.** Decision #1 keeps the main store for non-privileged sources only, and a practitioner has now decided this one is privileged. Decision #3's "promotion never deletes" governs the opposite direction, privileged to producible. There the privileged row is the permanent record of how a document was once treated. A pending main row is a holding state, not such a record. A tombstone left behind would keep a privileged document registered on the non-privileged side, and every reader would have to exclude it forever. The lineage survives on the privileged side instead, in the new row's `notes` and in the matching `file_hash`.

## Step 4c — Not yet

No write. The source stays pending and stays held back from the drafting and evidence reads. It remains on `@query_28`.

## Step 5 — Report

Report identifiers and counts only: the `source_id`, the outcome, and for Privileged the new privileged `source_id` and the number of facts re-homed (or, on a stop, each blocking table and its count). After a Privileged outcome, never copy the title, the notes, or any fact text into the report. `case_data__execute` regenerates `evidence.sql` on success, so there is no separate dump step.
