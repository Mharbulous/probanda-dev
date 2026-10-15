#!/usr/bin/env python3
"""submission_law_bridge.py — retired-filing law bridge generator (/case-data).

Turns the research payload of a **retired filing** into law-side SQL. Pure
JSON->SQL, modelled on `merge_authorities.py`: it never opens a database, never
reads a file (beyond stdin/stdout and an argument-named JSON), and never reads
the clock — `--ingested-on` is a REQUIRED argument to `--emit-sql`, so identical
input gives byte-identical output.

It contains **no SQL for any store but case-data's own law database**, and it
never learns where the payload came from beyond what the payload itself says.
The caller assembles the payload; this script only maps and emits.

Two modes:

  --summary   : what the emitted SQL would write — counts, held-back edges and
                their reason, doubt escalations, collisions to check, the
                synthetic oral citation, and any dropped rows skipped. JSON.

  --emit-sql  : one guarded SQL script for a single `case_data__execute`.

Stdlib only (json, re, argparse, sys). No sqlite3, no filesystem, no datetime.

See ../../operations/ingest-submission-law.md for the payload contract, the
worked example, and the operation that runs this script.
"""

import argparse
import json
import re
import sys

# --------------------------------------------------------------------------
# Mappings — all four are fixed by the design (see the operation doc).
# --------------------------------------------------------------------------

# Payload authority `kind` -> law.authorities.authority_type.
KIND_TO_AUTHORITY_TYPE = {
    'case': 'case_law',
    'rule': 'regulation',
    'doctrine': 'other',
}

# Payload treatment -> concept_authorities.treatment (PAST tense, CLAUDE.md #16).
# Only `overruled` is a treatment EVENT. `distinguishable` is a prospective risk
# the drafter flagged, not something a court did, so it never becomes a
# past-tense treatment; it is recorded as an idempotent noting-up note instead.
TREATMENT_TO_EDGE_TREATMENT = {
    'overruled': 'overruled',
}

# Present-tense vocabulary an oral decision may use (schema v8.5).
ORAL_TREATMENTS = ('follows', 'distinguishes', 'declines_to_follow', 'not_considered')

# A style of cause must never reach law.sqlite (CLAUDE.md #10). The neutral
# particle is the cheap, reliable tell.
STYLE_OF_CAUSE_RE = re.compile(r'\sv\.?\s', re.IGNORECASE)

# `answered` is absent on purpose: only an opposing authority's tie writes it (#48).
# The relationship values the local CHECK can hold. Their definitions are in
# .claude/skills/shared/treatment-vocabulary.md (design:
# docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md, ADR 0006).
VALID_RELATIONSHIPS = ('establishes', 'applies', 'distinguishes')


class Refused(ValueError):
    """A payload defect the caller must fix. Never worked around here."""


# --------------------------------------------------------------------------
# SQL literals
# --------------------------------------------------------------------------
def _sqlstr(v):
    """SQL string literal with ''-doubling. None -> NULL."""
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def _clean(v):
    """Normalize an optional text field: '' and whitespace-only become None."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _require(v, what):
    s = _clean(v)
    if s is None:
        raise Refused(f'{what} is required and was empty')
    return s


# --------------------------------------------------------------------------
# Bridge identity markers — the bridge rewrites ONLY rows bearing its own marker
# --------------------------------------------------------------------------
def assertion_marker(key):
    return f'[FROM-SUBMISSION:{key}]'


def statement_marker(key):
    return f'[FROM-SUBMISSION:{key}]'


def filing_marker(filing_id):
    return f'[FROM-SUBMISSION:filing#{filing_id}]'


def _key_of(row, prefix, what):
    """Payload rows are keyed `la#<id>` / `sol#<id>` / `opp#<id>` / `auth#<id>`.
    The key is the bridge's identity, so its shape is enforced, not assumed."""
    key = _require(row.get('key'), f'{what} key')
    if not re.fullmatch(re.escape(prefix) + r'#\d+', key):
        raise Refused(f'{what} key {key!r} must look like {prefix}#<id>')
    return key


def noted_up_note(ingested_on, value):
    """Idempotent noting-up note for a submission treatment that is not a
    past-tense treatment event."""
    return f'NOTED-UP {ingested_on} (submission): {value}'


NEEDS_HUMAN = 'NEEDS HUMAN: the filing recorded doubt about this statement of law'


