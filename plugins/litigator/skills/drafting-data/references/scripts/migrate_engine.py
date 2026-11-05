#!/usr/bin/env python3
"""Submission-drafting schema migration runner.

Applies the versioned schema hops in ../migrations.sql to a submission
matter database, using only the Python stdlib sqlite3 module -- no
dependencies, no build step.

Version is tracked in the db_meta table (key='schema_version'), not
PRAGMA user_version -- a deliberate departure from matter-data's convention,
fixed by the legal-submissions domain-model design (docs/Research/2026-08-18
legal-submissions plugin domain model and schema (issue 291).md, section 2.3):
db_meta also carries the 'revision' stamp bumped by every slice write, so
the schema stamp and the concurrency stamp live in the same table.

TARGET_SCHEMA_VERSION is the single place this version is stated for the
Python side. A future schema bump adds a new "-- MIGRATE <n> -> <n+1>"
section to migrations.sql (self-contained: it must end by stamping
db_meta.schema_version to its own target) and raises this constant by one.

Three hops need the engine before their SQL runs. The 27 -> 28 hop rewrites
each stored forum to its knowledge-tree key, and the key comes from /draft's
jurisdiction index, which SQL cannot read: _load_forum_tree_keys resolves
every stored value through it into temp.forum_tree_keys, and refuses, naming
the row, a value that names no venue or more than one. This is a direct
read of the index for the migration only, not the knowledge-tree resolver
(shared/knowledge-tree.md section 5), because the Python engine cannot call
the runtime. The 28 -> 29 hop
splits the requisition kind by subkind: _refuse_requisition_without_subkind
refuses, naming the row, a requisition with no subkind. The 29 -> 30 hop
backfills each filing's layout snapshot: _load_filing_layouts copies the
filing's type-file block and its venue.md block verbatim from /draft's tree
into temp.filing_layouts, and refuses, naming the row, a filing whose forum
or kind has no shipped file. It too reads the tree directly, never through
the runtime. The 42 -> 43 hop drops the submission copy of counsel of record:
_refuse_unreconciled_counsel refuses, naming the rows, an unlinked party
holding a copied value and a sent Writing with no party snapshot. The
46 -> 47 hop gives each failed, linked statement a review job:
_refuse_review_job_without_anchor refuses, naming the statements, one whose
job would have no billing anchor. The 58 -> 59 hop places each fact a
submission on a drafting Notice of Application or Application Response rests
on in the form's facts Part: _refuse_pure_law_placement refuses, naming the
Writings, one whose recorded pure-law decision that placement would clear.
"""

import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

TARGET_SCHEMA_VERSION = 81

_MARKER_RE = re.compile(r'^-- MIGRATE\s+(\d+)\s*->\s*(\d+)\s*$', re.MULTILINE)

_MIGRATIONS_SQL_PATH = Path(__file__).resolve().parent.parent / "migrations.sql"

# /draft's jurisdiction index for British Columbia (shared/knowledge-tree.md,
# "Index files"). Every stored forum is a BC venue, so its tree key is
# CAN/BC/<the venue row's code>. The index sits beside this skill in the
# checkout and in an install's skill-source/ mirror alike.
_VENUES_INDEX_PATH = (
    Path(__file__).resolve().parents[3] / "draft" / "references" / "CAN" / "BC" / "venues.json"
)
_FORUM_TREE_KEY_PREFIX = "CAN/BC/"

# /draft's knowledge tree (shared/knowledge-tree.md "Folder grammar"): a forum's
# tree key names its venue folder, which holds venue.md and Documents/, whose
# kinds.json maps each stored kind (an alias) to its type file.
_DRAFT_TREE_PATH = Path(__file__).resolve().parents[3] / "draft" / "references"


