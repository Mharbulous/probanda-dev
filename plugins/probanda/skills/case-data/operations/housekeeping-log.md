# Operation: housekeeping-log

Read [`../shared/conventions.md`](../shared/conventions.md) first — every call passes `matter_root` per §2.2; halt on any tool error.

The **housekeeping review log** records the verdict `/housekeeping` reached on each file it handled, so a later run does not reopen a settled file, and it remembers an ingest that failed, so a later run neither retries it forever nor forgets why it failed. This is operational run-state, not case data — see [`../references/design-decisions.md`](../references/design-decisions.md) #26 for why it lives in `main.sqlite` anyway and what that does and does not license.

Three modes. The caller names one.

| Mode | Caller intent |
|---|---|
| `lookup` | "What does the log hold for these files?" — before building a work list |
| `record` | "These files were applied" or "this ingest failed" — after the fact |
| `retry` | "Try reading these failed files again next run" |

**The caller never sees a table name, a column name, or SQL.** It hands over files as `{file_name, file_hash}` and gets back verdicts, or hands over closed outcomes and gets back a count. Everything below the interface is this file's.

## Outcomes

| `outcome` | Written when | Settles |
|---|---|---|
| `renamed` | an approved move was applied: rename and file, rename in place, a same-matter move, or a root file filed under its current name | the name arm |
| `manual_review` | a subfolder file's "keep the current name" was approved. Legacy rows keep their meaning | the name arm |
| `not_ingested` | the practitioner approved filing the file without ingesting it | the name arm, and the ingest arm by hash |
| `ingest_failed` | an ingest of the file failed | nothing: it only schedules retries and supplies the reason |

`declined` is legacy. The CHECK still admits it so the v8.8 migration rewrote no row, but nothing writes it and it settles nothing.

A file's settled verdict is a matching row with `renamed`, `manual_review` or `not_ingested`. The **name arm** asks whether the file's name was settled, and matches on hash or name. The **ingest arm** asks whether the file was filed without ingesting, and matches on hash only.

---

## Mode `lookup`

**Input:** a list of candidate files, each `{file_name, file_hash}`: the basename as it stands on disk now, and the lowercase hex SHA-256 of the file's raw bytes.

**Output, per candidate:**

| Field | Meaning |
|---|---|
| `reviewed` | true when a matching row holds a settled verdict (the name arm) |
| `outcome`, `reviewed_at`, `matched_on` | with `reviewed`: the settled row's outcome and date, and which key matched (`hash` or `name`). A hash match is reported in preference to a name match |
| `not_ingested` | true when a `not_ingested` row matches **by hash** (the ingest arm) |
| `ingest_failure` | from an `ingest_failed` row matching by hash, the newest by `reviewed_at`: `{reason, failure_class, retry_next_run, reviewed_at}`; otherwise null |

A candidate matches a row on either key: the name it carries now, or the hash of its bytes.

- The **name** match is the cheap path: the file is exactly as housekeeping left it.
- The **hash** match is the rename-proof path: a human renamed the file after housekeeping settled it, so the name no longer matches, but the bytes do. Without it, every manual rename would buy a full re-review of a file already judged.

`ingest_failure` settles nothing. It matters only while the file is not ingested, and it tells the caller two things: an ingest is attempted automatically only when `retry_next_run` is 1, and otherwise the file goes straight to the practitioner with the stored `reason`.

Run one `case_data__query` for the whole batch — never one call per file:

```sql
-- housekeeping-log lookup
SELECT file_hash, file_name, folder_type, outcome, reviewed_at,
       reason, failure_class, retry_next_run
FROM housekeeping_reviews
WHERE file_hash IN (<hash placeholders>)
   OR file_name IN (<name placeholders>)
```

Bind both lists through `params`, then join the result back to the candidates in the calling session by the rules above.

If the log is empty — a matter housekeeping has never run against — the query returns no rows and every candidate is `reviewed: false` with no failure. That is the normal first run, not an error; say so plainly rather than reporting a problem.

## Mode `record`

`case_data__execute` takes no bind parameters: each named value below reaches the script as a SQL literal (a text value quoted with every `'` doubled, NULL unquoted). One `case_data__execute` call for the whole batch, per conventions §2.3; one statement per row.

### Settled verdicts

