# initialize — set up a new matter's case-data databases

Runs **once per matter**, and is the one operation that runs **before the matter pointer
(`probanda.json`) exists** — it creates the pointer itself (Step 1) rather than reading one. Every operation
derives `matter_root` from the current session's proven host path; this one also writes the
initial breadcrumb. It reads
`../shared/conventions.md` first (for the storage layout, the tool contract, and the
`matter_metadata` seed keys), then proceeds from the preconditions below.

Correctness of the written `matter_root` is a property of **how the path is derived**,
not of which environment the session runs in: it must be the matter folder's real host
(Windows) absolute path, taken only from a surface that speaks the host namespace, and
proven before it is written.

- **Cowork:** the granted matter folder as the *native file tools* (Read/Write/Edit)
  address it is the host path — those tools run host-side. The Bash/Glob view
  (`/sessions/…/mnt/…`) is a sandbox path and must never be the source; a sandbox path
  written into a pointer is exactly the corruption the resolver treats as stale. If the
  session cannot state the granted folder in `C:\…` form, ask the practitioner for it —
  never derive it from the sandbox view.
- **Local Claude Code:** every path is a host path by construction; derive `matter_root`
  from the granted/confirmed matter folder — never from the working directory (ordinarily
  the repo) and never by guessing.

Prove the root before writing: natively read/list it and require `4. LAWYER BRIEF\`
directly beneath. If it is absent, run `matter-skeleton.md` first. Steps 4–5's
`case_data__*` calls against the new pointer are the proof it actually works.

---

## Preconditions (refuse to overwrite)

Before doing anything, confirm this matter has never been initialized:

- **No pointer** at the matter root — neither `probanda.json` nor the legacy name
  `coclerk.json` — and none at the legacy `9. AI\coclerk.json`.
- **No existing `.sqlite` files** in the resolved case-data folder (`main.sqlite`,
  `law.sqlite`, or `privileged.sqlite`).

If **neither** exists, proceed with Steps 1–5 below (new matter).

If **both** already exist and the pointer is already `schema_version` 5, halt and
report: the matter is already initialized; use `ingest`, `query`, `maintain`, or
`migrate` instead. **Never overwrite an existing pointer or database.**

If **both** already exist but the pointer's `schema_version` is below 5 (a stale
pointer predating the permission-fatigue conversion, 2026-07-15), this is a
**pointer upgrade**, not a fresh initialize — take the branch immediately below
instead of Steps 1–5.

If the pointer is `schema_version` 5 but **no `.sqlite` files** exist: Steps 1–5, skip Step 1.4.

---

## Pointer upgrade (stale pointer, database already exists)

Runs only when a pointer (`probanda.json`, else `coclerk.json`) exists at a `schema_version` below 5 and the
matter's `.sqlite` files already exist. Never runs schema DDL and never reseeds
`matter_metadata` — the matter's data is untouched by this branch.

The same `matter_root` derivation rule as full initialize applies: host-namespace
path only, proven before writing.

1. Read the existing pointer (native Read): `probanda.json` when it exists, else
   `coclerk.json` (a sub-v5 pointer predates the rename, so it is normally `coclerk.json`).
2. Derive `matter_root` = the absolute host path of the folder containing that
   pointer (this session's own path to that folder). Sanity-check that
   `4. LAWYER BRIEF\` exists directly under it — if it doesn't, halt and report
   rather than guessing a wrong root (a wrong `matter_root` would misdirect the
   `evidence.sql` rebuild boundary onto another matter's data).
3. Re-derive `case_data_dir` from the live `matter_root` and the existing
   database identity (`main.matter_metadata`, else the matter folder name).
   Treat the stored path only as a nominee and retain it only if it currently
   contains `main.sqlite`. Keep `evidence_sql_path` unchanged.
4. Write the pointer back at the matter root (native Write, plain text — not
   a `case_data__*` call) in the `schema_version` 5 form (§2.2 of
   `../shared/conventions.md`): `schema_version: 5`, the derived `matter_root`,
   the re-derived `case_data_dir`, and the unchanged `evidence_sql_path`.
   Write it twice, same content: as `probanda.json` and as `coclerk.json`
   (migrate-on-write, §2.1/§2.3 of `../shared/conventions.md`).
5. Record the matter's folder: call `practice_data__upsert_client_matter` with the
   matter's `client_num` and `matt_num` (or `file_number`) and `folder` set to the
   matter folder's path relative to the litigation library (the parent of
   `case_data_root`) — never an absolute path. The delete hook reads this record
   as its second way of recognising a matter folder, so an upgraded or moved
   matter folder's record is repaired here.
6. Verify with one `case_data__query` call (e.g. a trivial `SELECT 1`) against
   the new pointer — this is the actual proof the upgrade succeeded, not the
   write in step 4 alone.
7. Report the matter upgraded and the resolved `matter_root`. No metadata
   confirmation needed — this branch never touches `matter_metadata`, which
   the existing database already carries from its original initialization.

---

## Step 1 — identity and pointer

1. Parse the matter folder name for the **matter reference** — the leading token,
   either `{client}.{matter}` (`8165.L8153`) or the matter alone (`L8153`); the
   remainder is the short name (see the folder-name parsing in
   `../shared/conventions.md`). This is the value the `matter_id` metadata key
   stores; that key's name is historical and is never what the practitioner is
   shown.
2. Obtain the client/matter metadata by invoking `/practice-data` with the
   **matter-lookup** operation, passing the matter reference (it matches on
   `matt_num` or `file_number`). That gatekeeper resolves the practice database
   itself and returns the matter and client context; this operation holds no
   practice-database path, schema, or SQL of its own — never open the practice
   database directly. If the lookup returns no rows, ask the practitioner for the
   identifying details rather than guessing them.

   The **matter number** the lookup returns (stored under `matter_no`) is not the
   matter reference. They are equal whenever the folder is named by the matter
   alone (`L8153 Example Matter`) and differ whenever it carries a client number
   (`8165.L8153 Example Matter` → reference `8165.L8153`, number `L8153`). Never
   derive one from the other: the reference comes from the folder, the number from
   the practice database.
3. **Confirm the extracted metadata with the user** before writing anything, and
   let the user correct any field. Present matter reference, matter number, client
   no., client name, and short name — labelled in those words, never by a storage
   key. Re-ask any field a reply leaves unconfirmed; never treat a non-answer as
   confirmation.

   **Collapse the matter number when it equals the matter reference.** Two lines
   carrying the same value read as one field duplicated, and invite the user to
   "correct" one of them. When equal, the matter number gets no line of its own:

   ```
   Matter reference: L8153 (matter number is the same)
   Client no.:       4165
   Client name:      Example Client Ltd.
   Short name:       Example Matter
   ```

   When they differ, both lines appear:

   ```
   Matter reference: 8165.L8153
   Matter number:    L8153
   Client no.:       4165
   Client name:      Example Client Ltd.
   Short name:       Example Matter
   ```

   If the lookup returned no matching row, say so plainly and show the matter
   reference and short name alone rather than a card of blank fields; the
   practitioner supplies the rest.

   The collapse is presentational only. Step 4 seeds both keys either way — the
   `matter_id` key takes the matter reference and the `matter_no` key takes the
   matter number, including when the two values are identical.
4. Write the pointer at the matter root (native Write), twice with the same content — as
   `probanda.json` and as `coclerk.json` (migrate-on-write, §2.1 of `../shared/conventions.md`,
   so an older copy of the plugin still finds the matter) — in the schema_version 5 form
   (§2.2): `matter_root` = this session's own absolute host path to the matter folder;
   `case_data_dir` = the resolved `0. CASE DATA\<matter_id> <short_name>\` path.
   This stored value is an advisory breadcrumb: subsequent calls derive live
   and select a stored non-standard nominee only when it contains `main.sqlite`;
   `evidence_sql_path` = `..\0. CASE DATA\<matter_id> <short_name>\evidence.sql`, the
   dump beside the binaries, relative to the matter folder. This is a plain-text
   write via the native file-write tool — not a `case_data__*` call, and not staged —
   the pointer is a plaintext artifact that lives safely in the synced matter tree
   (§2.1). Every subsequent `case_data__*` call in this operation (Steps 4–5) reads
   `matter_root` back out of the pointer you just wrote.
5. Record the matter's folder: call `practice_data__upsert_client_matter` with the
   matter's `client_num` and `matt_num` (or `file_number`) and `folder` set to the
   matter folder's path relative to the litigation library (the parent of
   `case_data_root`) — never an absolute path. The delete hook reads this record
   as its second way of recognising a matter folder.

---

## Step 2 — read and validate the SQL

Read `../references/schema.sql` as §1 of `../shared/conventions.md` directs.

Validate the schema section markers: `schema.sql` MUST contain one balanced
`-- ===== v6 BEGIN <db> =====` / `-- ===== v6 END <db> =====` pair for each of
`main`, `law`, and `privileged`. **Fail if any pair is unbalanced or missing.**

```python
import re

