# Schema-bump checklist

Every place a matter-data schema version is written down. The version lives as
`PRAGMA user_version` encoded `major * 10 + minor` (v8.2 = 82), and it is
restated — not derived — in a dozen files across two languages and two runtime
trees. Miss one and the failure is silent until a live matter hits the guard.

Work this list top to bottom for a bump from `<OLD>` to `<NEW>`. Nothing here is
optional; the surfaces are listed in dependency order, not importance order.

## 1. Schema and migration source

- **`references/schema.sql`** — the title header (`-- Case Data — schema vX.Y — …`),
  the `PRAGMA user_version` encoding comment, a new `-- vOLD → vNEW changes:`
  block, and the DDL itself.
- **`references/migrations.sql`** — append the upgrade snippet under a marker in
  the exact form `-- MIGRATE <from_int> -> <to_int> -- DB: <main|law|privileged>`;
  `operations/migrate.md` parses these markers, so a malformed marker is an
  invisible gap, not a syntax error. Write `ALTER TABLE … ADD COLUMN … NOT NULL
  DEFAULT … CHECK(…)` so existing rows backfill, and prefer
  `CREATE TABLE IF NOT EXISTS` so the snippet stays re-runnable. **`ALTER TABLE …
  ADD COLUMN` is NOT re-runnable** — SQLite raises `duplicate column name` on a
  second run, unlike `CREATE TABLE IF NOT EXISTS`. Every fixture builder that
  constructs an old-version database by un-upgrading the current `schema.sql`
  (`tests/test_migrate_engine.py::build_matter`, `case-migrate.db.test.mjs`'s
  `BUILD_FIXTURE`, and the rebuild test in `test_schema_vNN.py`) needs a matching
  `DROP COLUMN` for every column-only hop, or the chain fails at that hop with a
  duplicate-column error. `CREATE TABLE IF NOT EXISTS` hops need no such drop,
  and neither does a hop that widens a CHECK by rebuilding the table —
  `INSERT … SELECT` copies rows across whatever the source CHECK allowed.

- **A hop that rebuilds a PARENT table must bracket itself in
  `PRAGMA foreign_keys = OFF; … PRAGMA foreign_keys = ON;`.**
  `migrate_engine._apply_marker` sets `foreign_keys = ON` before every marker, so
  dropping a table that another table references fails without the bracket. The
  84 → 85 `law` hop is the worked example; `rebuild.upgrade_69_to_70` is the
  older precedent.

## 2. Operation docs that stamp or guard the version

- **`operations/migrate.md`** — the target and the per-hop table.
- **`operations/initialize.md`** — three PRAGMA stamps, one per database
  (`main`, `law`, `privileged`). All three move together.
- **`operations/maintain.md`** — its PRAGMA stamps.
- **`operations/ingest.md`** — the guard message naming the minimum version.
- **`references/scripts.md`** — the version strings in the script descriptions.
- **`SKILL.md`** — the "The current schema is vX.Y" sentence (table counts move
  too, only when the bump adds/removes a table).
- **`references/queries.sql`** — its own `-- Case Data — Queries vX.Y.` header line.
- **`design-decisions.md`** — a decision entry for the change, and if the bump widens
  order-effects.md's writable surface, its field count in decision #36 ("`parties`
  (N fields)").

## 3. Python scripts under `references/scripts/`

- **`resolve_paths.py`** — `EXPECTED_USER_VERSION`. This is the guard the whole
  skill runs through.
- **`check_pointers.py`** — `EVIDENCE_HEADER`. This is host-variant because Cowork
  and Codex may ship different schema generations.
- **`dump.py`** — `HEADER` is a module constant carrying the version string.
- **`migrate_engine.py`** — `TARGET`. It builds the chain one version-hop at a
  time, each hop served by a `MIGRATE` marker or a `rebuild.py` carve-out; a hop
  served by neither is a hard fail, so the chain fails closed on a gap rather
  than skipping a generation.
- **`rebuild.py`** — `stamped_version = 76 if args.migrate else 90`. The **`else`
  branch moves with every bump**, and so do the `accepted` tuple and the two
  version strings in `require_source_version`; the `76` does not (below).