# --------------------------------------------------------------------------
# Verification mapping
# --------------------------------------------------------------------------
def map_verified(verification, doubt):
    """`verified` -> 1; anything else -> 0; a recorded doubt -> 2 regardless.

    case-data's `1` means an isolated verifier re-read the source
    (../../shared/verification-protocol.md). The submission-side value is set by
    the legal-research gate or the practitioner, which is the equivalence the
    protocol now records explicitly — it is not a second, weaker meaning of 1.
    """
    if _clean(doubt) is not None:
        return 2
    return 1 if _clean(verification) == 'verified' else 0


# --------------------------------------------------------------------------
# Oral reasons
# --------------------------------------------------------------------------
def oral_citation(oral):
    """`Oral reasons, <court> <file_number>, <judge>, <YYYY-MM-DD>`.

    No style of cause, ever — this row is the only place a matter's own
    proceeding could leak into law.sqlite, so every component is screened for
    the neutral particle and the whole assembled citation is screened again.
    """
    court = _require(oral.get('court'), 'oral_decision.court')
    file_number = _require(oral.get('file_number'), 'oral_decision.file_number')
    judge = _require(oral.get('judge'), 'oral_decision.judge')
    decided_on = _require(oral.get('decided_on'), 'oral_decision.decided_on')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', decided_on):
        raise Refused(f'oral_decision.decided_on {decided_on!r} must be YYYY-MM-DD')
    for label, value in (('court', court), ('file_number', file_number),
                         ('judge', judge)):
        if STYLE_OF_CAUSE_RE.search(value):
            raise Refused(
                f'oral_decision.{label} {value!r} contains a style-of-cause particle; '
                'an oral-reasons citation never carries a style of cause')
    citation = f'Oral reasons, {court} {file_number}, {judge}, {decided_on}'
    if STYLE_OF_CAUSE_RE.search(citation):
        raise Refused(f'assembled oral citation {citation!r} contains a '
                      'style-of-cause particle')
    return citation


# --------------------------------------------------------------------------
# Payload -> plan
# --------------------------------------------------------------------------
def _is_dropped(row):
    """The caller excludes dead-end and dropped rows. If one arrives anyway it is
    skipped and REPORTED — never silently written, never silently discarded."""
    if row.get('dropped') is True or row.get('dead_end') is True:
        return True
    return _clean(row.get('disposition')) in ('dropped', 'dead_end')