def split_sections(schema_text):
    """Return {db: sql} for main/law/privileged; fail on unbalanced markers."""
    sections = {}
    for db in ('main', 'law', 'privileged'):
        begin = re.search(rf'^-- ===== v6 BEGIN {db} =====\s*$', schema_text, re.M)
        end = re.search(rf'^-- ===== v6 END {db} =====\s*$', schema_text, re.M)
        if not begin or not end or end.start() <= begin.end():
            raise SystemExit(f"schema.sql: unbalanced or missing markers for '{db}'.")
        sections[db] = schema_text[begin.end():end.start()]
    return sections

sections = split_sections(schema_text)   # schema_text read with the native tool
```

`schema.sql`'s `law` and `privileged` sections write bare (unqualified) `CREATE TABLE`/
`CREATE INDEX` statements, because before the permission-fatigue conversion each
database was built via its own direct connection. `case_data__execute` instead runs
everything through one ATTACHed connection (main primary, `law`/`privileged` attached —
§2.3), so those two sections' statements must be schema-qualified before they're sent, or
they land in (or fail against) the wrong schema. Qualify them client-side:

```python
def qualify(section_sql, schema_name):
    out = re.sub(r'(?m)^CREATE TABLE\s+(\w+)', rf'CREATE TABLE {schema_name}.\1', section_sql)
    out = re.sub(r'(?m)^CREATE\s+(UNIQUE\s+)?INDEX\s+(\w+)\s+ON\s+(\w+)',
                  lambda m: f'CREATE {(m.group(1) or "")}INDEX {schema_name}.{m.group(2)} ON {m.group(3)}',
                  out)
    return out

