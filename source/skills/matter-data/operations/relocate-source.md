# Operation: relocate-source

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

Writes. After a file is moved or renamed, re-points every stored record of it so its `file_path` names where the file now is, in the stored form (conventions §2.4). The file is found by its hash, which a move does not change. The old path is a check, not the key. The operation moves no file: the caller has already moved it.

**The caller makes one `matter_data__relocate_source` call** with the Input below and reports its Output. The tool runs Steps 1 to 4 on the host, executing this file's own fenced probe and `relocate_plan` (`../references/scripts/relocate_source.py`, design decision #75), so the steps below say what it does, not what the caller does.

Running it twice is safe: the second call finds every record already at the new path.

---

## Input

| Field | Meaning |
|---|---|
| `matter_root` | the live host path of the matter folder (conventions §2.2). The tool runs on the host, so this is also the folder Step 2 reads |
| `hash` | the lowercase hex SHA-256 of the file's bytes |
| `store` | `main`, `privileged` or `law`: the store [`ingest-status.md`](ingest-status.md) reported for the file |
| `old_path` | where the file was, in stored form |
| `new_path` | where the file is now, in stored form |

## Output

| Field | Meaning |
|---|---|
| `outcome` | `relocated`, `already_current`, or `failed` |
| `stored_path` | `new_path`, as the records now store it |
| `rows` | every record of the file: `{store, id, was, action}`, where `action` is `moved`, `already` or `left` |
| `reason` | with `failed`: `no_rows` (the named store holds no record with this hash), `twin_at_stored_path` (the records name another copy of the file that is still on disk, so this file is a copy and is never re-pointed), or `write_not_confirmed` (Step 4) |
| `rows_now` | with `write_not_confirmed`: every record as read after the write |

`already_current` is success: every record already stores `new_path` exactly.

---

## Step 1 — Read every record of the file

One read through `matter_data__query`'s path. Its one parameter is `hash`:

```sql
-- relocate-source probe
WITH k(h) AS (SELECT ?)
SELECT 'main' AS store, s.source_id AS id, s.file_path
FROM main.sources s, k WHERE s.file_hash = k.h
  AND NOT (s.parent_source_id IS NOT NULL AND s.file_path IS NULL)
UNION ALL
SELECT 'privileged', p.source_id, p.file_path
FROM privileged.privileged_sources p, k WHERE p.file_hash = k.h
UNION ALL
SELECT 'law', a.authority_id, a.file_path
FROM law.authorities a, k WHERE a.file_hash = k.h
ORDER BY 1, 2;
```

Every store is read, not only the named one, and every record moves with the file: an affidavit's exhibits share the body's path (design decision #17), a book of authorities has one row per authority, a promoted document keeps its privileged row (#3), and a merged authority's tombstone keeps its own path and hash (#22). The one exception is an email attachment, a child row with no path: its bytes live inside its email (#51), so a standalone copy of them never gives it a path (#54). The probe leaves it out, and a file held only as an attachment is `failed`, `no_rows`.

## Step 2 — Decide which records move

`relocate_plan` below runs over the probe's rows, with `matter_root` as its `matter_folder`. It reads files there only when a record names a third place, neither the old path nor the new one. Its rules:

- The named `store` holds no record → `failed`, `no_rows`. Write nothing.
- A record that stores `new_path` exactly is `already`.
- A record whose stored path is the old or the new path, compared in stored form ignoring case, is `moved`. This also rewrites a legacy absolute or forward-slash path, and a record with no path at all (never an email attachment, which the probe leaves out).
- A record that names a third place: if a file with this hash is still there, it belongs to that other copy and is `left`. Otherwise its path is stale (the file was moved by hand, or a crash left the old path behind) and it is `moved`.
- Nothing `moved` and nothing `left` → `already_current`. Write nothing.
- Nothing `moved` but something `left` → `failed`, `twin_at_stored_path`. Write nothing.
- Otherwise → `relocated`, with the script in `plan['sql']`.

```python
import hashlib, os


def relocate_plan(rows, store, file_hash, old_path, new_path, matter_root, matter_folder):
    def sql_literal(value):
        return "'" + value.replace("'", "''") + "'"

    def hash_at(stored):
        full = (stored if os.path.isabs(stored)
                else os.path.join(matter_folder, *stored.split('\\')))
        if not os.path.isfile(full):
            return None
        h = hashlib.sha256()
        with open(full, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b''):
                h.update(chunk)
        return h.hexdigest()

    new_path = stored_form(new_path, matter_root)
    same_place = {stored_form(old_path, matter_root).lower(), new_path.lower()}
    plan = {'outcome': None, 'reason': None, 'rows': [], 'sql': None}
    if not any(r['store'] == store for r in rows):
        plan.update(outcome='failed', reason='no_rows')
        return plan
    for r in rows:
        was = r['file_path']
        if was == new_path:
            action = 'already'
        elif was is None or stored_form(was, matter_root).lower() in same_place:
            action = 'moved'
        elif hash_at(stored_form(was, matter_root)) == file_hash:
            action = 'left'
        else:
            action = 'moved'
        plan['rows'].append({'store': r['store'], 'id': r['id'], 'was': was, 'action': action})
    moved = [r for r in plan['rows'] if r['action'] == 'moved']
    if not moved:
        left = any(r['action'] == 'left' for r in plan['rows'])
        plan.update(outcome='failed' if left else 'already_current',
                    reason='twin_at_stored_path' if left else None)
        return plan
    tables = {'main': ('main.sources', 'source_id'),
              'privileged': ('privileged.privileged_sources', 'source_id'),
              'law': ('law.authorities', 'authority_id')}
    statements = []
    for name, (table, key) in tables.items():
        ids = sorted(r['id'] for r in moved if r['store'] == name)
        if ids:
            statements.append(
                f"UPDATE {table} SET file_path = {sql_literal(new_path)} "
                f"WHERE file_hash = {sql_literal(file_hash)} "
                f"AND {key} IN ({', '.join(str(i) for i in ids)});")
    plan.update(outcome='relocated', sql='\n'.join(statements))
    return plan
```

`stored_form` is conventions §2.4's helper. `rows` are the probe's rows as mappings by column name.

## Step 3 — Write in one call

For `relocated`, `plan['sql']` runs as **one** script through `matter_data__execute`'s path (one transaction, the trigger layer, the `evidence.sql` dump). Each statement keeps the hash in its `WHERE`, so an id that no longer belongs to this file is never moved.

## Step 4 — Confirm

The Step 1 probe runs again. Every record the plan `moved` must now store `new_path`. If one does not, the result is `failed`, `write_not_confirmed`, with the records as read now in `rows_now`. Do not retry it blindly: conventions §2.3's verify-before-retry rule applies. A tool error (a timeout included) proves nothing about the write either way, and because the operation is safe to run twice, making the same call again is the verification.

## Report

`outcome`, `stored_path`, `rows`, and `reason` when it failed. A `failed` result writes nothing; the caller decides what to do with the file.