### The rebuild-only carve-outs (69→70, 74→76)

Hops 69→70, 74→75 and 75→76 are not expressible as SQL snippets — 69→70 adds
cross-column CHECKs to `legal_concepts`, and 74→76 rebuilds factual positions
under a new enum and uniqueness constraint — so `rebuild.py` owns them as
in-temp carve-outs that `migrate_engine.py` imports via its `CARVEOUTS` table.
A hop in neither `migrations.sql` nor `CARVEOUTS` is a hard stop, so a new
`rebuild.upgrade_*` function does nothing until it is registered there. Consequences that look
like bugs and are not:

- `rebuild.py --migrate` stamps **76**, deliberately not the current version: it
  owns only the carve-out, and `migrate.md` then applies the incremental
  `76 → <NEW>` segment and stamps `<NEW>`.
- `dump.py` refuses a 76-stamped database. 76 is a way-station that should never
  be observed at rest.

Leave the historical markers alone — `V73 CAPTURE SWEEP`, `upgrade_75_to_76`,
"vX.Y capture fields" and friends name the version they shipped in, not the
current one.

## 4. Tests

- `git mv tests/test_schema_v<OLD>.py tests/test_schema_v<NEW>.py`, rename the
  class to match, and move the `require_source_version` boundaries inside it.
  (`__pycache__` keeps `.pyc` files for the old names — harmless, but don't
  mistake them for surviving sources.)
- These five also pin the version and are easy to miss because none of them has
  "schema" or a version number in its filename (all in the skill's repo-only
  `tests` folder unless a path is given): `test_migrate_engine.py`
  (the fixture's un-upgrade block, the expected chain, `target_version`, and
  `AlreadyCurrentTests.user_version`), `test_check_pointers.py`,
  `test_resolve_paths.py` (a `write_db(..., version=<OLD>)` default —
  leave any test that deliberately exercises a *stale* version, e.g. legacy 76,
  alone), and `source/lawyer/mcp/test/case-migrate.db.test.mjs` (its own
  `BUILD_FIXTURE` un-upgrade block plus every `MIGRATE ... -> v<OLD>`
  confirmation string). (The application-schema test files this list used to
  also name retired with that schema, 2026-08-27, #374.)

## 5. The duplicate guard in the MCP runtime — the one that gets missed

`source/lawyer/mcp/src/case/backend.ts` carries a **hand-ported copy** of
the resolver as an embedded Python string. It is duplicated on purpose — the
schema-guard bypass has to live in a different process from the read/write path
(`design-decisions.md` #27, #28) — so it never picks up a change to `resolve_paths.py`.
Bump, in that file:

- `EXPECTED_USER_VERSION`
- `DUMP_HEADER`
- the two guard messages

Then, in `plugins/litigation/mcp`:

```bash
npm test
```

and update the boundary pins in `source/lawyer/mcp/test/case-tools.db.test.mjs`
(the `fixture(NN)` calls and the asserted dump-header line). Finally release with `/release` — the
bundle is tracked and shipped, so an un-rebuilt bundle ships the old guard.

> **The two dump-header literals are not byte-identical and must not be
> copy-pasted between files.** `dump.py`'s `HEADER` uses an em dash
> (`-- Case Data evidence dump — schema v9.0`); `backend.ts`'s `DUMP_HEADER`
> uses a double hyphen (`-- Case Data evidence dump -- schema v9.0`). Both
> readers parse the version out by regex rather than comparing the whole
> string, so they coexist — but `case-tools.db.test.mjs` asserts the double-hyphen
> form exactly, and pasting the Python literal into TypeScript fails that test.

## 6. Guard direction

Every guard is `version < EXPECTED_USER_VERSION` → reject. Bumps are
backward-compatible in one direction only: a database **ahead** of the guard
passes, a database **behind** it fails and is told to migrate. That is why the
whole surface has to move in one commit — the moment the new guard ships, every
matter still at `<OLD>` starts failing closed until it migrates.
