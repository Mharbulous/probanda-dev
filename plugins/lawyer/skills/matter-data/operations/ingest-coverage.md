# Operation: ingest-coverage

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

Read-only. For a set of matter folders named by glob, report which of their files the case database does not yet hold, and the date of the newest ingested correspondence. It is [`ingest-status.md`](ingest-status.md) over whole folders: this file finds and hashes the files, ingest-status decides each verdict, and this file reduces the verdicts to what a caller can name or offer to `/ingest`. **This operation writes nothing and extracts nothing.**

[`../references/scripts/ingest_coverage.py`](../references/scripts/ingest_coverage.py) runs this operation host-side for the drafting runtime, executing this file's own fenced code; it is not a model-facing tool.

---

## Input

| Field | Meaning |
|---|---|
| `matter_root`, `matter_folder` | as [`ingest-status.md`](ingest-status.md) takes them. The walk and the hashing run against `matter_folder` |
| `folder_globs` | glob patterns, each matched against the matter folder's own entries (`3. CORRESPONDENCE*`). A pattern takes **every** folder it matches |
| `correspondence_globs` | the patterns among `folder_globs` whose files count toward the newest correspondence date |

## Output

| Field | Meaning |
|---|---|
| `to_ingest` | stored-form paths of the files with no ingested record, in walk order, each once. A `superseded` file counts as ingested ([`ingest-status.md`](ingest-status.md) rule 5). A copy whose twin is ingested is left out. A copy whose twin is not ingested is named by its twin, the file `/ingest` would take. A file under `0. DRAFT*\Superseded\` is never listed: that folder is [`supersede-draft.md`](supersede-draft.md)'s destination, which no standard glob walks |
| `records` | one `{path, verdict, source_id, possible_version_of}` for each `to_ingest` path, in the same order, saying why the file is not held. `verdict` is the file's [`ingest-status.md`](ingest-status.md) verdict: `none` (no usable record), `partial` or `failed`. `source_id` is the `main.sources` row behind that verdict, null when there is none. `possible_version_of` is ingest-status's field of that name: the id of the source a `SUPERSEDE-PENDING:` marker on that row names, null when there is none. A path named by a copy, whose twin lies outside the folders checked, carries the copy's own verdict, `none`, with the twin's `source_id` and `possible_version_of` |
| `damaged` | stored-form paths whose verdict carries an `anomaly`: no ingest takes them until the record is repaired |
| `unreadable` | `{path, error}` for each file whose bytes could not be read: neither ingested nor a gap, because its state is unknown |
| `folders` | every pattern in `folder_globs`, in the order given: the folders this check covered. A caller names the folders checked from here |
| `missing` | the patterns in `folder_globs` that matched no folder |
| `newest_correspondence` | `{date, path}`: the latest `metadata.date` among files under the `correspondence_globs` folders that are held, by their own verdict (`ingested` or `ingested_by_reference`) or as a copy of an ingested twin, in the main or privileged store. Null when none carries a date |

---

## Step 1 — Find and hash the files

Resolve each pattern, walk every folder it matches recursively, and hash every `.pdf`, `.docx`, `.eml` or `.msg` (any case), skipping any file or folder whose name starts with `~` or `.` at every level. This is local processing: it touches no database.

```python
import glob, hashlib, os

KINDS = ('.pdf', '.docx', '.eml', '.msg')


def scope_files(matter_folder, folder_globs):
    folders, missing, files, unreadable = {}, [], [], []
    for pattern in folder_globs:
        matches = sorted(p for p in glob.glob(os.path.join(glob.escape(matter_folder), pattern))
                         if os.path.isdir(p))
        if not matches:
            missing.append(pattern)
        folders[pattern] = [stored_form(m, matter_folder) for m in matches]
        for folder in matches:
            for dirpath, dirnames, filenames in os.walk(folder):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith(('~', '.')))
                for fn in sorted(filenames):
                    if fn.startswith(('~', '.')) or os.path.splitext(fn)[1].lower() not in KINDS:
                        continue
                    full = os.path.join(dirpath, fn)
                    path = stored_form(full, matter_folder)
                    try:
                        h = hashlib.sha256()
                        with open(full, 'rb') as fh:
                            for chunk in iter(lambda: fh.read(1024 * 1024), b''):
                                h.update(chunk)
                    except OSError as e:
                        unreadable.append({'path': path, 'error': str(e)})
                        continue
                    files.append({'path': path, 'hash': h.hexdigest()})
    return {'folders': folders, 'missing': missing, 'files': files, 'unreadable': unreadable}
```

`stored_form` is conventions §2.4's helper.

## Step 2 — Decide each verdict

Run [`ingest-status.md`](ingest-status.md) on Step 1's `files`, in their order, with the same `matter_root` and `matter_folder`.

## Step 3 — Report

Reduce the ingest-status entries to the output.

```python
import re


def coverage(scope, entries, correspondence_globs):
    to_ingest, records, damaged, newest = [], [], [], None
    corr = [f.lower() + '\\' for g in correspondence_globs for f in scope['folders'][g]]
    by_path = {e['path'].lower(): e for e in entries}

    def superseded_folder(path):
        parts = path.split('\\')
        return len(parts) > 2 and re.match(r'0\. DRAFT', parts[0], re.I) and parts[1].lower() == 'superseded'

    for e in entries:
        if superseded_folder(e['path']):
            continue
        if e['anomaly']:
            damaged.append(e['path'])
            continue
        if (e['verdict'] in ('ingested', 'ingested_by_reference', 'superseded')
                or (e['duplicate_of'] and e['twin_ingested'])):
            date = e['metadata'].get('date')
            if (date and e['store'] in ('main', 'privileged')
                    and e['path'].lower().startswith(tuple(corr))
                    and (newest is None or date > newest['date'])):
                newest = {'date': date, 'path': e['path']}
            continue
        path = e['duplicate_of'] or e['path']
        if path not in to_ingest:
            to_ingest.append(path)
            own = by_path.get(path.lower(), e)
            records.append({'path': path, 'verdict': own['verdict'],
                            'source_id': own['source_ids'][0] if own['source_ids'] else None,
                            'possible_version_of': own['possible_version_of']})
    return {'to_ingest': to_ingest, 'records': records, 'damaged': damaged,
            'unreadable': scope['unreadable'], 'folders': list(scope['folders']),
            'missing': scope['missing'], 'newest_correspondence': newest}
```

Return the output. The operation reports; the caller decides what to name, offer or stop on.