def build_plan(payload, ingested_on):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(ingested_on or '')):
        raise Refused('--ingested-on must be an ISO date (YYYY-MM-DD)')

    source = payload.get('source') or {}
    if _clean(source.get('kind')) != 'submission_retire':
        raise Refused("source.kind must be 'submission_retire'")
    filing_id = source.get('filing_id')
    if not isinstance(filing_id, int) or isinstance(filing_id, bool) or filing_id <= 0:
        raise Refused(f'source.filing_id must be a positive integer, got {filing_id!r}')
    filing_title = _require(source.get('filing_title'), 'source.filing_title')
    retired_on = _require(source.get('retired_on'), 'source.retired_on')
    jurisdiction = _require(payload.get('jurisdiction'), 'jurisdiction')

    plan = {
        'filing_id': filing_id,
        'filing_title': filing_title,
        'retired_on': retired_on,
        'jurisdiction': jurisdiction,
        'ingested_on': ingested_on,
        'concepts': [], 'authorities': [], 'edges': [], 'treatments': [],
        'skipped_dropped': [], 'held_back': [], 'doubt': [],
        'collision_citations': [], 'oral_citation': None,
    }

    # --- assertions -> law.legal_concepts ---------------------------------
    seen_assertions = {}
    for row in payload.get('assertions') or []:
        if _is_dropped(row):
            plan['skipped_dropped'].append({'kind': 'assertion',
                                            'key': row.get('key')})
            continue
        key = _key_of(row, 'la', 'assertion')
        concept_type = _clean(row.get('concept_type')) or 'doctrine'
        if concept_type not in ('cause_of_action', 'doctrine', 'test',
                                'defence', 'remedy'):
            raise Refused(f'assertion {key}: concept_type {concept_type!r} is not '
                          'one of the five law.legal_concepts types')
        entry = {'key': key, 'name': _require(row.get('name'), f'assertion {key} name'),
                 'concept_type': concept_type,
                 'description': _clean(row.get('description')),
                 'marker': assertion_marker(key)}
        seen_assertions[key] = entry
        plan['concepts'].append(entry)

    # --- authorities (ours) and opposing authorities -----------------------
    by_key = {}

    def _authority(row, what, prefix):
        key = _key_of(row, prefix, what)
        kind = _clean(row.get('kind')) or 'case'
        if kind not in KIND_TO_AUTHORITY_TYPE:
            raise Refused(f'{what} {key}: kind {kind!r} is not one of '
                          f'{sorted(KIND_TO_AUTHORITY_TYPE)}')
        entry = {
            'key': key,
            'title': _require(row.get('title'), f'{what} {key} title'),
            'citation': _require(row.get('citation'), f'{what} {key} citation'),
            'authority_type': KIND_TO_AUTHORITY_TYPE[kind],
            'jurisdiction': _clean(row.get('jurisdiction')) or jurisdiction,
            'disposition': _clean(row.get('disposition')),
        }
        by_key[key] = entry
        plan['authorities'].append(entry)
        plan['collision_citations'].append(entry['citation'])
        return entry

    for row in payload.get('authorities') or []:
        if _is_dropped(row):
            plan['skipped_dropped'].append({'kind': 'authority', 'key': row.get('key')})
            continue
        _authority(row, 'authority', 'auth')

    # --- statements of law -> concept_authorities edges --------------------
    for row in payload.get('statements') or []:
        if _is_dropped(row):
            plan['skipped_dropped'].append({'kind': 'statement', 'key': row.get('key')})
            continue
        key = _key_of(row, 'sol', 'statement')
        akey = _require(row.get('assertion_key'), f'statement {key} assertion_key')
        aukey = _require(row.get('authority_key'), f'statement {key} authority_key')
        if akey not in seen_assertions:
            raise Refused(f'statement {key} references unknown assertion {akey}')
        if aukey not in by_key:
            raise Refused(f'statement {key} references unknown authority {aukey}')
        relationship = _clean(row.get('relationship')) or 'applies'
        if relationship not in VALID_RELATIONSHIPS:
            raise Refused(f'statement {key}: relationship {relationship!r} is not '
                          f'one of {list(VALID_RELATIONSHIPS)}')
        submission_treatment = _clean(row.get('treatment'))
        edge_treatment = TREATMENT_TO_EDGE_TREATMENT.get(submission_treatment)
        notes = [statement_marker(key)]
        if submission_treatment and edge_treatment is None:
            notes.append(noted_up_note(ingested_on, submission_treatment))
        verified = map_verified(row.get('verification'), row.get('doubt'))
        if verified == 2:
            notes.append(NEEDS_HUMAN)
            plan['doubt'].append({'key': key, 'doubt': _clean(row.get('doubt'))})
        if verified == 0:
            plan['held_back'].append({
                'key': key, 'concept': seen_assertions[akey]['name'],
                'reason': 'edge lands at verified = 0; remedy is /verify-law'})
        plan['edges'].append({
            'key': key, 'assertion_key': akey, 'authority_key': aukey,
            'relationship': relationship,
            'proposition': _clean(row.get('proposition')),
            'pinpoint': _clean(row.get('pinpoint')),
            'excerpt': _clean(row.get('excerpt')),
            'treatment': edge_treatment,
            'verified': verified,
            'notes': ' '.join(notes),
            'marker': statement_marker(key),
        })

    # --- opposing authorities ---------------------------------------------
    for row in payload.get('opposing_authorities') or []:
        if _is_dropped(row):
            plan['skipped_dropped'].append({'kind': 'opposing_authority',
                                            'key': row.get('key')})
            continue
        entry = _authority(row, 'opposing authority', 'opp')
        ties = [t for t in (row.get('answers_assertion_keys') or []) if _clean(t)]
        for tie in ties:
            if tie not in seen_assertions:
                raise Refused(f'opposing authority {entry["key"]} ties unknown '
                              f'assertion {tie}')
            key = entry['key']
            plan['edges'].append({
                'key': key, 'assertion_key': tie, 'authority_key': key,
                'relationship': 'answered',
                'proposition': _clean(row.get('proposition')),
                'pinpoint': _clean(row.get('pinpoint')),
                'excerpt': _clean(row.get('excerpt')),
                'treatment': None,
                # The practitioner's tie is the whole claim; it never crosses (#48).
                'verified': 1,
                'notes': statement_marker(key),
                'marker': statement_marker(key),
            })
        # No tie -> the authority row lands, and NO edge. An 'answered' edge
        # exists only on a practitioner tie (opposing_authorities carries no
        # link to a law assertion of its own).

    # One edge per (assertion, authority) pair — the PK. Two payload rows
    # landing on the same pair would make the emitted UPDATEs order-dependent,
    # so it is refused rather than silently letting the last one win.
    pairs = {}
    for e in plan['edges']:
        pair = (e['assertion_key'], e['authority_key'])
        if pair in pairs and pairs[pair] != e['key']:
            raise Refused(
                f'{e["key"]} and {pairs[pair]} both target the same '
                f'(assertion {pair[0]}, authority {pair[1]}) edge')
        pairs[pair] = e['key']

    plan['collision_citations'] = list(dict.fromkeys(plan['collision_citations']))

    # --- oral decision -----------------------------------------------------
    oral = payload.get('oral_decision')
    if oral:
        citation = oral_citation(oral)
        plan['oral_citation'] = citation
        plan['oral'] = {
            'citation': citation,
            'title': citation,           # never a style of cause
            'jurisdiction': _clean(oral.get('jurisdiction')) or jurisdiction,
            'disposition': _clean(oral.get('disposition')),
        }
        for t in oral.get('treatments') or []:
            aukey = _require(t.get('authority_key'), 'oral treatment authority_key')
            if aukey not in by_key:
                raise Refused(f'oral treatment references unknown authority {aukey}')
            treatment = _require(t.get('treatment'), 'oral treatment value')
            if treatment not in ORAL_TREATMENTS:
                raise Refused(f'oral treatment {treatment!r} is not one of '
                              f'{list(ORAL_TREATMENTS)}')
            scope = _clean(t.get('scope'))
            if scope is not None and scope not in ('full', 'partial'):
                raise Refused(f'oral treatment scope {scope!r} must be full or partial')
            plan['treatments'].append({
                'treated_citation': by_key[aukey]['citation'],
                'treatment': treatment, 'scope': scope,
                'notes': _clean(t.get('notes')),
            })
        # D4: an oral-reasons row never gets a concept_authorities edge — it can
        # be cited for nothing until a transcript arrives.

    return plan