class MigrateError(RuntimeError):
    """Raised for a named migrate refusal. `code`/`details` let the MCP
    driver (plugins/litigation/mcp/src/submission/migrate.ts) relay a structured
    error instead of an opaque internal_error -- see as_dict()."""

    def __init__(self, message, code=None, details=None):
        super().__init__(message)
        self.message = message
        self.code = code or "migrate_error"
        self.details = details or {}

    def as_dict(self):
        return {"code": self.code, "message": self.message, "details": self.details}


def _load_migrations(migrations_sql_path=_MIGRATIONS_SQL_PATH):
    """Parse migrations.sql into {(from_version, to_version): sql_text}."""
    text = migrations_sql_path.read_text(encoding="utf-8")
    markers = list(_MARKER_RE.finditer(text))
    if not markers:
        raise MigrateError(f"no MIGRATE markers found in {migrations_sql_path}")
    migrations = {}
    for i, marker in enumerate(markers):
        from_version, to_version = int(marker.group(1)), int(marker.group(2))
        start = marker.end()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(text)
        migrations[(from_version, to_version)] = text[start:end].strip()
    return migrations


def _table_exists(con, name):
    return con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone() is not None


def _current_version(con):
    if not _table_exists(con, "db_meta"):
        return 0
    row = con.execute(
        "SELECT value FROM db_meta WHERE key = 'schema_version'"
    ).fetchone()
    return int(row[0]) if row else 0


def _load_forum_tree_keys(con, venues_index_path):
    """Before the 27 -> 28 hop: resolve every stored forum through the
    jurisdiction index into temp.forum_tree_keys (stored -> tree key), which
    the hop's SQL reads and drops. A stored value resolves to a venue row when
    it equals the row's code or one of its aliases, ignoring case. A value
    that resolves to no venue, or to more than one, is refused naming the
    first row that holds it: the rewrite is one-to-one or it does not run."""
    try:
        index = json.loads(Path(venues_index_path).read_text(encoding="utf-8"))
        venues = [
            (venue["code"], [alias["name"] for alias in venue["aliases"]])
            for venue in index["venues"]
        ]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise MigrateError(
            f"cannot read the venues index {venues_index_path}: {exc!r}. "
            f"Nothing of the 27 -> 28 hop was applied.",
            code="venues_index_unreadable",
            details={"path": str(venues_index_path)},
        ) from exc
    keys = {}
    for row_id, forum in con.execute(
        "SELECT id, forum FROM proceedings WHERE forum IS NOT NULL ORDER BY id"
    ):
        if forum in keys:
            continue
        wanted = forum.casefold()
        codes = sorted(
            code
            for code, aliases in venues
            if code.casefold() == wanted
            or any(alias.casefold() == wanted for alias in aliases)
        )
        if len(codes) != 1:
            raise MigrateError(
                f"proceedings row {row_id}: forum {forum!r} resolves to "
                f"{len(codes)} venues in {venues_index_path} "
                f"({', '.join(codes) or 'none'}); the 27 -> 28 hop rewrites a "
                f"forum to its tree key only when it names exactly one venue. "
                f"Nothing of that hop was applied.",
                code="forum_unresolved",
                details={"table": "proceedings", "id": row_id, "forum": forum, "venues": codes},
            )
        keys[forum] = _FORUM_TREE_KEY_PREFIX + codes[0]
    con.execute("CREATE TEMP TABLE forum_tree_keys (stored TEXT PRIMARY KEY, tree_key TEXT NOT NULL)")
    con.executemany("INSERT INTO forum_tree_keys (stored, tree_key) VALUES (?, ?)", keys.items())


def _refuse_requisition_without_subkind(con):
    """Before the 28 -> 29 hop: a requisition's split kind comes from its
    subkind, so a requisition with none is refused, naming the row."""
    row = con.execute(
        "SELECT id FROM filings WHERE kind = 'requisition' AND subkind IS NULL ORDER BY id"
    ).fetchone()
    if row is not None:
        raise MigrateError(
            f"filings row {row[0]}: kind 'requisition' has no subkind, so the "
            f"28 -> 29 hop cannot tell requisition_default_judgment from "
            f"requisition_consent. Set its subkind ('default_judgment' or "
            f"'consent') and migrate again. Nothing of that hop was applied.",
            code="requisition_without_subkind",
            details={"table": "filings", "id": row[0]},
        )