**Input:** a list of `{file_name, file_hash, folder_type, outcome}`, `outcome` one of `renamed`, `manual_review`, `not_ingested`.

| Field | Meaning |
|---|---|
| `file_name` | the basename the file carries **after** the apply: the new name when a rename was applied, the current name otherwise |
| `file_hash` | SHA-256 of the file's raw bytes, lowercase hex (a rename does not change it) |
| `folder_type` | the housekeeping folder type of the folder the file now sits in, e.g. `Correspondence`, `Law`, `Court File` |
| `outcome` | the verdict |

```sql
-- housekeeping-log record: settled verdict
INSERT INTO housekeeping_reviews
    (file_hash, file_name, folder_type, outcome, reviewed_at,
     reason, failure_class, retry_next_run)
VALUES (:file_hash, :file_name, :folder_type, :outcome, date('now','localtime'),
        NULL, NULL, NULL)
ON CONFLICT (file_hash, file_name) DO UPDATE SET
    folder_type    = excluded.folder_type,
    outcome        = excluded.outcome,
    reviewed_at    = excluded.reviewed_at,
    reason         = NULL,
    failure_class  = NULL,
    retry_next_run = NULL;
```

Record only what was applied. A row the practitioner left unticked writes nothing and surfaces again next run. **A rename or move that was attempted and failed** (a name collision, a locked file) is not recorded either: the file is still where it was, and recording it would hide it.

### Ingest failures

**Input:** a list of `{file_name, file_hash, folder_type, reason, failure_class}`: `folder_type` of the folder holding the file, or NULL for a file at the matter root; `reason` one sentence saying what failed; `failure_class` `deterministic` (the file cannot be read this way at all: a render failure, an RTF `.doc` included) or `extractor` (the reader failed: unavailable, malformed output, a validation abort).

```sql
-- housekeeping-log record: ingest failure
INSERT INTO housekeeping_reviews
    (file_hash, file_name, folder_type, outcome, reviewed_at,
     reason, failure_class, retry_next_run)
VALUES (:file_hash, :file_name, :folder_type, 'ingest_failed', date('now','localtime'),
        :reason, :failure_class,
        CASE WHEN :failure_class = 'extractor'
              AND NOT EXISTS (SELECT 1 FROM housekeeping_reviews
                              WHERE file_hash = :file_hash
                                AND outcome = 'ingest_failed')
             THEN 1 ELSE 0 END)
ON CONFLICT (file_hash, file_name) DO UPDATE SET
    folder_type    = excluded.folder_type,
    outcome        = 'ingest_failed',
    reviewed_at    = excluded.reviewed_at,
    reason         = excluded.reason,
    failure_class  = excluded.failure_class,
    retry_next_run = excluded.retry_next_run;
```

**The retry counting rule.** On a file's first failure (no `ingest_failed` row for its hash yet), `retry_next_run` is 1 for an extractor failure, which buys exactly one automatic retry on the next run, and 0 for a deterministic one, which is never retried automatically. On any later failure it is 0. Changed bytes are a new hash, so an edited file starts again at its first failure.

The upsert on `(file_hash, file_name)` means a later verdict on an unchanged file under the same name overwrites the earlier one rather than accumulating rows, while the same bytes under a different name stay a distinct row — which is what makes a copy of one document filed in two folders reviewable in each.

## Mode `retry`

**Input:** a list of `file_hash` values: the practitioner ticked "try reading again next run" on these failed files. One `case_data__execute` call, one statement per hash:

```sql
-- housekeeping-log retry
UPDATE housekeeping_reviews SET retry_next_run = 1
WHERE file_hash = :file_hash AND outcome = 'ingest_failed';
```

It buys one attempt: a failure on that attempt records `retry_next_run = 0` again. Nothing else changes, and nothing moves.

`case_data__execute` regenerates `evidence.sql` as a side effect, so the log survives into the durable text dump like every other table. Do not dump separately.

## What this operation does not do

- It does not compute hashes. The caller supplies them; hashing is a filesystem concern and belongs on the caller's side of the seam.
- It does not decide what a verdict means for the caller's workflow — it reports matches and lets the caller act.
- It does not rename, move, or open any file, and it never touches `sources`. A housekeeping review is not an ingestion, and a reviewed file is not a source.
- It records no pending order-effects, linkage or date-anchor work. Those markers live in the source's `notes` (conventions §11), never in this log.