# --------------------------------------------------------------------------
# Plan -> SQL
# --------------------------------------------------------------------------
def _concept_sql(c, jurisdiction, marker):
    name, juris = _sqlstr(c['name']), _sqlstr(jurisdiction)
    own = _sqlstr(c['marker'])
    notes = _sqlstr(f"{c['marker']} {marker}")
    return f"""INSERT INTO law.legal_concepts (name, concept_type, description, jurisdiction, notes)
SELECT {name}, {_sqlstr(c['concept_type'])}, {_sqlstr(c['description'])}, {juris}, {notes}
WHERE NOT EXISTS (SELECT 1 FROM law.legal_concepts
                  WHERE name = {name} AND jurisdiction = {juris});
UPDATE law.legal_concepts SET description = {_sqlstr(c['description'])}
WHERE name = {name} AND jurisdiction = {juris}
  AND instr(coalesce(notes, ''), {own}) > 0;"""


def _authority_sql(a, marker):
    cit = _sqlstr(a['citation'])
    return f"""INSERT INTO law.authorities (title, citation, authority_type, jurisdiction, disposition, notes)
SELECT {_sqlstr(a['title'])}, {cit}, {_sqlstr(a['authority_type'])},
       {_sqlstr(a['jurisdiction'])}, {_sqlstr(a['disposition'])}, {_sqlstr(marker)}
WHERE NOT EXISTS (SELECT 1 FROM law.authorities WHERE citation = {cit});"""


def _edge_sql(e, concept, authority, jurisdiction, marker):
    name, juris = _sqlstr(concept['name']), _sqlstr(jurisdiction)
    cit = _sqlstr(authority['citation'])
    own = _sqlstr(e['marker'])
    notes = _sqlstr(f"{e['notes']} {marker}")
    cols = (f"{_sqlstr(e['relationship'])}, {_sqlstr(e['proposition'])}, "
            f"{_sqlstr(e['pinpoint'])}, {_sqlstr(e['excerpt'])}, "
            f"{_sqlstr(e['treatment'])}, {e['verified']}, {notes}")
    return f"""INSERT INTO law.concept_authorities
    (concept_id, authority_id, relationship, proposition, pinpoint, excerpt,
     treatment, verified, notes)
SELECT c.concept_id, a.authority_id, {cols}
FROM law.legal_concepts c, law.authorities a
WHERE c.name = {name} AND c.jurisdiction = {juris} AND a.citation = {cit}
  AND NOT EXISTS (SELECT 1 FROM law.concept_authorities x
                  WHERE x.concept_id = c.concept_id AND x.authority_id = a.authority_id);
UPDATE law.concept_authorities SET
    relationship = {_sqlstr(e['relationship'])},
    proposition  = {_sqlstr(e['proposition'])},
    pinpoint     = {_sqlstr(e['pinpoint'])},
    excerpt      = {_sqlstr(e['excerpt'])},
    treatment    = {_sqlstr(e['treatment'])},
    verified     = {e['verified']},
    notes        = {notes}
WHERE instr(coalesce(notes, ''), {own}) > 0
  AND verified NOT IN (2, -1);"""