# The parties columns the 42 -> 43 hop drops: the submission copy of counsel of record.
_COPIED_COUNSEL = ("counsel_name", "counsel_firm", "counsel_phone", "counsel_email", "address_for_service")


def _refuse_unreconciled_counsel(con):
    """Before the 42 -> 43 hop, which drops the submission copy of counsel of
    record. A parties row with no case_party_id that holds a value in any of
    the five columns was never offered back to case data, and a Writing with
    filed_on set and no parties_snapshot rows, whose proceeding has a party,
    would print no counsel once the columns are gone. Either is refused,
    naming every such row. The runtime's migrate refuses before this, on these
    and on every counsel offer and parties_drift row (filing-checklists.md
    section 0)."""
    held = " OR ".join(f"{column} IS NOT NULL" for column in _COPIED_COUNSEL)
    unlinked = con.execute(
        f"SELECT id, proceeding_id, name FROM parties WHERE case_party_id IS NULL AND ({held}) ORDER BY id"
    ).fetchall()
    if unlinked:
        raise MigrateError(
            "parties rows " + ", ".join(f"{i} ({name!r}, proceeding {p})" for i, p, name in unlinked) +
            ": no case_party_id, and a counsel or address-for-service value the 42 -> 43 hop drops. "
            "Link each to its matter-data party and decide each value it holds (filing-checklists.md "
            "section 0), then migrate again. Nothing of that hop was applied.",
            code="counsel_not_reconciled",
            details={"table": "parties", "ids": [row[0] for row in unlinked]},
        )
    unsnapshotted = [row[0] for row in con.execute(
        "SELECT f.id FROM filings f WHERE f.filed_on IS NOT NULL"
        " AND NOT EXISTS (SELECT 1 FROM parties_snapshot s WHERE s.filing_id = f.id)"
        " AND EXISTS (SELECT 1 FROM parties p WHERE p.proceeding_id = f.proceeding_id) ORDER BY f.id"
    )]
    if unsnapshotted:
        raise MigrateError(
            "filings rows " + ", ".join(map(str, unsnapshotted)) +
            ": filed_on is set and no parties_snapshot row records the parties the Writing was sent "
            "with, so it would print no counsel once the 42 -> 43 hop drops the copy. Clear its "
            "filed_on (filing-checklists.md section 11) and record it again through "
            "drafting_data__record_sent or drafting_data__record_filed, which write the snapshot, "
            "then migrate again. Nothing of that hop was applied.",
            code="filed_without_party_snapshot",
            details={"table": "filings", "ids": unsnapshotted},
        )


