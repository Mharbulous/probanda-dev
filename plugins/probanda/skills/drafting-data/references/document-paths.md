# Document paths: the stored form, and re-pointing after a move

Owned by `/drafting-data`. `documents.file_path` names the copy of a document on disk. The VanIAC exhibit list prints it, and affidavit assembly finds the best copy through it. This file holds the form it is stored in, and the one write that re-points it after the file moves.

## The stored form

`documents.file_path` is **relative to the matter root, with backslash separators**: `5. COURT FILE#S-290001\2026-01-05 AFF Smith #1.pdf`. No drive letter, no leading `\` or `.\`, no forward slash. Every write of `documents.file_path` uses this form. Rows written before 2026-09-24 may hold an absolute path; readers accept both.

Convert a path with this helper, never by hand. `root` is the matter folder the path was taken from: `matter_root` from `drafting_forms__open_session` for a host path, or the session's own view of the folder for a path it listed.

```python
def stored_form(path, root):
    p = path.replace('/', '\\')
    r = root.replace('/', '\\').rstrip('\\')
    if p.lower().startswith(r.lower() + '\\'):
        p = p[len(r) + 1:]
    while p.startswith('.\\'):
        p = p[2:]
    return p
```

## Re-point after a move

A file was moved or renamed on disk. Every `documents` row still naming its old place is pointed at the new one, in the stored form. A row names the old place when its path equals the old path ignoring case, as Windows paths do. Most moved files are not documents in any Writing, so **zero rows is the normal result**, not an error. Running it twice is safe: the second run finds zero rows.

**Input:** `db_path` and `matter_root`, both from `drafting_forms__open_session`; `old_path` and `new_path`, in the stored form.

**Values.** `drafting_data__query` and `drafting_data__execute` take the values below as quoted SQL literals composed into the statement, with every `'` doubled. `:old_absolute` is `matter_root`, a backslash, and `old_path`: the form an older row may hold.

1. Read the rows that will move:

   ```sql
   -- document paths: rows to re-point
   SELECT id, file_path FROM documents
   WHERE lower(file_path) IN (lower(:old_path), lower(:old_absolute)) AND file_path <> :new_path
   ORDER BY id;
   ```

   No rows: stop and report zero rows.

2. Re-point them in one `drafting_data__execute` call:

   ```sql
   -- document paths: re-point
   UPDATE documents SET file_path = :new_path
   WHERE lower(file_path) IN (lower(:old_path), lower(:old_absolute)) AND file_path <> :new_path;
   ```

   Each row re-pointed moves `db_meta.revision` by trigger (`filing-checklists.md` §8), which is right: the rendered exhibit list prints the path.

3. Report the ids from step 1 as re-pointed. On a non-success result, re-run step 1 before anything else: rows it still returns did not move (the `SKILL.md` rule for `drafting_data__execute`).