law_qualified = qualify(sections['law'], 'law')
privileged_qualified = qualify(sections['privileged'], 'privileged')
# sections['main'] needs no qualification -- main is the ATTACHed connection's default schema.
```

---

## Step 3 — database folders (nothing to create)

Do **not** create either folder, and never request a workspace grant for
`0. CASE DATA` or its parent: `case_data__execute` creates both containing
folders server-side on the first call — the binary copy-back makedirs the
case-data sibling folder, and the dump writer puts `evidence.sql` in that same
folder. This is the §1 guarantee in `../shared/conventions.md`: no
per-session workspace-access prompt for the sibling folder. If the matter root
doesn't exist yet, ask the practitioner to create it, then request access.

---

## Step 4 — build the three databases via `case_data__execute`

One `case_data__execute` call, `matter_root` from the pointer just written (Step 1)
(§2.3). `sql_script` is the concatenation,
in this order: `sections['main']`, then `law_qualified`, then `privileged_qualified`,
then the `matter_metadata` seed `INSERT`, then the three `PRAGMA user_version = 90`
statements (`PRAGMA user_version = 90;` for main, `PRAGMA law.user_version = 90;` and
`PRAGMA privileged.user_version = 90;` for the attached databases — schema-qualified
PRAGMA syntax works the same way as the schema-qualified `PRAGMA table_info` pattern in
§3). The whole script runs in the one transaction `case_data__execute` already wraps
every call in — no separate `BEGIN`/`COMMIT` needed here. All three databases are
empty here, so the tool itself loads the trigger layer from `triggers.sql` after the
commit, not before.

The `matter_metadata` seed keys (main only) are: `matter_id`, `client_no`,
`matter_no`, `short_name`, `client_name`, `filing_lawyer_name` = NULL,
`filing_lawyer_firm` = NULL, `created` = today's date. Build the `INSERT` with bound
values, e.g.:

```python
import datetime

today = datetime.date.today().isoformat()
seed_sql = (
    "INSERT INTO matter_metadata (key, value) VALUES "
    "('matter_id', ?), ('client_no', ?), ('matter_no', ?), ('short_name', ?), "
    "('client_name', ?), ('filing_lawyer_name', NULL), ('filing_lawyer_firm', NULL), "
    f"('created', '{today}');"
)
# bind matter_id, client_no, matter_no, short_name, client_name as the seed_sql params
# (or inline them with proper SQL-string escaping if the tool call takes a single script
# with no separate params channel for execute -- prefer parameterizing via multiple
# single-row INSERTs through `params` if the calling harness supports it per-statement).

sql_script = "\n".join([
    sections['main'],
    law_qualified,
    privileged_qualified,
    seed_sql,
    "PRAGMA user_version = 90;",
    "PRAGMA law.user_version = 90;",
    "PRAGMA privileged.user_version = 90;",
])
```

Call `case_data__execute` with this `sql_script`. On success the binaries already exist
at native storage under `0. CASE DATA\<matter_id> <short_name>\` (created by the tool) and
`evidence.sql` has already been regenerated — both are side effects of the call, not
separate steps.

---

## Step 5 — report

Report every INSERT (the `matter_metadata` seed rows) and the resolved paths:
`probanda.json`, the case-data folder, and `evidence.sql`. Suggest the next step: run
`proceedings-profile` to record the proceeding and parties, or `ingest` to load the
first document.