def _refuse_review_job_without_anchor(con):
    """Before the 46 -> 47 hop, which writes a review job for every failed
    statement linked to a live Writing (migrations.sql, that hop's step 4).
    The hop flips a 'lead' row carrying a v46 finding to 'failed' first, so
    this selection reads both. A 'work' job needs a billing anchor, taken from
    the latest job holding the statement's Scrutinize key, else the
    proceeding's latest anchored job; a statement for which neither exists is
    refused here, naming every such statement, before anything is applied."""
    missing = [row[0] for row in con.execute(
        """
        SELECT sl.id FROM statements_of_law sl
        WHERE (sl.verification = 'failed' OR (sl.verification = 'lead' AND sl.doubt LIKE '%Scrutiny failed %'))
          AND (EXISTS (SELECT 1 FROM submission_law sw
                         JOIN submissions s ON s.id = sw.submission_id AND s.killed_on IS NULL
                         JOIN filing_submissions fs ON fs.submission_id = s.id
                         JOIN filings f ON f.id = fs.filing_id AND f.retired_on IS NULL
                        WHERE sw.law_assertion_id = sl.law_assertion_id)
            OR EXISTS (SELECT 1 FROM order_sought_requires r
                         JOIN filing_orders fo ON fo.order_sought_id = r.order_sought_id
                         JOIN filings f ON f.id = fo.filing_id AND f.retired_on IS NULL
                        WHERE r.excerpt_id = sl.id)
            OR EXISTS (SELECT 1 FROM filing_law fl
                         JOIN filings f ON f.id = fl.filing_id AND f.retired_on IS NULL
                        WHERE fl.statement_id = sl.id))
          AND NOT EXISTS (SELECT 1 FROM tickets t JOIN ticket_scope sc ON sc.ticket_id = t.id
                           WHERE t.status IN ('queued', 'wip') AND t.rejected_at IS NULL
                             AND t.title LIKE 'Review scrutiny finding: %'
                             AND sc.entity = 'statements_of_law' AND sc.entity_id = sl.id)
          AND NOT EXISTS (SELECT 1 FROM ticket_proposals p JOIN tickets t ON t.id = p.ticket_id
                           WHERE p.proposal_key = 'scrutinize:statements_of_law:' || sl.id AND t.billing_anchor IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.proceeding_id = sl.proceeding_id AND t.billing_anchor IS NOT NULL)
        ORDER BY sl.id
        """
    )]
    if missing:
        raise MigrateError(
            "statements_of_law rows " + ", ".join(map(str, missing)) +
            ": a failed scrutiny the 46 -> 47 hop gives a review job, and no job holding the "
            "statement's Scrutinize key and no job of its proceeding carries a billing anchor, so "
            "the job would have none. Give the proceeding a job with a billing anchor "
            "(references/jobs-create.md section 3), then migrate again. Nothing of that hop was applied.",
            code="review_job_anchor_missing",
            details={"table": "statements_of_law", "ids": missing},
        )


def _refuse_pure_law_placement(con):
    """Before the 58 -> 59 hop, whose backfill places every fact a submission
    on a drafting Notice of Application or Application Response rests on in
    the form's facts Part (migrations.sql, that hop's step 3). A placed fact
    clears a recorded pure-law decision through reset_pure_law_on_fact_ins,
    so a Writing whose pure_law_on is set and that would gain a fact is
    refused here, naming every such Writing and its facts, before anything is
    applied."""
    blocked = {}
    for filing_id, fact_id in con.execute(
        """
        SELECT DISTINCT f.id, sf.fact_id
          FROM filings f
          JOIN filing_submissions fs ON fs.filing_id = f.id AND fs.document = 'form'
          JOIN submission_facts sf ON sf.submission_id = fs.submission_id
         WHERE f.kind IN ('notice_of_application', 'application_response')
           AND f.filed_on IS NULL AND f.retired_on IS NULL AND f.pure_law_on IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM filing_facts ff
                            WHERE ff.filing_id = f.id AND ff.document = 'form' AND ff.fact_id = sf.fact_id
                              AND ff.part = CASE f.kind WHEN 'notice_of_application' THEN 'part2' ELSE 'part4' END)
         ORDER BY f.id, sf.fact_id
        """
    ):
        blocked.setdefault(filing_id, []).append(str(fact_id))
    if blocked:
        raise MigrateError(
            "filings rows " + "; ".join(f"{filing_id} (facts {', '.join(facts)})" for filing_id, facts in blocked.items()) +
            ": counsel's pure-law decision is recorded, and each fact named is attached to a submission on "
            "the Writing's form but not placed in its facts Part. The 58 -> 59 hop places it, which would "
            "clear the decision. Detach each fact from its submission, or clear pure_law_on and "
            "pure_law_note together, then migrate again. Nothing of that hop was applied.",
            code="pure_law_would_clear",
            details={"table": "filings", "ids": list(blocked)},
        )


