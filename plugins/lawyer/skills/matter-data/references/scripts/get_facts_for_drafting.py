#!/usr/bin/env python3
"""get_facts_for_drafting.py — facts / positions / evidence for a drafting consumer.

Read-only. Reads non-rejected, non-quarantined facts with their derived posture,
current non-quarantined positions, and current evidence links,
each with a computed citation `<file_path>#<source_locator>`. Intended for a
downstream drafting skill that needs the matter's factual record — it never
mutates and never reads evidence.sql (live state comes from staged copies).

E1-ONLY. Do not run/import/copy/stage in a mediated/sandboxed (E2) filesystem —
the mount may serve stale/truncated bytes. See ../scripts.md.

Usage:
    python3 get_facts_for_drafting.py <matter_root> [--posture P] [--category C]
"""

import argparse
import json
import sys

import fuse_safe_io
import resolve_paths


def _cite(file_path, locator):
    """Computed citation per ../../shared/conventions.md: file_path#locator."""
    if not file_path:
        return None
    return f"{file_path}#{locator}" if locator else file_path


def read_facts(con, posture=None, category=None):
    # v_fact_status gives the derived posture; join facts for source/locator.
    rows = con.execute(
        "SELECT vf.fact_id, vf.description, vf.category, vf.date_of_fact, "
        "       vf.verified, vf.posture, s.file_path, f.source_locator "
        "FROM v_fact_status vf "
        "JOIN facts f ON f.fact_id = vf.fact_id "
        "LEFT JOIN sources s ON s.source_id = f.source_id "
        "ORDER BY vf.fact_id").fetchall()
    facts = []
    for (fid, desc, cat, dof, verified, post, file_path, locator) in rows:
        if posture and post != posture:
            continue
        if category and cat != category:
            continue
        facts.append({
            'fact_id': fid, 'description': desc, 'category': cat,
            'date_of_fact': dof, 'verified': verified, 'posture': post,
            'citation': _cite(file_path, locator),
            'positions': read_positions(con, fid),
            'evidence': read_evidence(con, fid),
        })
    return facts


def read_positions(con, fact_id):
    rows = con.execute(
        "SELECT p.position_id, p.party_id, pa.name, p.position, p.qualification, "
        "       p.verified, s.file_path, p.source_locator "
        "FROM v_current_positions p "
        "LEFT JOIN parties pa ON pa.party_id = p.party_id "
        "LEFT JOIN sources s ON s.source_id = p.source_id "
        "WHERE p.fact_id = ? "
        "ORDER BY p.position_id", (fact_id,)).fetchall()
    return [{
        'position_id': pid, 'party_id': party_id, 'party_name': name,
        'position': position, 'qualification': qual, 'verified': verified,
        'citation': _cite(file_path, locator),
    } for (pid, party_id, name, position, qual, verified, file_path, locator) in rows]


def read_evidence(con, fact_id):
    # A link whose source is pending privilege review is held back (v8.7).
    rows = con.execute(
        "SELECT el.evidence_link_id, el.source_id, s.title, el.strength, "
        "       el.verified, s.file_path, el.source_locator "
        "FROM evidence_links el "
        "LEFT JOIN sources s ON s.source_id = el.source_id "
        "WHERE el.fact_id = ? AND el.valid_to IS NULL AND el.verified >= 0 "
        "  AND NOT EXISTS (SELECT 1 FROM sources ps "
        "                  WHERE ps.source_id = el.source_id "
        "                    AND ps.privilege_status = 'pending') "
        "ORDER BY el.evidence_link_id", (fact_id,)).fetchall()
    return [{
        'evidence_link_id': eid, 'source_id': source_id, 'source_title': title,
        'strength': strength, 'verified': verified,
        'citation': _cite(file_path, locator),
    } for (eid, source_id, title, strength, verified, file_path, locator) in rows]


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Read facts/positions/evidence with citations for drafting.")
    ap.add_argument('matter_root', help="Path to the matter root folder.")
    ap.add_argument('--posture', help="Filter to one derived posture "
                    "(disputed|admitted|not_admitted|no_position|claimed|unaddressed).")
    ap.add_argument('--category', help="Filter to one fact category.")
    args = ap.parse_args(argv)

    resolved = resolve_paths.resolve_pointer(
        args.matter_root, warn=lambda m: sys.stderr.write(f"WARNING: {m}\n"))
    tmpdir, copies = fuse_safe_io.stage_copies(resolved)
    try:
        # Views come from the shipped queries.sql; ensure they exist (idempotent).
        con = fuse_safe_io.open_attached(copies)
        try:
            _ensure_views(con)
            facts = read_facts(con, args.posture, args.category)
        finally:
            con.close()
    finally:
        fuse_safe_io.cleanup(tmpdir)

    print(json.dumps({'fact_count': len(facts), 'facts': facts}, indent=2))
    return 0


def _ensure_views(con):
    """Create the views from the shipped queries.sql (idempotent; v_fact_status
    is dropped and created each run, so its bare-row exclusion, #67, always holds).

    NOTE: splitting on ';' and filtering by startswith('CREATE VIEW') does NOT
    work here -- each split chunk starts with the *preceding* comment block,
    so the CREATE VIEW keyword is never the first token and the filter matches
    nothing, silently creating zero views. executescript() on the whole VIEWS
    section avoids this (SQL comments are valid statement separators for it).
    """
    import os
    ref = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'queries.sql'))
    with open(ref, 'r', encoding='utf-8') as fh:
        text = fh.read()
    marker = ('-- =========================================================================\n'
              '-- CANONICAL QUERIES')
    views_section = text.split(marker)[0] if marker in text else text
    con.executescript(views_section)


if __name__ == '__main__':
    raise SystemExit(main())
