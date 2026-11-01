# Operation: reliance-verify

Read `../shared/conventions.md` first; derive the live `matter_root` per §2.2; halt on any tool error per §2.3. Every read runs through `matter_data__query`, every write through `matter_data__execute`, with `matter_root` on every call. `matter_data__execute` takes no bind parameters: each `:name` below is a SQL literal, every `'` doubled (§2.4).

A drafting skill checks the case-data facts a paragraph relies on, at the time it relies on them, with an isolated verifier that reads excerpts of each fact's sources. This operation serves that check twice: Step 1 gives the caller each fact as stored, and Steps 2 and 3 write back the verifier's answer on the extraction. Its answer on how the paragraph uses the fact is never written: it depends on the paragraph.

The apply rules are `../shared/verification-protocol.md`'s, narrowed to facts and to three answers. Positions, evidence links and missed rows are out of scope.

## Step 1 — The facts as stored

```sql
-- reliance: stored facts
SELECT f.fact_id, f.description, f.date_of_fact, f.source_locator,
       f.verified, f.human_reviewed, f.pending_reverification,
       s.file_path
FROM main.facts f
LEFT JOIN main.sources s ON s.source_id = f.source_id
WHERE f.fact_id IN (:fact_ids)
  AND f.description <> '';
```

Return each row to the caller. `check_extraction` is true only for `verified = 0` and `pending_reverification = 0`: a fact checked once is not checked again, and a fact at `verified = 2` waits for the practitioner. A fact this query does not return (a bare row, a pending row, an unknown id) is not checked: name it to the caller.

## Step 2 — Validate before any write

Validate the whole returned result against Step 1's snapshot. Reject it all, writing nothing, if an id is not in the snapshot, if an `extraction` is given for a fact whose `check_extraction` was false, if a `corrected` answer names a field other than `description`, `date_of_fact` or `source_locator`, if its `current` does not byte-match the stored value (JSON null matches only SQL `NULL`), or if a required `locator` or `reason` is absent. Answers on use are not validated here, because they are not written.

## Step 3 — Apply answer (i), one transaction

Apply every fact's extraction answer in one `matter_data__execute` call. Each statement's guard makes a stale or repeated apply change nothing. `human_reviewed` is never touched, and `sources.last_verified_at` is never stamped: an excerpt is not a re-read of the whole source.

```sql
-- reliance: confirmed
UPDATE main.facts SET verified = 1
WHERE fact_id = :fact_id AND verified = 0 AND pending_reverification = 0;
```

A correction to a fact no human has reviewed is applied in place and quarantined. The corrected row then waits in `@query_05d_pending_reverification` for `ingest-verify.md`'s corrected-row backlog, which checks the new value in a fresh session.

```sql
-- reliance: corrected
UPDATE main.facts
SET description    = CASE :field WHEN 'description'    THEN :proposed ELSE description    END,
    date_of_fact   = CASE :field WHEN 'date_of_fact'   THEN :proposed ELSE date_of_fact   END,
    source_locator = CASE :field WHEN 'source_locator' THEN :proposed ELSE source_locator END,
    verified = 0, pending_reverification = 1
WHERE fact_id = :fact_id AND verified = 0 AND pending_reverification = 0
  AND human_reviewed = 0
  AND CASE :field WHEN 'description'    THEN description
                  WHEN 'date_of_fact'   THEN date_of_fact
                  WHEN 'source_locator' THEN source_locator END IS :current;
```

An unresolved answer, and a correction to a human-reviewed fact, go to the practitioner's queue with one idempotent note. `:finding` is `<verdict> (<field>): "<current>" → "<proposed>" — <reason> [<locator>]`, the arrow part left out for an unresolved answer. The note is not a §5 prefix.

```sql
-- reliance: unresolved
UPDATE main.facts
SET verified = 2,
    notes = CASE WHEN instr(coalesce(notes, ''), :finding) > 0 THEN notes
                 WHEN notes IS NULL OR notes = ''
                      THEN 'RELIANCE CHECK ' || date('now','localtime') || ': ' || :finding
                 ELSE notes || char(10) || 'RELIANCE CHECK ' || date('now','localtime') || ': ' || :finding END
WHERE fact_id = :fact_id AND verified = 0 AND pending_reverification = 0;
```

## Step 4 — Report

Return to the caller, per fact: confirmed, corrected and quarantined, or sent to review, and every fact not written with the reason. Name no table, column or tool to the practitioner (`../../shared/internals-confidentiality.md`).