def _layout_block(path):
    """The raw text of a file's layout block: the first top-level fenced json
    block after the front matter, its lines joined by "\\n" -- the block the
    runtime's extractJsonBlock parses (plugins/litigation/mcp/src/knowledge/
    declared-layout.ts, called with exactlyOne). Raises ValueError, worded as
    that function words it, when the file has no such block, more than one, or
    leaves the block unclosed."""
    lines = re.split(r"\r?\n", Path(path).read_text(encoding="utf-8"))
    start = 0
    if lines[0].rstrip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].rstrip() in ("---", "...")), None)
        start = len(lines) if end is None else end + 1
    opens = []
    fence = None
    for i in range(start, len(lines)):
        line = lines[i]
        if fence is None:
            opening = re.match(r"(`{3,}|~{3,})", line)
            if not opening:
                continue
            fence = opening.group(1)
            if re.fullmatch(r"```json\s*", line):
                opens.append(i)
        elif len(line.rstrip()) >= len(fence) and line.rstrip() == fence[0] * len(line.rstrip()):
            fence = None
    if not opens:
        raise ValueError("has no fenced json block after its front matter")
    if len(opens) > 1:
        raise ValueError(f"carries {len(opens)} fenced json blocks; exactly one is allowed")
    close = next((j for j in range(opens[0] + 1, len(lines)) if re.fullmatch(r"```\s*", lines[j])), None)
    if close is None:
        raise ValueError("its fenced json block is never closed")
    return "\n".join(lines[opens[0] + 1:close])


def _cited_rule_refs(block):
    """Every rule_ref a layout block cites (shared/declared-layout.md section 7):
    a field written as exactly {value, rule_ref}, or a part carrying rule_ref."""
    refs = [v["rule_ref"] for v in block.values() if isinstance(v, dict) and set(v) == {"value", "rule_ref"}]
    parts = block.get("parts")
    if isinstance(parts, list):
        refs += [p["rule_ref"] for p in parts if isinstance(p, dict) and "rule_ref" in p]
    return refs


