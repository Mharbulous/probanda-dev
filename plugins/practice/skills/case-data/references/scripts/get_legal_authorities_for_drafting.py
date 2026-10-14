#!/usr/bin/env python3
"""get_legal_authorities_for_drafting.py — authorities / concepts / criteria for drafting.

Read-only. Reads legal knowledge from law.sqlite for a downstream drafting
consumer: legal concepts (with their elements/factors), the authorities that
shape each concept (with propositions, findings, treatment), and each authority
with its reported legal citation. law.sqlite holds reusable legal knowledge with
zero client data, so this consumer never touches main/privileged. It never
mutates.

E1-ONLY. Do not run/import/copy/stage in a mediated/sandboxed (E2) filesystem —
the mount may serve stale/truncated bytes. See ../scripts.md.

Usage:
    python3 get_legal_authorities_for_drafting.py <matter_root>
        [--concept-id N] [--concept-type T] [--jurisdiction J]
"""

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile

import resolve_paths


def read_concepts(con, concept_id=None, concept_type=None, jurisdiction=None):
    where, params = [], []
    if concept_id is not None:
        where.append("concept_id = ?")
        params.append(concept_id)
    if concept_type:
        where.append("concept_type = ?")
        params.append(concept_type)
    if jurisdiction:
        where.append("jurisdiction = ?")
        params.append(jurisdiction)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = con.execute(
        "SELECT concept_id, name, concept_type, description, jurisdiction "
        "FROM legal_concepts" + clause + " ORDER BY concept_type, name", params
    ).fetchall()
    concepts = []
    for (cid, name, ctype, desc, juris) in rows:
        concepts.append({
            'concept_id': cid, 'name': name, 'concept_type': ctype,
            'description': desc, 'jurisdiction': juris,
            'criteria': read_criteria(con, cid),
            'authorities': read_concept_authorities(con, cid),
        })
    return concepts


def read_criteria(con, concept_id):
    rows = con.execute(
        "SELECT criterion_id, requirement_type, criterion_order, "
        "       criterion_description, burden_of_proof, authority_proposition, treatment "
        "FROM legal_criteria WHERE concept_id = ? ORDER BY criterion_order",
        (concept_id,)).fetchall()
    return [{
        'criterion_id': crid, 'requirement_type': rtype, 'criterion_order': order,
        'criterion_description': cdesc, 'burden_of_proof': burden,
        'authority_proposition': prop, 'treatment': treatment,
    } for (crid, rtype, order, cdesc, burden, prop, treatment) in rows]


def read_concept_authorities(con, concept_id):
    rows = con.execute(
        "SELECT ca.relationship, ca.proposition, ca.finding, ca.obiter, ca.treatment, "
        "       a.authority_id, a.title, a.citation, a.authority_type, a.jurisdiction, "
        "       a.disposition "
        "FROM concept_authorities ca "
        "JOIN authorities a ON a.authority_id = ca.authority_id "
        # v7.1: exclude rejected edges (verified = -1). Drafting must never pull text
        # an AI verifier or the lawyer has rejected. 0/1/2 all still surface.
        "WHERE ca.concept_id = ? AND ca.verified >= 0 ORDER BY a.authority_id",
        (concept_id,)).fetchall()
    return [{
        'relationship': rel, 'proposition': prop, 'finding': finding,
        'obiter': obiter, 'treatment': treatment,
        'authority_id': aid, 'title': title, 'citation': citation,
        'authority_type': atype, 'jurisdiction': juris, 'disposition': disp,
    } for (rel, prop, finding, obiter, treatment, aid, title, citation, atype,
           juris, disp) in rows]


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Read authorities/concepts/criteria (law.sqlite) for drafting.")
    ap.add_argument('matter_root', help="Path to the matter root folder.")
    ap.add_argument('--concept-id', type=int, help="Limit to one concept_id.")
    ap.add_argument('--concept-type',
                    help="Filter concepts (cause_of_action|doctrine|test|defence|remedy).")
    ap.add_argument('--jurisdiction', help="Filter concepts by jurisdiction.")
    args = ap.parse_args(argv)

    resolved = resolve_paths.resolve_pointer(
        args.matter_root, warn=lambda m: sys.stderr.write(f"WARNING: {m}\n"))

    # law.sqlite is standalone (no client data, no cross-DB triggers needed for
    # a read); stage just that binary and open it alone.
    tmpdir = tempfile.mkdtemp(prefix='coclerk_law_')
    try:
        law_copy = os.path.join(tmpdir, 'law.sqlite')
        shutil.copy2(resolved['law_sqlite'], law_copy)
        con = sqlite3.connect(law_copy)
        con.execute("PRAGMA journal_mode = DELETE")
        try:
            concepts = read_concepts(con, args.concept_id, args.concept_type,
                                     args.jurisdiction)
        finally:
            con.close()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(json.dumps({'concept_count': len(concepts), 'concepts': concepts},
                     indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
