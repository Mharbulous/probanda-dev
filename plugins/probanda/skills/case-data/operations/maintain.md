# maintain — dump / rebuild / verify-sources

Read `../shared/conventions.md` first; derive the live `matter_root` per §2.2
and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3.

This operation has three modes. Dump and rebuild are the durable-text boundary;
verify-sources is a read-only integrity check.

**Conversion status (permission-fatigue conversion, 2026-07-15+):** dump and
verify-sources modes below route through `case_data__query`/`case_data__execute`
(§2.3). **Rebuild mode does not** — it stays on the pre-conversion E1 path
(`../references/scripts/rebuild.py`, run directly in a local session) because it is
architecturally incompatible with the `case_data__execute` contract: rebuild
constructs fresh temp databases from `evidence.sql` text and validates them
(minimum table counts, trigger presence) **before ever touching native storage**,
whereas `case_data__execute` always stages from the *existing* native binaries and
commits+copies-back+dumps as one atomic unit — it has no "validate a from-scratch
reconstruction, then conditionally replace" mode. Extending the tool contract to
cover that is out of scope for this handover; run rebuild the same way it ran before
this conversion (E1 only, per `../shared/conventions.md` §1's E1 note) until that
extension is designed.

**Migrate, which was blocked for a related reason, converted 2026-07-27** —
`case_data__migrate` is a new tool rather than a mode of `execute`, with its own
two-phase plan/apply contract, host-local backups, and restore
(`../operations/migrate.md`). It is the precedent to follow when rebuild is
converted: a separate tool with plan/apply rails, not a widened `execute`. The
two overlap — migrate's 7.4→7.6 carve-out already drives `rebuild.py`'s in-temp
upgrade functions host-side — so a future `case_data__rebuild` should share that
implementation rather than fork it.

---

## Mode: dump

`case_data__execute` (§2.3) regenerates `evidence.sql` automatically as part of
**every** successful call — this mode exists only for the rare case of forcing a
re-dump with no accompanying data change (e.g. after an external edit to a native
binary outside the normal tool path, which should not happen but this mode gives a
recovery lever). Call `case_data__execute` with `matter_root` and a no-op
`sql_script` (e.g. `"SELECT 1;"` — any statement that
touches no data satisfies the "successful call" requirement that triggers the dump
side effect). The response's `evidence_sql` field is the written path.

The dump content itself — the `schema v9.0` header, the three section-marker-fenced
`iterdump()` bodies, `journal_mode = DELETE` asserted before dumping — is produced
inside the backend (`plugins/litigation/mcp/src/case/backend.ts`, `write_dump`);
this operation file no longer implements it. Report the `evidence_sql` path returned.
As a mutating operation's terminal step, every `case_data__execute` call already IS
the dump; there is no separate dump call to make after an ordinary write.

---

## Mode: rebuild

**Not yet converted — runs `../references/scripts/rebuild.py` directly, E1 only** (see
the conversion-status note above). The steps below document what that script does;
they are not routed through `case_data__*`.

Rebuilds the three binaries **from `evidence.sql`**. Rebuild is **read-only with
respect to `evidence.sql`** — it never writes the dump.

**Principle — the text record wins.** If the database and a human-edited text record
disagree, the text record is authoritative: **edit `evidence.sql` by hand, then
rebuild.** Rebuild is how a hand-corrected dump becomes the live database.

Steps:

1. Read `evidence.sql` (native — case-data folder) and `../references/triggers.sql`
   (and `../references/queries.sql` for the views) as §1 of
   `../shared/conventions.md` directs.
2. Parse the three sections by their `-- ===== v6 BEGIN <db> =====` /
   `-- ===== v6 END <db> =====` markers.
3. Build three temp databases: `executescript` each parsed section into its own
   temp file; `PRAGMA journal_mode = DELETE`.
3.5. **v6.9→v7.0 in-temp structural upgrade (idempotent).** A dump produced at v6.9
   replays v6.9 structure (main = 14 tables, no `issue_concepts`, no cloud columns),
   which would fail both the trigger load (pair #7 references `issue_concepts`) and
   the step-5 count gate. If `legal_concepts` lacks `cloud_principle_id`, upgrade the
   temp binaries in place (foreign_keys still OFF): `ALTER TABLE authorities ADD
   COLUMN cloud_authority_id`; rebuild `legal_concepts` (CREATE new with the v7.0
   columns + cross-column CHECKs → `INSERT … SELECT` the old columns → DROP → RENAME,
   recreating `idx_legal_concepts_type` and `idx_legal_concepts_cloud`); `CREATE
   TABLE issue_concepts` + `idx_issue_concepts_concept`. Assert every pre-existing
   table's row count is unchanged (new columns default NULL → the CHECKs pass;
   `issue_concepts` is born empty) — **fail before touching native files** on any
   mismatch. `rebuild.py`'s `upgrade_69_to_70` is the reference implementation.
3.6. **v7.0→v7.1 in-temp structural upgrade (idempotent).** A dump produced at v7.0
   replays `concept_authorities` without `verified` / `notes`, which would fail the
   `verified >= 0` filters every edge consumer now carries (push-state's queue and
   serializer, queries 14/18/05b, the drafting script). If `concept_authorities` lacks
   `verified`, apply on the temp binaries: `ALTER TABLE concept_authorities ADD COLUMN
   verified INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2))` and `ALTER TABLE
   concept_authorities ADD COLUMN notes TEXT`. Both ride `ALTER` (single-column CHECK,
   constant default), so no table rebuild is needed. Assert `concept_authorities`'
   row count is unchanged and every row reads `verified = 0` — **fail before touching
   native files** on any mismatch. `rebuild.py`'s `upgrade_70_to_71` is the reference
   implementation.
4. On the attached connection, load the TEMP triggers from `triggers.sql` and create
   the views from `queries.sql`/`schema.sql` on main.
5. **Validate minimum table counts BEFORE touching native files:** main ≥ 21,
   law ≥ 5, privileged ≥ 3. **Rebuild MUST fail before touching native files if the
   triggers are missing** (the cross-database FK layer must load).
6. **Stamp `PRAGMA user_version = 90` on all three temp binaries.** `iterdump()`
   does not capture `PRAGMA user_version`, so a freshly rebuilt database starts
   at `0` even though its schema is genuinely v9.0 — every operation's version
   guard would otherwise misread it as legacy v6.2 and refuse to run.
7. Only after validation and the version stamp, move the three closed temp
   binaries into native storage atomically.

```python
import os, re, sqlite3, tempfile

MIN_TABLES = {'main': 21, 'law': 5, 'privileged': 3}

def parse_sections(evidence_text):
    sections = {}
    for db in ('main', 'law', 'privileged'):
        begin = re.search(rf'^-- ===== v6 BEGIN {db} =====\s*$', evidence_text, re.M)
        end = re.search(rf'^-- ===== v6 END {db} =====\s*$', evidence_text, re.M)
        if not begin or not end or end.start() <= begin.end():
            raise SystemExit(f"evidence.sql: unbalanced or missing markers for '{db}'.")
        sections[db] = evidence_text[begin.end():end.start()]
    return sections

sections = parse_sections(evidence_text)   # native-read in E2
tmp = tempfile.mkdtemp(prefix='coclerk_rebuild_')
paths = {db: os.path.join(tmp, f'{db}.sqlite') for db in sections}

for db, sql in sections.items():
    c = sqlite3.connect(paths[db])
    c.execute("PRAGMA journal_mode = DELETE")
    # foreign_keys stays OFF while replaying the dump: iterdump() emits
    # CREATE TABLE/INSERT statements in alphabetical table order (not
    # dependency order) with no PRAGMA foreign_keys=OFF guard of its own
    # (unlike the real sqlite3 CLI's .dump). With foreign_keys=ON, an INSERT
    # into a table whose FK target is alphabetically later fails with
    # "no such table" before that table is ever created.
    c.execute("PRAGMA foreign_keys = OFF")
    c.executescript(sql)
    c.close()

# Load triggers + views on the attached connection.
con = sqlite3.connect(paths['main'])
con.execute(f"ATTACH DATABASE '{paths['law']}' AS law")
con.execute(f"ATTACH DATABASE '{paths['privileged']}' AS privileged")
con.executescript(triggers_sql_text)       # fails here if malformed
trigger_count = con.execute(
    "SELECT count(*) FROM sqlite_temp_master WHERE type='trigger'").fetchone()[0]
if trigger_count == 0:
    raise SystemExit("Rebuild aborted: triggers missing; not touching native files.")
con.executescript(views_sql_text)          # from queries.sql
con.close()

# Validate table counts before touching native files.
for db, path in paths.items():
    c = sqlite3.connect(path)
    n = c.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
    c.close()
    if n < MIN_TABLES[db]:
        raise SystemExit(f"Rebuild aborted: {db} has {n} tables (< {MIN_TABLES[db]}); "
                         "not touching native files.")

# Stamp the version on all three: iterdump() does not capture PRAGMA
# user_version, so a freshly rebuilt database defaults to 0 (read as legacy
# v6.2 by the guard) even though the schema is genuinely v9.0 -- every
# subsequent operation would incorrectly refuse to run until "migrate", which
# would then fail because the columns it tries to ADD already exist.
for db, path in paths.items():
    c = sqlite3.connect(path)
    c.execute("PRAGMA user_version = 90")
    c.close()

# All checks passed -> move the closed temp binaries into native storage atomically.
```

Report: sections parsed, per-database table counts, trigger/view counts, and the
native paths written.

---

## Mode: verify-sources

Read-only integrity check of every stored source citation. For **every `file_path` +
locator** across `main.sources`, `privileged.privileged_sources`, and the rows that
reference them (facts via `source_id`/`source_locator`, positions, evidence_links,
fact_provenance), check that:

- the referenced file exists under the matter root, and
- the computed citation `<file_path>#<locator>` is well formed (a locator per the
  citation format in `../shared/conventions.md`).

Fetch the candidate rows with `case_data__query` (§2.3), `matter_root` from the
pointer, `sql`: `SELECT source_id, file_path FROM sources WHERE file_path IS NOT NULL`
and a second call for `SELECT source_id, file_path FROM privileged.privileged_sources
WHERE file_path IS NOT NULL`. Everything past that is local filesystem checking, not
database access:

```python
import os

checked = ok = broken = 0
report = []
for source_id, file_path in rows:   # rows = the two case_data__query results, concatenated
    checked += 1
    abspath = file_path if os.path.isabs(file_path) else os.path.join(matter_root, file_path)
    if os.path.exists(abspath):
        ok += 1
    else:
        broken += 1
        report.append((source_id, file_path))
# Report checked / OK / broken and list the broken (source_id, file_path, locator) rows.
```

Report: counts of checked / OK / broken, and the broken citations for the lawyer to
fix. This mode writes nothing.