def _load_filing_layouts(con, draft_tree_path):
    """Before the 29 -> 30 hop: build temp.filing_layouts (filing_id ->
    needs_forum_parts, layout_snapshot), which the hop's SQL reads and drops.
    Each filing's venue folder is its forum's tree key under /draft's tree; its
    type file is the Documents/kinds.json row that carries the stored kind as
    an alias. The snapshot is {"layout": <type block>, "venue": <venue.md
    block>, "passage_hashes": {}}, both blocks copied verbatim. A filing whose
    venue.md, kinds row or type file is missing, or whose block is unreadable,
    is refused naming the first such row: the backfill is complete or it does
    not run. A block that cites a rule_ref is refused too, because the
    snapshot owes that rule_ref's passage hash and the shipped files record
    none; this hop never fetches."""
    tree = Path(draft_tree_path)
    layouts = {}  # (forum, kind) -> (needs_forum_parts, layout_snapshot)
    rows = []
    for filing_id, kind, forum in con.execute(
        "SELECT f.id, f.kind, p.forum FROM filings f JOIN proceedings p ON p.id = f.proceeding_id ORDER BY f.id"
    ):
        if (forum, kind) not in layouts:
            venue_dir = tree.joinpath(*forum.split("/"))

            def refuse(problem, path):
                raise MigrateError(
                    f"filings row {filing_id}: kind {kind!r} on forum {forum!r}: {problem} "
                    f"({path}). The 29 -> 30 hop snapshots every filing's layout from "
                    f"/draft's shipped tree or does not run. Nothing of that hop was applied.",
                    code="layout_unresolved",
                    details={"table": "filings", "id": filing_id, "kind": kind, "forum": forum, "path": str(path)},
                )

            kinds_path = venue_dir / "Documents" / "kinds.json"
            try:
                kinds = json.loads(kinds_path.read_text(encoding="utf-8"))["kinds"]
                files = [row["file"] for row in kinds if any(alias["name"] == kind for alias in row["aliases"])]
            except (OSError, ValueError, KeyError, TypeError) as exc:
                refuse(f"no readable kinds index: {exc!r}", kinds_path)
            if len(files) != 1:
                refuse(f"the kinds index maps this kind to {len(files)} type files", kinds_path)
            blocks = {}
            for part, path in (("layout", venue_dir / "Documents" / f"{files[0]}.md"), ("venue", venue_dir / "venue.md")):
                try:
                    text = _layout_block(path)
                except (OSError, UnicodeDecodeError) as exc:
                    refuse(f"no readable file: {exc!r}", path)
                except ValueError as exc:
                    refuse(str(exc), path)
                try:
                    parsed = json.loads(text)
                except ValueError as exc:
                    refuse(f"no readable file: {exc!r}", path)
                if not isinstance(parsed, dict):
                    refuse("no fenced json block holding an object", path)
                cited = _cited_rule_refs(parsed)
                if cited:
                    refuse(f"its block cites rule_ref {', '.join(map(repr, cited))}, whose passage hash no shipped file records", path)
                blocks[part] = (text, parsed)
            needs_forum = blocks["layout"][1].get("needs_forum_parts")
            if not isinstance(needs_forum, bool):
                refuse("needs_forum_parts is not true or false", venue_dir / "Documents" / f"{files[0]}.md")
            snapshot = f'{{"layout": {blocks["layout"][0]}, "venue": {blocks["venue"][0]}, "passage_hashes": {{}}}}'
            layouts[(forum, kind)] = (int(needs_forum), snapshot)
        rows.append((filing_id, *layouts[(forum, kind)]))
    con.execute(
        "CREATE TEMP TABLE filing_layouts (filing_id INTEGER PRIMARY KEY, needs_forum_parts INTEGER NOT NULL, layout_snapshot TEXT NOT NULL)"
    )
    con.executemany("INSERT INTO filing_layouts (filing_id, needs_forum_parts, layout_snapshot) VALUES (?, ?, ?)", rows)


