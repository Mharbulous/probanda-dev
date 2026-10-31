#!/usr/bin/env python3
"""rebuild.py — atomic rebuild of the three binaries from evidence.sql.

Reads evidence.sql (the durable text boundary), triggers.sql, and queries.sql
(for the views); parses the three sections; builds temp databases; loads the
TEMP triggers and creates the views on main; validates minimum table counts
(main >= 21, law >= 5, privileged >= 3) and that the triggers loaded — ALL
BEFORE touching native files — then moves the closed temp binaries into native
storage atomically. On any failure the native files are left untouched.

Rebuild is read-only with respect to evidence.sql. The text record wins: if the
database and a human-edited evidence.sql disagree, fix evidence.sql then rebuild.

E1-ONLY. Do not run/import/copy/stage in a mediated/sandboxed (E2) filesystem —
the mount may serve stale/truncated bytes. See ../scripts.md.

Usage:
    python3 rebuild.py <matter_root>

The --migrate path accepts a v7.4 or v7.5 dump and applies the rebuild-only
upgrades through v7.6 (migrate.md then carries 76 -> 90 incrementally).
A normal rebuild requires a v9.0 dump. Any other dump
generation fails closed
before temp databases are created.
"""

import argparse
import os
import re
import sqlite3
import sys
import tempfile

import resolve_paths

MIN_TABLES = {'main': 21, 'law': 5, 'privileged': 3}
REF_DIR = os.path.dirname(os.path.abspath(__file__)) + os.sep + '..'


def read_ref(name):
    """Read a sibling reference file (../<name>) in E1 native storage."""
    path = os.path.normpath(os.path.join(REF_DIR, name))
    with open(path, 'r', encoding='utf-8') as fh:
        return fh.read()


def parse_sections(evidence_text):
    sections = {}
    for db in ('main', 'law', 'privileged'):
        begin = re.search(rf'^-- ===== v6 BEGIN {db} =====\s*$', evidence_text, re.M)
        end = re.search(rf'^-- ===== v6 END {db} =====\s*$', evidence_text, re.M)
        if not begin or not end or end.start() <= begin.end():
            raise SystemExit(f"evidence.sql: unbalanced or missing markers for '{db}'.")
        sections[db] = evidence_text[begin.end():end.start()]
    return sections


def require_source_version(evidence_text, migrate):
    """Accept exactly the dump generation the requested rebuild mode owns."""
    first = evidence_text.splitlines()[0] if evidence_text.splitlines() else ""
    match = re.search(r"schema v(\d+)\.(\d+)", first)
    if not match:
        raise SystemExit(
            "Rebuild aborted: evidence.sql has no schema version header; "
            "native files untouched.")
    actual = int(match.group(1)) * 10 + int(match.group(2))
    accepted = (74, 75) if migrate else (90,)
    if actual not in accepted:
        expected = "v7.4 or v7.5" if migrate else "v9.0"
        mode = "migration rebuild through v7.6" if migrate else "normal v9.0 rebuild"
        raise SystemExit(
            f"Rebuild aborted: {mode} requires {expected} "
            f"dump, but evidence.sql is v{actual // 10}.{actual % 10}; "
            "native files untouched.")
    return actual


# v7.0 legal_concepts DDL, copied verbatim from ../schema.sql. Used only by the
# v6.9 -> v7.0 in-temp upgrade below; the cross-column CHECKs cannot ride ALTER
# ADD COLUMN, so the table is rebuilt (CREATE new / INSERT SELECT / DROP / RENAME).
_LC_V7_DDL = """CREATE TABLE legal_concepts_new (
    concept_id      INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    concept_type    TEXT NOT NULL CHECK(concept_type IN (
                        'cause_of_action','doctrine','test','defence','remedy')),
    description     TEXT,
    jurisdiction    TEXT,
    in_force_date   DATE,
    repeal_date     DATE,
    notes           TEXT,
    cloud_principle_id  TEXT,
    pushed_at           TEXT,
    pushed_source_hash  TEXT,
    UNIQUE(name, jurisdiction),
    CHECK ((cloud_principle_id IS NULL) = (pushed_at IS NULL)),
    CHECK ((cloud_principle_id IS NULL) = (pushed_source_hash IS NULL))
)"""

