# Operation: ingest-status

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

Read-only and batched. For a list of files, each named by its path and the SHA-256 of its bytes, report whether the case database already holds the file and what it stores about it. **This operation writes nothing.** The housekeeping review log is a separate call ([`housekeeping-log.md`](housekeeping-log.md), mode `lookup`).

[`../references/scripts/housekeeping_lookup.py`](../references/scripts/housekeeping_lookup.py) runs this operation host-side for the review log's work-list caller (design-decisions #73), executing this file's own fenced code; it is not a model-facing tool.

A file is **ingested** when its hash matches one of:

1. a top-level `main.sources` row with `ingestion_status = 'complete'`, or with `ingestion_status` NULL and at least one child row (the gate's rule, [`ingest.md`](ingest.md) Step 4);
2. a `privileged.privileged_sources` row;
3. a `law.authorities` row. A second file of an authority that was read by reference carries the verdict `ingested_by_reference` instead: its hash sits in the authority's `[SECOND-COPY:<sha256>]` marker (conventions §11).
4. an email attachment that was read through: a `main.sources` child row with no `file_path`, `ingestion_status = 'complete'`, and no top-level row with the hash. A standalone copy of the attachment, filed beside its email, carries the verdict `ingested_by_reference`: the attachment row is its record, and the file has no row of its own (design-decisions #54). An attachment that was not read through is no record of the file.
5. a top-level `main.sources` row carrying `[SUPERSEDED-BY:#<id>`, whatever its status: the file is an earlier version of source `<id>`, which [`supersede-draft.md`](supersede-draft.md) kept as the source of record. Its verdict is `superseded`, and it counts as held.

`partial`, `failed`, a NULL status with no child rows, and no row at all are not ingested. Verification is not required: a `verified = 0` row counts.

---

## Input

| Field | Meaning |
|---|---|
| `matter_root` | the live host path of the matter folder (conventions §2.2) |
| `matter_folder` | the same folder as this session's filesystem sees it: the mounted folder in a Cowork session, `matter_root` itself in a local session. Used only in Step 2, to look at a stored path on disk |
| `files` | an ordered list of `{path, hash}`. `path` is in the stored form (conventions §2.4); `hash` is the lowercase hex SHA-256 of the file's raw bytes. The order is the caller's work-list order, and it decides which of two identical files is the copy |

## Output, one entry per file, in input order

| Field | Meaning |
|---|---|
| `path`, `hash` | echoed from the input |
| `verdict` | `ingested`, `ingested_by_reference`, `superseded`, `partial`, `failed` or `none` |
| `store` | `main`, `privileged` or `law`: the store of the record that decided the verdict. Null when no record matched |
| `source_ids` | the ids of the records that decided the verdict in that store: top-level ids (`main.sources.source_id`, `privileged_sources.source_id` or `authorities.authority_id`), or for a copy of an email attachment the attachment row's `source_id`. A book of authorities has one id per bundled authority |
| `stored_path` | the deciding record's `file_path`, exactly as stored. Null for a copy of an email attachment |
| `moved` | true when the stored path names another place and no file with this hash is there: the file was moved by hand. The verdict stands; [`relocate-source.md`](relocate-source.md) repairs the stored path when the caller files the file |
| `duplicate_of` | set when this file is a copy of another file (Step 2): the other copy's path, in stored form. The verdict is then `none`, and the file is never re-pointed |
| `twin_ingested` | with `duplicate_of`: whether the other copy counts as ingested (its verdict is `ingested`, `ingested_by_reference` or `superseded`) |
| `pending` | the pending markers on the deciding record (conventions §11): `order_effects`, `linkage`, `date_anchor`, `supersede` on a main source, `treatment` on an authority, or empty |
| `possible_version_of` | with `supersede` in `pending`: the id of the source the `SUPERSEDE-PENDING:` marker names, which may be another version of this file. Where the row carries several such markers, the first in its notes. Null with no marker. Read from the marker only, never from a free-text note |
| `superseded_by` | with `superseded`: the id of the source kept in its place |
| `move_pending` | with `superseded`: true when the row's stored path lies outside `0. DRAFT*\Superseded\`, so the move [`supersede-draft.md`](supersede-draft.md) §6 makes did not happen. The attended gate and folder scan offer it again (§6c); this operation, like every unattended path, only reports it |
| `metadata` | the stored fields a naming-evidence block is built from. Main: `title`, `description`, `category`, `date`, `execution_status`, `filed_by`, and the linked proceeding's `file_number`, `court` and `registry`. Privileged: `title`, `description`, `category`, `author`, `recipient`, `date`. Law: `title`, `citation`, `authority_type`, `jurisdiction` |
| `merged_into` | law only: the canonical authority's id when the matched row is a merge tombstone ([`merge-authorities.md`](merge-authorities.md)) |
| `anomaly` | `more than one top-level source`: data corruption ([`ingest.md`](ingest.md) Step 3). The verdict is `none`, and nothing ingests the file until a separate matter-scoped instruction repairs it |

---

## Step 1 — Probe every store in one query

One `matter_data__query` call for the whole list. Its one parameter is a JSON array of the files' hashes, in input order:

```sql
-- ingest-status probe
WITH c(ord, hash) AS (
    SELECT CAST(key AS INTEGER), value FROM json_each(?)
)
SELECT c.ord, 'main' AS store, s.source_id AS id, s.parent_source_id,
       s.file_path, s.ingestion_status,
       (SELECT count(*) FROM main.facts WHERE source_id = s.source_id)
     + (SELECT count(*) FROM main.positions WHERE source_id = s.source_id)
     + (SELECT count(*) FROM main.relief_items WHERE source_id = s.source_id)
     + (SELECT count(*) FROM main.relief_positions WHERE source_id = s.source_id)
     + (SELECT count(*) FROM main.source_references WHERE source_id = s.source_id)
     + (SELECT count(*) FROM main.witnesses WHERE report_source_id = s.source_id)
         AS child_rows,
       instr(coalesce(s.notes, ''), 'ORDER-EFFECTS-PENDING:') > 0 AS order_effects_pending,
       instr(coalesce(s.notes, ''), 'LINKAGE-PENDING:') > 0 AS linkage_pending,
       instr(coalesce(s.notes, ''), 'DATE-ANCHOR-PENDING:') > 0 AS date_anchor_pending,
       instr(coalesce(s.notes, ''), 'SUPERSEDE-PENDING:') > 0 AS supersede_pending,
       0 AS treatment_pending,
       0 AS second_copy,
       NULL AS merged_into,
       CASE WHEN instr(coalesce(s.notes, ''), '[SUPERSEDED-BY:#') > 0
            THEN CAST(substr(s.notes, instr(s.notes, '[SUPERSEDED-BY:#') + 16) AS INTEGER)
       END AS superseded_by,
       CASE WHEN instr(coalesce(s.notes, ''), 'SUPERSEDE-PENDING: possible other version of source #') > 0
            THEN CAST(substr(s.notes, instr(s.notes, 'SUPERSEDE-PENDING: possible other version of source #') + 53) AS INTEGER)
       END AS supersede_pending_of,
       json_object('title', s.title, 'description', s.description,
                   'category', s.category, 'date', s.date,
                   'execution_status', s.execution_status, 'filed_by', fp.name,
                   'file_number', pr.file_number, 'court', pr.court,
                   'registry', pr.registry) AS metadata
FROM c
JOIN main.sources s ON s.file_hash = c.hash
LEFT JOIN main.parties fp ON fp.party_id = s.filed_by_party_id
LEFT JOIN main.proceedings pr ON pr.proceeding_id = s.proceeding_id
UNION ALL
SELECT c.ord, 'privileged', p.source_id, NULL, p.file_path, NULL,
       (SELECT count(*) FROM privileged.fact_provenance WHERE source_id = p.source_id)
     + (SELECT count(*) FROM privileged.client_instructions
        WHERE source_id = p.source_id AND valid_to IS NULL),
       0, 0, 0, 0, 0, 0, NULL, NULL, NULL,
       json_object('title', p.title, 'description', p.description,
                   'category', p.category, 'author', p.author,
                   'recipient', p.recipient, 'date', p.date)
FROM c
JOIN privileged.privileged_sources p ON p.file_hash = c.hash
UNION ALL
SELECT c.ord, 'law', a.authority_id, NULL, a.file_path, NULL, NULL, 0, 0, 0, 0,
       instr(coalesce(a.notes, ''), '[TREATMENT-PENDING:') > 0,
       coalesce(a.file_hash, '') <> c.hash,
       CASE WHEN a.notes LIKE '[MERGED-INTO:#%'
            THEN CAST(substr(a.notes, 15, instr(substr(a.notes, 15), ' ') - 1) AS INTEGER)
       END,
       NULL, NULL,
       json_object('title', a.title, 'citation', a.citation,
                   'authority_type', a.authority_type,
                   'jurisdiction', a.jurisdiction)
FROM c
JOIN law.authorities a
  ON a.file_hash = c.hash
  OR instr(coalesce(a.notes, ''), '[SECOND-COPY:' || c.hash || ']') > 0
ORDER BY 1, 2, 3;
```

The query returns the facts; Step 2 decides the verdicts.

## Step 2 — Decide each verdict, and tell a copy from a moved file

Run `ingest_status` below over the input and the query's rows. It is local processing, like the hash step of [`ingest.md`](ingest.md): it reads files under `matter_folder` and touches no database. It applies these rules in order:

1. **Per store.** A main top-level row carrying `[SUPERSEDED-BY:#` is `superseded`, whatever its status, and `move_pending` when its stored path lies outside `0. DRAFT*\Superseded\`. Any other main top-level row: `complete`, or NULL with child rows, is `ingested`; `partial` and `failed` are themselves; NULL with no child rows is `none`. Child rows that carry a path (an affidavit's exhibits, a book's children) are never anchors. With no main top-level row, an email attachment (a child row with no path whose parent is not itself a matching row, so an attached affidavit is named by its own row and not by its exhibits) that was read through (`complete`) is `ingested_by_reference`; one not read through is ignored, and the file is read afresh (design-decisions #54). A privileged row is `ingested`. A law row matched by its own hash is `ingested`; one matched only by a `[SECOND-COPY:]` marker is `ingested_by_reference`.
2. **Best store wins**, in the order `ingested`, `ingested_by_reference`, `superseded`, `partial`, `failed`, `none`. A promoted document matches both main and privileged (design decision #3), and either makes it ingested.
3. **Copy or the same file?** When the deciding record's stored path names another place than the file's own path, look there on disk. A file with this hash still at the stored path means this file is a **copy**: verdict `none`, `duplicate_of` the stored path, never re-pointed. Nothing with this hash at the stored path means the file was **moved by hand**: the verdict stands and `moved` is true. A read by reference, an authority's second copy or an email attachment's copy, has no stored path of its own and skips this test.
4. **Two identical files in the list.** Among the files that share a hash and are not already copies, the first in list order keeps its verdict and each later one is a copy of it (`duplicate_of` the first file's path).

```python
import hashlib, json, os, re

RANK = ('ingested', 'ingested_by_reference', 'superseded', 'partial', 'failed', 'none')
HELD = ('ingested', 'ingested_by_reference', 'superseded')


def ingest_status(files, rows, matter_root, matter_folder):
    def in_superseded_folder(stored):
        parts = stored.split('\\')
        return len(parts) > 2 and re.match(r'0\. DRAFT', parts[0], re.I) and parts[1].lower() == 'superseded'

    def sha256_at(stored):
        full = (stored if os.path.isabs(stored)
                else os.path.join(matter_folder, *stored.split('\\')))
        if not os.path.isfile(full):
            return None
        h = hashlib.sha256()
        with open(full, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b''):
                h.update(chunk)
        return h.hexdigest()

    results = []
    for i, f in enumerate(files):
        recs = [r for r in rows if r['ord'] == i]
        out = {'path': f['path'], 'hash': f['hash'], 'verdict': 'none',
               'store': None, 'source_ids': [], 'stored_path': None,
               'moved': False, 'duplicate_of': None, 'twin_ingested': None,
               'pending': [], 'metadata': None, 'merged_into': None,
               'superseded_by': None, 'move_pending': False, 'anomaly': None,
               'possible_version_of': None}
        results.append(out)
        tops = [r for r in recs if r['store'] == 'main' and r['parent_source_id'] is None]
        if len(tops) > 1:
            out['anomaly'] = 'more than one top-level source'
            continue
        found = []
        for r in tops:
            status = r['ingestion_status']
            if r['superseded_by'] is not None:
                found.append(('superseded', r))
            elif status == 'complete' or (status is None and r['child_rows'] > 0):
                found.append(('ingested', r))
            elif status in ('partial', 'failed'):
                found.append((status, r))
            else:
                found.append(('none', r))
        if not tops:
            ids = {r['id'] for r in recs if r['store'] == 'main'}
            for r in recs:
                if (r['store'] == 'main' and r['parent_source_id'] not in (None, *ids)
                        and r['file_path'] is None and r['ingestion_status'] == 'complete'):
                    found.append(('ingested_by_reference', r))
        for r in recs:
            if r['store'] == 'privileged':
                found.append(('ingested', r))
            elif r['store'] == 'law':
                found.append(('ingested_by_reference' if r['second_copy'] else 'ingested', r))
        if not found:
            continue
        verdict, rec = min(found, key=lambda vr: RANK.index(vr[0]))
        out.update(
            verdict=verdict, store=rec['store'],
            source_ids=[r['id'] for v, r in found if v == verdict and r['store'] == rec['store']],
            stored_path=rec['file_path'], merged_into=rec['merged_into'],
            superseded_by=rec['superseded_by'], metadata=json.loads(rec['metadata']),
            possible_version_of=rec['supersede_pending_of'],
            pending=[name for name, key in (('order_effects', 'order_effects_pending'),
                                            ('linkage', 'linkage_pending'),
                                            ('date_anchor', 'date_anchor_pending'),
                                            ('supersede', 'supersede_pending'),
                                            ('treatment', 'treatment_pending')) if rec[key]])
        if verdict == 'ingested_by_reference':
            continue
        stored = stored_form(rec['file_path'], matter_root) if rec['file_path'] else None
        if stored is None or stored.lower() != f['path'].lower():
            if stored is not None and sha256_at(stored) == f['hash']:
                out.update(verdict='none', duplicate_of=stored,
                           twin_ingested=(verdict in HELD))
            else:
                out['moved'] = True
        out['move_pending'] = bool(out['verdict'] == 'superseded' and stored
                                   and not in_superseded_folder(stored))

    first_of = {}
    for out in results:
        if out['duplicate_of'] or out['anomaly']:
            continue
        first = first_of.setdefault(out['hash'], out)
        if first is not out:
            out.update(verdict='none', duplicate_of=first['path'], moved=False, move_pending=False,
                       twin_ingested=(first['verdict'] in HELD))
    return results
```

`stored_form` is conventions §2.4's helper. `rows` are the query's rows as mappings by column name.

## Step 3 — Report

Return the per-file entries. The operation reports; the caller decides what each verdict means for its own work.