def _oral_sql(oral, marker):
    cit = _sqlstr(oral['citation'])
    return f"""INSERT INTO law.authorities (title, citation, authority_type, jurisdiction, disposition, notes)
SELECT {_sqlstr(oral['title'])}, {cit}, 'oral_reasons',
       {_sqlstr(oral['jurisdiction'])}, {_sqlstr(oral['disposition'])}, {_sqlstr(marker)}
WHERE NOT EXISTS (SELECT 1 FROM law.authorities WHERE citation = {cit});"""


def _treatment_sql(t, oral_citation_value, marker):
    oral_cit = _sqlstr(oral_citation_value)
    treated = _sqlstr(t['treated_citation'])
    notes = _sqlstr(f"{marker} {t['notes']}" if t['notes'] else marker)
    return f"""INSERT INTO law.authority_treatments
    (treating_authority_id, treated_authority_id, treatment, scope, notes)
SELECT o.authority_id, t.authority_id, {_sqlstr(t['treatment'])},
       {_sqlstr(t['scope'])}, {notes}
FROM law.authorities o, law.authorities t
WHERE o.citation = {oral_cit} AND t.citation = {treated}
  AND o.authority_id != t.authority_id
  AND NOT EXISTS (SELECT 1 FROM law.authority_treatments x
                  WHERE x.treating_authority_id = o.authority_id
                    AND x.treated_authority_id = t.authority_id);"""


def emit_sql(plan):
    marker = filing_marker(plan['filing_id'])
    juris = plan['jurisdiction']
    concepts = {c['key']: c for c in plan['concepts']}
    authorities = {a['key']: a for a in plan['authorities']}

    blocks = [
        f"-- ===== ingest-submission-law: filing #{plan['filing_id']} "
        f"({plan['retired_on']}) ingested {plan['ingested_on']} =====",
        f"-- Bridge identity: {marker}. This script rewrites ONLY rows carrying",
        "-- its own marker, and never an edge at verified 2 or -1.",
    ]
    for c in plan['concepts']:
        blocks.append(f"-- assertion {c['key']}")
        blocks.append(_concept_sql(c, juris, marker))
    for a in plan['authorities']:
        blocks.append(f"-- authority {a['key']}")
        blocks.append(_authority_sql(a, marker))
    if plan.get('oral'):
        blocks.append("-- oral reasons (no concept_authorities edge, by design D4)")
        blocks.append(_oral_sql(plan['oral'], marker))
    for e in plan['edges']:
        blocks.append(f"-- edge {e['key']} -> {e['assertion_key']}")
        blocks.append(_edge_sql(e, concepts[e['assertion_key']],
                                authorities[e['authority_key']], juris, marker))
    for t in plan['treatments']:
        blocks.append("-- oral treatment")
        blocks.append(_treatment_sql(t, plan['oral']['citation'], marker))
    return '\n'.join(blocks)


def summarize(plan):
    return {
        'filing_id': plan['filing_id'],
        'filing_title': plan['filing_title'],
        'retired_on': plan['retired_on'],
        'ingested_on': plan['ingested_on'],
        'jurisdiction': plan['jurisdiction'],
        'counts': {
            'concepts': len(plan['concepts']),
            'authorities': len(plan['authorities']),
            'edges': len(plan['edges']),
            'oral_treatments': len(plan['treatments']),
        },
        'oral_citation': plan['oral_citation'],
        'held_back': plan['held_back'],
        'doubt': plan['doubt'],
        'skipped_dropped': plan['skipped_dropped'],
        'collision_citations': plan['collision_citations'],
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def _read_json(path):
    if path == '-' or path is None:
        return json.load(sys.stdin)
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--summary', action='store_true')
    mode.add_argument('--emit-sql', action='store_true')
    ap.add_argument('--input', help='payload JSON; default stdin')
    ap.add_argument('--ingested-on', help='ISO date, required (never derived)')
    args = ap.parse_args(argv)

    payload = _read_json(args.input)
    try:
        plan = build_plan(payload, args.ingested_on)
        out = (json.dumps(summarize(plan), indent=2, ensure_ascii=False)
               if args.summary else emit_sql(plan))
    except Refused as e:
        sys.stderr.write(f'REFUSED: {e}\n')
        return 2
    sys.stdout.write(out + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