def _backup_db(db_path):
    """Copy db_path aside (timestamped, UTC) before the first hop touches a
    pre-existing database. Deliberately minimal (#353): not matter-data's
    plan/apply/restore ceremony, just the copy-aside. The bare-file copy is
    complete because this database is contractually journal_mode=DELETE
    (enforced by data/backend.ts's guard), so no -wal/-shm sidecars exist,
    and at call time this process holds only a read-idle connection.
    Never overwrites: a same-second rerun after a failed hop must not
    clobber the pristine copy with a half-migrated one."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = Path(f"{db_path}.bak-{stamp}")
    n = 1
    while backup_path.exists():
        backup_path = Path(f"{db_path}.bak-{stamp}-{n}")
        n += 1
    try:
        shutil.copy2(db_path, backup_path)
    except OSError as exc:
        raise MigrateError(
            f"could not write pre-migration backup {backup_path}: {exc}",
            code="backup_failed",
            details={"db_path": str(db_path)},
        )
    return backup_path


def migrate(
    db_path,
    target_version=TARGET_SCHEMA_VERSION,
    migrations_sql_path=_MIGRATIONS_SQL_PATH,
    venues_index_path=_VENUES_INDEX_PATH,
    draft_tree_path=_DRAFT_TREE_PATH,
):
    """Apply every pending migration hop to db_path, in order. Each hop
    runs via executescript, which is autocommit -- a failure partway
    through a hop leaves that hop's statements applied up to the failure
    point, not rolled back; recovery for a fresh matter database is
    delete-and-rerun, and for a pre-existing database is copying back the
    timestamped .bak-* file this function writes beside it before applying
    any hop (a fresh create backs up nothing -- there is nothing to
    protect; #353). The MCP wrapper removes older .bak-* copies after a
    successful migrate, keeping the one taken before its first hop
    (source/lawyer/mcp/src/migrate-backups.ts). A refusal before a hop (the 27 -> 28, 28 -> 29,
    29 -> 30, 42 -> 43, 46 -> 47 and 58 -> 59 checks) leaves the database at the
    version the hops before it reached.
    A fresh create skips the disk sync and the new journal file of each
    statement, which took nearly all of its time (#241), and syncs the file
    once at the end. The journal stays on disk, so a killed run still rolls
    back its open statement, and a power cut during a create falls under
    delete-and-rerun. A pre-existing database is migrated with the defaults.
    Returns the list of (from, to) hops applied -- an empty list means the
    database was already at target_version."""
    migrations = _load_migrations(migrations_sql_path)
    db_existed = Path(db_path).exists()  # before connect -- connect creates the file
    con = sqlite3.connect(db_path)
    applied = []
    try:
        con.execute("PRAGMA foreign_keys = ON")
        current = _current_version(con)
        if db_existed and current < target_version:
            _backup_db(db_path)
        if not db_existed:
            con.execute("PRAGMA synchronous = OFF")
            con.execute("PRAGMA journal_mode = PERSIST")
        while current < target_version:
            hop = next(
                ((f, t) for (f, t) in migrations if f == current), None
            )
            if hop is None:
                raise MigrateError(
                    f"no migration hop from version {current} "
                    f"(target {target_version}) -- a hop served by neither "
                    f"a marker nor a carve-out is a hard fail"
                )
            if hop == (27, 28):
                _load_forum_tree_keys(con, venues_index_path)
            elif hop == (28, 29):
                _refuse_requisition_without_subkind(con)
            elif hop == (29, 30):
                _load_filing_layouts(con, draft_tree_path)
            elif hop == (42, 43):
                _refuse_unreconciled_counsel(con)
            elif hop == (46, 47):
                _refuse_review_job_without_anchor(con)
            elif hop == (58, 59):
                _refuse_pure_law_placement(con)
            con.executescript(migrations[hop])
            con.commit()
            applied.append(hop)
            current = hop[1]
        if not db_existed:
            con.execute("PRAGMA journal_mode = DELETE")
    finally:
        con.close()
    if not db_existed:
        with open(db_path, "r+b") as created:
            os.fsync(created.fileno())
    return applied


def run(request):
    """Entry point for the drafting_data__migrate MCP tool
    (plugins/litigation/mcp/src/submission/migrate.ts): one JSON request in,
    one JSON-serializable result dict out, MigrateError on refusal. The
    driver holds no schema knowledge -- this is the whole contract.

    request = {"db_path": str, "target_version"?: int}

    target_version, when given, stops the run at that version, no higher than
    TARGET_SCHEMA_VERSION: the runtime migrates a database that predates the
    case_party_id link to v42 first, so it can read the links before the
    42 -> 43 hop.
    """
    db_path = request.get("db_path")
    if not db_path:
        raise MigrateError("request missing required 'db_path'", code="invalid_request")
    target_version = request.get("target_version", TARGET_SCHEMA_VERSION)
    if type(target_version) is not int or not 0 < target_version <= TARGET_SCHEMA_VERSION:
        raise MigrateError(
            f"target_version must be an integer from 1 to {TARGET_SCHEMA_VERSION}, got {target_version!r}",
            code="invalid_request",
        )

    hops = migrate(db_path, target_version=target_version)

    con = sqlite3.connect(db_path)
    try:
        row = con.execute(
            "SELECT value FROM db_meta WHERE key = 'schema_version'"
        ).fetchone()
    finally:
        con.close()

    return {
        "applied": [{"from": f, "to": t} for (f, t) in hops],
        "schema_version": int(row[0]) if row else None,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: migrate_engine.py <db_path>", file=sys.stderr)
        sys.exit(1)
    print(run({"db_path": sys.argv[1]}))