_LC_OLD_COLS = ('concept_id,name,concept_type,description,jurisdiction,'
                'in_force_date,repeal_date,notes')

_PP_V75_DDL = """CREATE TABLE proceeding_parties_new (
    proceeding_id   INTEGER NOT NULL REFERENCES proceedings(proceeding_id),
    party_id        INTEGER NOT NULL REFERENCES parties(party_id),
    role            TEXT NOT NULL CHECK(role IN (
                        'plaintiff','defendant','third_party','intervenor',
                        'applicant','respondent','petitioner',
                        'defendant_by_counterclaim')),
    PRIMARY KEY (proceeding_id, party_id, role)
)"""

_POSITIONS_V76_DDL = """CREATE TABLE positions_v76 (
    position_id     INTEGER PRIMARY KEY,
    fact_id         INTEGER NOT NULL REFERENCES facts(fact_id),
    party_id        INTEGER NOT NULL REFERENCES parties(party_id),
    position        TEXT NOT NULL CHECK(position IN (
                        'claim','admit','deny','not_admit','no_position')),
    position_basis  TEXT CHECK(position_basis IN (
                        'outside_knowledge','strict_proof','insufficient_particulars',
                        'directed_to_other_party','qualified','other')),
    qualification   TEXT,
    source_id       INTEGER REFERENCES sources(source_id),
    source_locator  TEXT,
    valid_from      TEXT NOT NULL DEFAULT (date('now')),
    valid_to        TEXT,
    prior_id        INTEGER REFERENCES positions_v76(position_id),
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes           TEXT,
    human_reviewed  INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1))
)"""

_V76_NEW_TABLES_DDL = """
CREATE TABLE relief_items (
    relief_id INTEGER PRIMARY KEY,
    proceeding_id INTEGER REFERENCES proceedings(proceeding_id),
    source_id INTEGER NOT NULL REFERENCES sources(source_id),
    seeking_party_id INTEGER NOT NULL REFERENCES parties(party_id),
    against_party_id INTEGER REFERENCES parties(party_id),
    description TEXT NOT NULL,
    source_locator TEXT,
    verified INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes TEXT,
    human_reviewed INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1))
);
CREATE TABLE relief_positions (
    relief_position_id INTEGER PRIMARY KEY,
    relief_id INTEGER NOT NULL REFERENCES relief_items(relief_id),
    party_id INTEGER NOT NULL REFERENCES parties(party_id),
    position TEXT NOT NULL CHECK(position IN ('seek','consent','oppose','no_position')),
    qualification TEXT,
    source_id INTEGER REFERENCES sources(source_id),
    source_locator TEXT,
    valid_from TEXT NOT NULL DEFAULT (date('now')),
    valid_to TEXT,
    prior_id INTEGER REFERENCES relief_positions(relief_position_id),
    verified INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes TEXT,
    human_reviewed INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1))
);
CREATE TABLE source_references (
    source_reference_id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(source_id),
    reference_type TEXT NOT NULL CHECK(reference_type IN (
        'responds_to','incorporates','adopts','paragraph_reference','procedural','other')),
    target_source_id INTEGER REFERENCES sources(source_id),
    source_locator TEXT,
    target_locator TEXT,
    description TEXT NOT NULL,
    verified INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes TEXT
);
"""


