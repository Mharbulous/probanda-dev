# Operation: procedural-directions

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and halt on any tool error per §2.3.

Lists the directions and orders of the forum on record for one proceeding, newest first, for a caller that must see them before relying on a procedural step. It writes nothing and interprets nothing. Decision #78.

A direction is a `procedural` `source_references` row whose `description` starts `DIRECTION:` and carries the author and the operative sentence verbatim (`../agents/extract-facts.md`). Its date, proceeding and file are its source's. A source linked to no proceeding is included, because forum correspondence is often unlinked, and comes back with `proceeding_id` NULL so the caller can say so. `ORDER-EFFECT:` audit rows (`order-effects.md`) carry a different marker and never match. Sources with no date come last. Within one source the sentences keep document order.

## Read

Resolve the caller's file number to its `proceeding_id` ([`proceedings-profile.md`](proceedings-profile.md) §1), then run this in one `matter_data__query` call with `params: [<proceeding_id>]`:

```sql
SELECT
    s.date               AS direction_date,
    sr.description,
    sr.source_locator,
    sr.verified,
    s.source_id,
    s.title              AS source_title,
    s.category,
    s.file_path,
    s.proceeding_id
FROM source_references sr
JOIN sources s ON s.source_id = sr.source_id
WHERE sr.reference_type = 'procedural'
  AND substr(sr.description, 1, 10) = 'DIRECTION:'
  AND (s.proceeding_id = ?1 OR s.proceeding_id IS NULL)
ORDER BY s.date IS NULL, s.date DESC, s.source_id DESC, sr.source_reference_id;
```

Return every row as the query gives it, the `description` byte for byte. No row is not an error: say that no direction is on record for the proceeding.