def _table_counts(path):
    c = sqlite3.connect(path)
    try:
        return {t: c.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
                for (t,) in c.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        c.close()


def upgrade_69_to_70(paths):
    """Detect a replayed v6.9 dump and upgrade its structure to v7.0 in the temp
    binaries. Idempotent: a v7.0-shaped dump is a no-op. Runs AFTER the section
    replay and BEFORE triggers/views/validation, while foreign_keys is still OFF
    -- pair #7's trigger references issue_concepts, so an un-upgraded v6.9 replay
    would also fail trigger load. Row counts of every pre-existing table are
    asserted unchanged (issue_concepts is born empty). Returns True if it fired."""
    law = sqlite3.connect(paths['law'])
    try:
        lc_cols = [r[1] for r in law.execute("PRAGMA table_info(legal_concepts)")]
        if 'cloud_principle_id' in lc_cols:
            return False                       # already v7.0 shape
        before = {db: _table_counts(p) for db, p in paths.items()}
        law.execute("PRAGMA foreign_keys = OFF")
        law.executescript(f"""
            ALTER TABLE authorities ADD COLUMN cloud_authority_id TEXT;
            {_LC_V7_DDL};
            INSERT INTO legal_concepts_new ({_LC_OLD_COLS})
                SELECT {_LC_OLD_COLS} FROM legal_concepts;
            DROP TABLE legal_concepts;
            ALTER TABLE legal_concepts_new RENAME TO legal_concepts;
            CREATE INDEX idx_legal_concepts_type  ON legal_concepts(concept_type);
            CREATE INDEX idx_legal_concepts_cloud ON legal_concepts(cloud_principle_id);
        """)
    finally:
        law.close()

    main_con = sqlite3.connect(paths['main'])
    try:
        main_con.executescript("""
            CREATE TABLE IF NOT EXISTS issue_concepts (
                issue_id   INTEGER NOT NULL REFERENCES issues(issue_id),
                concept_id INTEGER NOT NULL,
                relevance  TEXT CHECK(relevance IN ('supports','undermines','context')),
                notes      TEXT,
                PRIMARY KEY (issue_id, concept_id));
            CREATE INDEX IF NOT EXISTS idx_issue_concepts_concept
                ON issue_concepts(concept_id);
        """)
    finally:
        main_con.close()

    after = {db: _table_counts(p) for db, p in paths.items()}
    for db in before:
        for t, n in before[db].items():
            if after[db].get(t) != n:
                raise SystemExit(
                    f"Upgrade aborted: {db}.{t} rows {n} -> {after[db].get(t)}; "
                    "not touching native files.")
    return True


def upgrade_70_to_71(paths):
    """Detect a replayed v7.0 dump and upgrade concept_authorities to v7.1 in the
    temp binaries. Idempotent: a v7.1-shaped dump is a no-op. Runs AFTER the section
    replay and BEFORE triggers/views/validation. Both columns ride ALTER (single-column
    CHECK, constant default), so no table rebuild is needed. Row count is asserted
    unchanged and every row must read verified = 0. Returns True if it fired."""
    law = sqlite3.connect(paths['law'])
    try:
        ca_cols = [r[1] for r in law.execute("PRAGMA table_info(concept_authorities)")]
        if 'verified' in ca_cols:
            return False                       # already v7.1 shape
        before = _table_counts(paths['law'])
        law.execute("PRAGMA foreign_keys = OFF")
        law.executescript("""
            ALTER TABLE concept_authorities
                ADD COLUMN verified INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2));
            ALTER TABLE concept_authorities ADD COLUMN notes TEXT;
        """)
        after = _table_counts(paths['law'])
        for t, n in before.items():
            if after.get(t) != n:
                raise SystemExit(
                    f"Upgrade aborted: law.{t} rows {n} -> {after.get(t)}; "
                    "not touching native files.")
        bad = law.execute(
            "SELECT COUNT(*) FROM concept_authorities WHERE verified IS NOT 0").fetchone()[0]
        if bad:
            raise SystemExit(
                f"Upgrade aborted: {bad} concept_authorities rows did not backfill to "
                "verified = 0; not touching native files.")
    finally:
        law.close()
    return True


def upgrade_74_to_75(paths):
    """Remove the retired plaintiff_by_counterclaim value from a replayed v7.4
    proceeding_parties table. A dirty dump fails with the exact offending rows;
    a clean table is rebuilt and its row count is asserted unchanged."""
    main_con = sqlite3.connect(paths['main'])
    try:
        row = main_con.execute(
            "SELECT sql FROM sqlite_master "
            "WHERE type='table' AND name='proceeding_parties'"
        ).fetchone()
        if not row:
            raise SystemExit(
                "Upgrade aborted: main.proceeding_parties is missing; "
                "not touching native files.")
        if 'plaintiff_by_counterclaim' not in row[0]:
            return False

        offending = main_con.execute(
            "SELECT proceeding_id, party_id, role "
            "FROM proceeding_parties "
            "WHERE role = 'plaintiff_by_counterclaim' "
            "ORDER BY proceeding_id, party_id"
        ).fetchall()
        if offending:
            rendered = "; ".join(
                f"proceeding_id={proceeding_id}, party_id={party_id}, role={role}"
                for proceeding_id, party_id, role in offending
            )
            raise SystemExit(
                "Upgrade aborted: deprecated proceeding party role rows remain: "
                f"{rendered}; correct them through /matter-data before rebuilding. "
                "Native files untouched.")

        before = main_con.execute(
            "SELECT COUNT(*) FROM proceeding_parties"
        ).fetchone()[0]
        main_con.execute("PRAGMA foreign_keys = OFF")
        main_con.executescript(f"""
            {_PP_V75_DDL};
            INSERT INTO proceeding_parties_new (proceeding_id, party_id, role)
                SELECT proceeding_id, party_id, role FROM proceeding_parties;
            DROP TABLE proceeding_parties;
            ALTER TABLE proceeding_parties_new RENAME TO proceeding_parties;
            CREATE INDEX idx_proceeding_parties_party
                ON proceeding_parties(party_id);
        """)
        after = main_con.execute(
            "SELECT COUNT(*) FROM proceeding_parties"
        ).fetchone()[0]
        if after != before:
            raise SystemExit(
                f"Upgrade aborted: main.proceeding_parties rows {before} -> {after}; "
                "not touching native files.")
    finally:
        main_con.close()
    return True


def upgrade_75_to_76(paths):
    """Replace the retired silent position with explicit non-admission/no-position
    semantics, add relief/source-reference tables, and enforce current-response
    uniqueness. Existing rows are preserved. Ambiguous legacy silent rows become
    not_admit/other so no response is fabricated as an admission or denial."""
    main_con = sqlite3.connect(paths['main'])
    try:
        cols = [r[1] for r in main_con.execute("PRAGMA table_info(positions)")]
        if 'position_basis' in cols:
            return False

        duplicates = main_con.execute("""
            SELECT fact_id, party_id, COALESCE(source_id, -1),
                   COALESCE(source_locator, ''), COUNT(*)
            FROM positions
            WHERE valid_to IS NULL
            GROUP BY fact_id, party_id, COALESCE(source_id, -1),
                     COALESCE(source_locator, '')
            HAVING COUNT(*) > 1
            ORDER BY fact_id, party_id, COALESCE(source_id, -1),
                     COALESCE(source_locator, '')
        """).fetchall()
        if duplicates:
            rendered = "; ".join(
                f"fact_id={fact_id}, party_id={party_id}, source_id={source_id}, "
                f"source_locator={locator!r}, rows={count}"
                for fact_id, party_id, source_id, locator, count in duplicates
            )
            raise SystemExit(
                "Upgrade aborted: duplicate current factual positions remain: "
                f"{rendered}; correct them through /matter-data before rebuilding. "
                "Native files untouched.")

        before = main_con.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
        main_con.execute("PRAGMA foreign_keys = OFF")
        main_con.executescript(f"""
            {_POSITIONS_V76_DDL};
            INSERT INTO positions_v76 (
                position_id, fact_id, party_id, position, position_basis,
                qualification, source_id, source_locator, valid_from, valid_to,
                prior_id, verified, notes, human_reviewed
            )
            SELECT
                position_id, fact_id, party_id,
                CASE
                    WHEN position != 'silent' THEN position
                    WHEN lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%no position%'
                      OR lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%takes no position%'
                    THEN 'no_position'
                    ELSE 'not_admit'
                END,
                CASE
                    WHEN position != 'silent' THEN NULL
                    WHEN lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%no position%'
                      OR lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%takes no position%'
                    THEN NULL
                    WHEN lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%outside%knowledge%'
                      OR lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%no knowledge%'
                    THEN 'outside_knowledge'
                    WHEN lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%strict proof%'
                    THEN 'strict_proof'
                    WHEN lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%particular%'
                    THEN 'insufficient_particulars'
                    WHEN lower(coalesce(qualification, '') || ' ' || coalesce(notes, ''))
                         LIKE '%other party%'
                    THEN 'directed_to_other_party'
                    ELSE 'other'
                END,
                qualification, source_id, source_locator, valid_from, valid_to,
                prior_id, verified, notes, human_reviewed
            FROM positions;
            DROP TABLE positions;
            ALTER TABLE positions_v76 RENAME TO positions;
            CREATE INDEX idx_positions_fact_current ON positions(fact_id, valid_to);
            CREATE INDEX idx_positions_party ON positions(party_id);
            CREATE INDEX idx_positions_source ON positions(source_id);
            CREATE UNIQUE INDEX uq_positions_current_response
                ON positions(
                    fact_id, party_id, COALESCE(source_id, -1),
                    COALESCE(source_locator, ''))
                WHERE valid_to IS NULL;
            {_V76_NEW_TABLES_DDL}
            CREATE INDEX idx_relief_items_source ON relief_items(source_id);
            CREATE INDEX idx_relief_items_proceeding ON relief_items(proceeding_id);
            CREATE INDEX idx_relief_positions_relief
                ON relief_positions(relief_id, valid_to);
            CREATE INDEX idx_relief_positions_source ON relief_positions(source_id);
            CREATE UNIQUE INDEX uq_relief_positions_current_response
                ON relief_positions(
                    relief_id, party_id, COALESCE(source_id, -1),
                    COALESCE(source_locator, ''))
                WHERE valid_to IS NULL;
            CREATE INDEX idx_source_references_source
                ON source_references(source_id);
            CREATE INDEX idx_source_references_target
                ON source_references(target_source_id);
        """)
        after = main_con.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
        if after != before:
            raise SystemExit(
                f"Upgrade aborted: main.positions rows {before} -> {after}; "
                "not touching native files.")
        retired = main_con.execute(
            "SELECT COUNT(*) FROM positions WHERE position = 'silent'"
        ).fetchone()[0]
        if retired:
            raise SystemExit(
                f"Upgrade aborted: {retired} retired silent positions remain; "
                "not touching native files.")
    finally:
        main_con.close()
    return True


def views_from_queries(queries_text):
    """Return the VIEWS section of queries.sql (everything before the first
    named-query marker), to be executed with executescript().

    NOTE: splitting on ';' and filtering by startswith('CREATE VIEW') does NOT
    work here -- each split chunk starts with the *preceding* comment block,
    so the CREATE VIEW keyword is never the first token and the filter matches
    nothing, silently producing zero views. executescript() on the whole
    section avoids this (SQL comments are valid statement separators for it).
    """
    marker = ('-- =========================================================================\n'
              '-- CANONICAL QUERIES')
    return queries_text.split(marker)[0] if marker in queries_text else queries_text


def main(argv=None):
    ap = argparse.ArgumentParser(description="Atomic rebuild from evidence.sql.")
    ap.add_argument('matter_root', help="Path to the matter root folder.")
    ap.add_argument('--migrate', action='store_true',
                    help="Bypass the schema-version guard for a rebuild-only "
                         "schema transition. evidence.sql is the source.")
    args = ap.parse_args(argv)

    resolved = resolve_paths.resolve_pointer(
        args.matter_root, migrate_only=args.migrate,
        warn=lambda m: sys.stderr.write(f"WARNING: {m}\n"))

    with open(resolved['evidence_sql'], 'r', encoding='utf-8') as fh:
        evidence_text = fh.read()
    require_source_version(evidence_text, args.migrate)
    triggers_text = read_ref('triggers.sql')
    views_text = views_from_queries(read_ref('queries.sql'))

    sections = parse_sections(evidence_text)
    tmpdir = tempfile.mkdtemp(prefix='coclerk_rebuild_')
    paths = {db: os.path.join(tmpdir, f'{db}.sqlite') for db in sections}

    try:
        for db, sql in sections.items():
            c = sqlite3.connect(paths[db])
            c.execute("PRAGMA journal_mode = DELETE")
            # foreign_keys stays OFF while replaying the dump: iterdump() emits
            # CREATE TABLE/INSERT statements in alphabetical table order (not
            # dependency order) with no PRAGMA foreign_keys=OFF guard of its
            # own (unlike the real sqlite3 CLI's .dump). With foreign_keys=ON,
            # an INSERT into a table whose FK target is alphabetically later
            # fails with "no such table" before that table is ever created.
            c.execute("PRAGMA foreign_keys = OFF")
            c.executescript(sql)
            c.close()

        # A dump may carry the prior generation's views. Drop them before a
        # table-rebuild upgrade: SQLite validates dependent views during
        # ALTER TABLE RENAME and otherwise rejects the temporary missing table.
        con = sqlite3.connect(paths['main'])
        con.executescript("""
            DROP VIEW IF EXISTS review_queue;
            DROP VIEW IF EXISTS v_fact_status;
            DROP VIEW IF EXISTS v_current_positions;
        """)
        con.close()

        upgraded_75 = upgrade_74_to_75(paths)
        upgraded_76 = upgrade_75_to_76(paths)

        # Load triggers + views on the attached connection.
        con = sqlite3.connect(paths['main'])
        con.execute(f"ATTACH DATABASE '{paths['law']}' AS law")
        con.execute(f"ATTACH DATABASE '{paths['privileged']}' AS privileged")
        con.executescript(triggers_text)
        trigger_count = con.execute(
            "SELECT count(*) FROM sqlite_temp_master WHERE type='trigger'").fetchone()[0]
        if trigger_count == 0:
            con.close()
            raise SystemExit("Rebuild aborted: triggers missing; not touching native files.")
        con.executescript("""
            DROP VIEW IF EXISTS review_queue;
            DROP VIEW IF EXISTS v_fact_status;
            DROP VIEW IF EXISTS v_current_positions;
        """)
        con.executescript(views_text)
        view_count = con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='view'").fetchone()[0]
        con.close()

        table_counts = {}
        for db, path in paths.items():
            c = sqlite3.connect(path)
            n = c.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
            c.close()
            table_counts[db] = n
            if n < MIN_TABLES[db]:
                raise SystemExit(
                    f"Rebuild aborted: {db} has {n} tables (< {MIN_TABLES[db]}); "
                    "not touching native files.")

        # Stamp the version on all three: iterdump() does not capture
        # PRAGMA user_version, so a freshly rebuilt database defaults to 0
        # (read as legacy v6.2 by the guard) even though the schema is
        # genuinely current -- every subsequent operation would incorrectly
        # refuse to run until "migrate", which would then fail because the
        # columns it tries to ADD already exist.
        #
        # --migrate stamps 76, NOT the current version: this path owns only the
        # rebuild-only carve-out (74/75 -> 76). migrate.md then applies the
        # post-rebuild incremental segment (76 -> 90) and stamps 90. A normal
        # rebuild replays an already-current dump, so it stamps 90 directly.
        stamped_version = 76 if args.migrate else 90
        for db, path in paths.items():
            c = sqlite3.connect(path)
            c.execute(f"PRAGMA user_version = {stamped_version}")
            c.close()

        # All checks passed -> move the closed temp binaries into native storage.
        native = {
            'main': resolved['main_sqlite'],
            'law': resolved['law_sqlite'],
            'privileged': resolved['privileged_sqlite'],
        }
        for db in ('main', 'law', 'privileged'):
            os.makedirs(os.path.dirname(native[db]), exist_ok=True)
            os.replace(paths[db], native[db])
    except SystemExit:
        # Native files untouched; discard temp copies.
        _cleanup(tmpdir)
        raise
    except Exception as exc:
        _cleanup(tmpdir)
        raise SystemExit(f"Rebuild failed ({exc}); native files left untouched.")
    _cleanup(tmpdir)

    print("Rebuild complete.")
    for db in ('main', 'law', 'privileged'):
        print(f"  {db}: {table_counts[db]} tables -> {native[db]}")
    print(f"  triggers: {trigger_count}, views: {view_count}")
    print(f"  v7.4->v7.5 structural upgrade: {'applied' if upgraded_75 else 'not needed'}")
    print(f"  v7.5->v7.6 structural upgrade: {'applied' if upgraded_76 else 'not needed'}")
    return 0


def _cleanup(tmpdir):
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
