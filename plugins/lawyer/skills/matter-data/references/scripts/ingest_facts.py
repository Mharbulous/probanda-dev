"""ingest_facts.py -- the Path A writes for one document, from extract-facts' staged result (MODULE).

Behind `matter_data__ingest_result` contract `facts` (ingest orchestrator spec
2.1, 2.2; see ingest_common.py for the shape). It applies
operations/ingest-extract.md's Universal rules and Path A step 4 in one
transaction: register (or reuse) the top-level source as `partial`, then facts,
evidence links, factual positions, relief items and positions, source
references, the issues a court document raises (design decision #82) and, for a
witness statement or expert report, the witness rows; then flip to `complete`.
`pleading_positions.py` validates the arrays first.

    request  {"file_path", "file_hash", "results": [{"result_id", "path"}],
              "participants": {name: party_id | [party_id, ...]}, "answers": {...}, "route": {...},
              "mode": "attended"|"unattended"}

With no result (`results` empty) the extraction failed twice: the source is
registered `failed`, its honest status, and nothing else is written.

A result whose document may be privileged (a `privilege_signal` flag, or the
category `privileged`) writes nothing and is `blocked` `path_b`: the main thread
reads it as Path B with its privilege question. The category `authority` is
`blocked` `set_aside`, for /ingest's own path. An unresolved target locator is
`blocked` `unresolved` with the smallest one reported (Path A step 3), and an
`unresolved` ask offering to add that paragraph from the answered pleading.

A route with `transcript: true` adds Path A step 7: each current position of the
transcript that differs from a current position of the same party on the same
fact in a court document takes a `DISCREPANCY:` note, in the same transaction,
and nothing is resolved.

Contract `attachment` writes one attachment of an email that was just written
(`request["attachment"]` {name, file_hash}), design decisions #51, #53, #54: a
child row of the email with its own hash, no path and its file name as title,
then the same rows, on that child. A hash registered anywhere else writes
nothing (`attachment_held`). A reading that may be privileged is never Path B,
because a privileged row cannot be a child: it takes Path B's Unclear branch,
`pending`, facts only, and an ask. With no result the child is registered
`failed`, so a standalone copy of it is read afresh (#54).
"""

import json
import re

import ingest_common as c
from pleading_positions import ExtractionError, validate_extraction

CLOSE_POSITIONS = f"""
UPDATE main.positions SET valid_to = {c.TODAY}
WHERE valid_to IS NULL AND EXISTS (
  SELECT 1 FROM json_each(:doc, '$.positions') p
  WHERE main.positions.fact_id = {c.fact_of('p')}
    AND main.positions.party_id = json_extract(p.value, '$.party_id')
    AND main.positions.source_id IS {c.SOURCE}
    AND main.positions.source_locator IS json_extract(p.value, '$.locator')
    AND (main.positions.position IS NOT json_extract(p.value, '$.value')
         OR main.positions.position_basis IS NOT json_extract(p.value, '$.basis')
         OR main.positions.qualification IS NOT json_extract(p.value, '$.qualification')))
"""

INSERT_POSITIONS = f"""
INSERT INTO main.positions (fact_id, party_id, position, position_basis, qualification, source_id,
                            source_locator, valid_from, prior_id, verified, pending_reverification)
SELECT n.fact_id, n.party_id, n.value, n.basis, n.qualification, {c.SOURCE}, n.locator, {c.TODAY},
       (SELECT max(x.position_id) FROM main.positions x
        WHERE x.fact_id = n.fact_id AND x.party_id = n.party_id AND x.source_id IS {c.SOURCE}
          AND x.source_locator IS n.locator AND x.valid_to IS NOT NULL), 0, 0
FROM (SELECT {c.fact_of('p')} AS fact_id, json_extract(p.value, '$.party_id') AS party_id,
             json_extract(p.value, '$.value') AS value, json_extract(p.value, '$.basis') AS basis,
             json_extract(p.value, '$.qualification') AS qualification,
             json_extract(p.value, '$.locator') AS locator, p.key AS seq
      FROM json_each(:doc, '$.positions') p) n
WHERE NOT EXISTS (SELECT 1 FROM main.positions x
                  WHERE x.fact_id = n.fact_id AND x.party_id = n.party_id
                    AND x.source_id IS {c.SOURCE} AND x.source_locator IS n.locator AND x.valid_to IS NULL)
ORDER BY n.seq
"""

GUARD_ANSWERED = f"""
SELECT 'answered: unknown answered fact ' || json_extract(p.value, '$.fact_id')
FROM json_each(:doc, '$.positions') p
WHERE json_extract(p.value, '$.fact_id') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM main.facts f WHERE f.fact_id = json_extract(p.value, '$.fact_id')
                  AND f.description <> ''
                  AND f.source_id IS json_extract(:doc, '$.answered_source_id'))
UNION ALL
SELECT 'answered: unknown answered relief ' || json_extract(r.value, '$.relief_id')
FROM json_each(:doc, '$.relief_positions') r
WHERE json_extract(r.value, '$.relief_id') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM main.relief_items i WHERE i.relief_id = json_extract(r.value, '$.relief_id')
                  AND i.source_id IS json_extract(:doc, '$.answered_source_id'))
"""

RELIEF_OF = f"""coalesce(json_extract(r.value, '$.relief_id'),
        (SELECT min(i.relief_id) FROM main.relief_items i WHERE i.source_id = {c.SOURCE}
           AND i.seeking_party_id = json_extract(r.value, '$.seeking_party_id')
           AND i.against_party_id IS json_extract(r.value, '$.against_party_id')
           AND i.description = json_extract(r.value, '$.description')
           AND i.source_locator IS json_extract(r.value, '$.relief_locator')))"""

INSERT_RELIEF = f"""
INSERT INTO main.relief_items (proceeding_id, source_id, seeking_party_id, against_party_id, description,
                               source_locator, verified)
SELECT (SELECT proceeding_id FROM main.sources WHERE source_id = {c.SOURCE}), {c.SOURCE},
       json_extract(r.value, '$.seeking_party_id'), json_extract(r.value, '$.against_party_id'),
       json_extract(r.value, '$.description'), json_extract(r.value, '$.locator'), 0
FROM json_each(:doc, '$.relief') r
WHERE NOT EXISTS (SELECT 1 FROM main.relief_items i WHERE i.source_id = {c.SOURCE}
                    AND i.seeking_party_id = json_extract(r.value, '$.seeking_party_id')
                    AND i.against_party_id IS json_extract(r.value, '$.against_party_id')
                    AND i.description = json_extract(r.value, '$.description')
                    AND i.source_locator IS json_extract(r.value, '$.locator'))
ORDER BY r.key
"""

CLOSE_RELIEF_POSITIONS = f"""
UPDATE main.relief_positions SET valid_to = {c.TODAY}
WHERE valid_to IS NULL AND EXISTS (
  SELECT 1 FROM json_each(:doc, '$.relief_positions') r
  WHERE main.relief_positions.relief_id = {RELIEF_OF}
    AND main.relief_positions.party_id = json_extract(r.value, '$.party_id')
    AND main.relief_positions.source_id IS {c.SOURCE}
    AND main.relief_positions.source_locator IS json_extract(r.value, '$.locator')
    AND (main.relief_positions.position IS NOT json_extract(r.value, '$.value')
         OR main.relief_positions.qualification IS NOT json_extract(r.value, '$.qualification')))
"""

INSERT_RELIEF_POSITIONS = f"""
INSERT INTO main.relief_positions (relief_id, party_id, position, qualification, source_id, source_locator,
                                   valid_from, prior_id, verified)
SELECT n.relief_id, n.party_id, n.value, n.qualification, {c.SOURCE}, n.locator, {c.TODAY},
       (SELECT max(x.relief_position_id) FROM main.relief_positions x
        WHERE x.relief_id = n.relief_id AND x.party_id = n.party_id AND x.source_id IS {c.SOURCE}
          AND x.source_locator IS n.locator AND x.valid_to IS NOT NULL), 0
FROM (SELECT {RELIEF_OF} AS relief_id, json_extract(r.value, '$.party_id') AS party_id,
             json_extract(r.value, '$.value') AS value,
             json_extract(r.value, '$.qualification') AS qualification,
             json_extract(r.value, '$.locator') AS locator, r.key AS seq
      FROM json_each(:doc, '$.relief_positions') r) n
WHERE NOT EXISTS (SELECT 1 FROM main.relief_positions x
                  WHERE x.relief_id = n.relief_id AND x.party_id = n.party_id
                    AND x.source_id IS {c.SOURCE} AND x.source_locator IS n.locator AND x.valid_to IS NULL)
ORDER BY n.seq
"""

INSERT_REFERENCES = f"""
INSERT INTO main.source_references (source_id, reference_type, target_source_id, source_locator,
                                    target_locator, description, verified)
SELECT {c.SOURCE}, json_extract(r.value, '$.type'),
       (SELECT min(s.source_id) FROM main.sources s
        WHERE s.parent_source_id IS NULL AND s.title = json_extract(r.value, '$.target_title')),
       json_extract(r.value, '$.locator'), json_extract(r.value, '$.target_locator'),
       json_extract(r.value, '$.description'), 0
FROM json_each(:doc, '$.references') r
WHERE NOT EXISTS (SELECT 1 FROM main.source_references x WHERE x.source_id = {c.SOURCE}
                    AND x.reference_type = json_extract(r.value, '$.type')
                    AND x.source_locator IS json_extract(r.value, '$.locator')
                    AND x.description = json_extract(r.value, '$.description'))
ORDER BY r.key
"""

# Issues (design decision #82). An issue is matched by the id its key carries, else by its title
# without regard to case or surrounding space, matter-wide; a matched issue keeps every column.
_ISSUE_OF = """coalesce(
        (SELECT x.issue_id FROM main.issues x WHERE x.issue_id = json_extract(i.value, '$.issue_id')),
        (SELECT min(x.issue_id) FROM main.issues x
         WHERE lower(trim(x.title)) = lower(trim(json_extract(i.value, '$.title')))))"""

INSERT_ISSUES = f"""
INSERT INTO main.issues (title, description, issue_type, verified)
SELECT json_extract(i.value, '$.title'), json_extract(i.value, '$.description'),
       json_extract(i.value, '$.issue_type'), 0
FROM json_each(:doc, '$.issues') i
WHERE {_ISSUE_OF} IS NULL
  AND i.key = (SELECT min(j.key) FROM json_each(:doc, '$.issues') j
               WHERE lower(trim(json_extract(j.value, '$.title'))) = lower(trim(json_extract(i.value, '$.title'))))
ORDER BY i.key
"""

# One `[RAISED-IN:#<source_id>|<locator>]` marker per issue and document, appended (conventions.md 5).
_RAISED_IN = f"""(SELECT '[RAISED-IN:#' || {c.SOURCE} || '|' || coalesce(json_extract(i.value, '$.locator'), '') || ']'
        FROM json_each(:doc, '$.issues') i WHERE {_ISSUE_OF} = main.issues.issue_id ORDER BY i.key LIMIT 1)"""

MARK_ISSUES = f"""
UPDATE main.issues
SET notes = CASE WHEN notes IS NULL OR notes = '' THEN {_RAISED_IN} ELSE notes || char(10) || {_RAISED_IN} END
WHERE {_RAISED_IN} IS NOT NULL AND (notes IS NULL OR instr(notes, {_RAISED_IN}) = 0)
"""

# Never to a bare row (#67), and `relevance` stays NULL: ingest does not know the firm's side.
INSERT_ISSUE_FACTS = f"""
INSERT OR IGNORE INTO main.issue_facts (issue_id, fact_id)
SELECT n.issue_id, n.fact_id
FROM (SELECT {_ISSUE_OF} AS issue_id, {c.fact_of('f')} AS fact_id
      FROM json_each(:doc, '$.issues') i, json_each(i.value, '$.facts') f) n
WHERE n.issue_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM main.facts x WHERE x.fact_id = n.fact_id AND x.description <> '')
"""

# Witness statements and expert reports (ingest-extract.md, under that heading): upsert by identity and type;
# a repeat fills only NULL attributes and never adds a second witness.
INSERT_WITNESS = f"""
INSERT INTO main.witnesses (name, witness_type, report_source_id)
SELECT json_extract(:doc, '$.witness.name'), json_extract(:doc, '$.witness.type'),
       CASE WHEN json_extract(:doc, '$.witness.type') = 'expert' THEN {c.SOURCE} END
WHERE json_extract(:doc, '$.witness.name') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM main.witnesses w WHERE w.name = json_extract(:doc, '$.witness.name')
                  AND w.witness_type = json_extract(:doc, '$.witness.type'))
"""

FILL_EXPERT_REPORT = f"""
UPDATE main.witnesses SET report_source_id = {c.SOURCE}
WHERE witness_type = 'expert' AND report_source_id IS NULL AND name = json_extract(:doc, '$.witness.name')
"""

ASSIGN_WITNESS = f"""
INSERT INTO main.proceeding_witnesses (proceeding_id, witness_id)
SELECT s.proceeding_id, (SELECT min(w.witness_id) FROM main.witnesses w
                         WHERE w.name = json_extract(:doc, '$.witness.name')
                           AND w.witness_type = json_extract(:doc, '$.witness.type'))
FROM main.sources s
WHERE s.source_id = {c.SOURCE} AND s.proceeding_id IS NOT NULL
  AND json_extract(:doc, '$.witness.name') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM main.proceeding_witnesses pw
                  JOIN main.witnesses w ON w.witness_id = pw.witness_id
                  WHERE pw.proceeding_id = s.proceeding_id AND w.name = json_extract(:doc, '$.witness.name')
                    AND w.witness_type = json_extract(:doc, '$.witness.type'))
"""

# Path A step 7, by the identity a position already has: same fact, same party.
_CONTRADICTED = f"""(SELECT min(o.position_id) FROM main.positions o
        JOIN main.sources s ON s.source_id = o.source_id
        WHERE o.fact_id = main.positions.fact_id AND o.party_id = main.positions.party_id
          AND o.valid_to IS NULL AND o.source_id IS NOT {c.SOURCE} AND s.category = 'court'
          AND o.position <> main.positions.position)"""

NOTE_CONTRADICTIONS = f"""
UPDATE main.positions
SET notes = 'DISCREPANCY: contradicts pleaded position #' || {_CONTRADICTED}, verified = 2
WHERE source_id = {c.SOURCE} AND valid_to IS NULL AND notes IS NULL AND {_CONTRADICTED} IS NOT NULL
"""

REPORT_CONTRADICTIONS = {'sql': f"""
SELECT 'This transcript contradicts ' || count(*) || ' pleaded position(s). Each is noted for review.'
FROM main.positions
WHERE source_id = {c.SOURCE} AND valid_to IS NULL AND notes LIKE 'DISCREPANCY: contradicts pleaded position #%'
HAVING count(*) > 0
""", 'report': True}

_PARENT = c.top_level('$.parent_hash')
_CHILD = f"""(SELECT min(s.source_id) FROM main.sources s
        WHERE s.file_hash = json_extract(:doc, '$.source.file_hash') AND s.parent_source_id = {_PARENT})"""

GUARD_PARENT = {'sql': f"SELECT 'waiting: the email is not recorded yet' WHERE {_PARENT} IS NULL", 'refuse': True}

GUARD_ATTACHMENT_HELD = {'sql': f"""
SELECT 'attachment_held: this attachment is already registered'
WHERE EXISTS (SELECT 1 FROM main.sources s WHERE s.file_hash = json_extract(:doc, '$.source.file_hash')
                AND s.parent_source_id IS NOT {_PARENT})
   OR EXISTS (SELECT 1 FROM privileged.privileged_sources p
              WHERE p.file_hash = json_extract(:doc, '$.source.file_hash'))
""", 'refuse': True}

REGISTER_CHILD = f"""
INSERT INTO main.sources (proceeding_id, category, title, description, date, file_path, file_hash, listed,
                          verified, parent_source_id, ingestion_status, privilege_status)
SELECT p.proceeding_id, json_extract(:doc, '$.source.category'), json_extract(:doc, '$.source.title'),
       json_extract(:doc, '$.source.description'), json_extract(:doc, '$.source.date'), NULL,
       json_extract(:doc, '$.source.file_hash'), 0, 0, p.source_id, json_extract(:doc, '$.source.status'),
       json_extract(:doc, '$.source.privilege_status')
FROM main.sources p
WHERE p.source_id = {_PARENT} AND {_CHILD} IS NULL
"""


def _as_child(statement):
    """A top-level document's statement, on the attachment's child row instead."""
    return {**statement, 'sql': statement['sql'].replace(c.SOURCE, _CHILD)}


def _failed_child(request, attachment):
    route = request.get('route') or {}
    source = {'category': route.get('category') or 'correspondence', 'title': attachment['name'], 'description': None,
              'date': None, 'file_hash': attachment['file_hash'], 'status': 'failed', 'privilege_status': None}
    return {'params': {'doc': json.dumps({'source': source, 'parent_hash': request['file_hash']}, ensure_ascii=False)},
            'statements': [GUARD_PARENT, GUARD_ATTACHMENT_HELD, _as_child(c.PRIOR_STATUS), {'sql': REGISTER_CHILD},
                           _as_child(c.SELECT_SOURCE)],
            'post': [], 'markers': [], 'asks': [], 'report': [], 'title': attachment['name'], 'failed': True,
            'summary': f'Attachment {attachment["name"][:60]} could not be read and is recorded as not read.'}


def _is_party_list(value):
    """A name that means several parties is answered with two or more distinct party ids."""
    return (isinstance(value, list) and len(value) >= 2 and len(set(value)) == len(value)
            and all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in value))


def _party(name, participants, asks, where):
    """A party field's id (or list of ids) from the resolved participants, or an ask (spec 2.2):
    never guessed. A malformed list is asked again, so no list ever reaches a party id column."""
    if name is None:
        return None
    if name in participants and (not isinstance(participants[name], list) or _is_party_list(participants[name])):
        return participants[name]
    if not any(a['ref'] == name for a in asks):
        asks.append({'kind': 'participant', 'ref': name,
                     'say': f'Which party is "{name[:80]}" in this matter? '
                            'Name every party it covers if it means more than one.'})
    return None


def _each(party):
    """One row per party: a list answer stands for each party it names."""
    return party if isinstance(party, list) else [party]


def _key(key, prefix):
    """An answered key carries its id (`fact:12`, `relief:3`); a new key is the extraction's own."""
    if isinstance(key, str) and key.startswith(prefix + ':') and key[len(prefix) + 1:].isdigit():
        return int(key[len(prefix) + 1:])
    return None


def source_row(request, read, document, category, extra=None):
    route = request.get('route') or {}
    answers = request.get('answers') or {}
    row = {
        'category': category,
        'title': read.text(document, 'title', 'document') or c.title_from_path(request['file_path']),
        'description': read.text(document, 'description', 'document'),
        'date': read.text(document, 'date', 'document'),
        'file_path': c.stored_path(request['file_path']),
        'file_hash': request['file_hash'],
        'file_number': read.text(document, 'proceeding_file_number', 'document'),
        'proceeding_id': answers.get('proceeding_id') or route.get('proceeding_id'),
        'execution_status': route.get('execution') if category == 'court' else None,
        'filed_by_party_id': None, 'verified': 0, 'notes': None, 'status': 'partial',
        'privilege_status': None,
    }
    row.update(extra or {})
    return row


MARK_FAILED = f"""
UPDATE main.sources SET ingestion_status = 'failed' WHERE source_id = {c.SOURCE} AND ingestion_status IS NULL
"""


CATEGORY_SAY = ('How should this document be classified: court, correspondence, production, work product, '
                'disbursements, privileged, or a legal authority?')


def failed_plan(request, category):
    """The source registered `failed`: ingestion could not begin (extraction-protocol.md). Its
    category comes from the route or an answer; with neither, it is asked, never assumed (K-m9)."""
    if category not in c.SOURCE_CATEGORIES:
        return {'asks': [{'kind': 'category', 'ref': c.title_from_path(request['file_path']), 'say': CATEGORY_SAY}]}
    source = source_row(request, c.Reader(), {}, category, {'status': 'failed'})
    return {'params': {'doc': json.dumps({'source': source}, ensure_ascii=False)},
            'statements': [c.guard_privileged_store(), c.PRIOR_STATUS, {'sql': c.REGISTER},
                           {'sql': MARK_FAILED}, c.SELECT_SOURCE],
            'post': [], 'markers': [], 'asks': [], 'report': [], 'title': source['title'], 'failed': True}


def plan(request):
    route = request.get('route') or {}
    answers = request.get('answers') or {}
    attachment = request.get('attachment')
    if not request.get('results'):
        if attachment:
            return _failed_child(request, attachment)
        return failed_plan(request, answers.get('category') or route.get('category'))
    if len(request['results']) != 1:
        return {'problems': ['contract facts takes one result per document']}
    doc = c.load(request['results'][0])
    read = c.Reader()
    document = doc.get('document') if isinstance(doc.get('document'), dict) else {}
    category = answers.get('category') or read.text(document, 'category', 'document')
    title = read.text(document, 'title', 'document') or c.title_from_path(request['file_path'])

    # K-M4: a document that may be privileged never reaches main from an extractor's reading; it
    # goes to Path B with its question. An authority keeps /ingest's own path in v1.
    may_be_privileged = category == 'privileged' or (c.flags_of(doc, 'privilege_signal') and answers.get('category') is None)
    if may_be_privileged and not attachment:
        return {'blocked': 'path_b', 'asks': [{'kind': 'privilege', 'ref': title[:80],
                'say': f'"{title[:80]}" may be privileged. Is it privileged, not privileged, or unclear for now?'}]}
    if category == 'authority':
        return {'blocked': 'set_aside'}

    # The answered pleading's keys as they were dispatched, never the extraction's own (K-m2).
    answered = {} if attachment else request.get('answered') or {}
    try:
        validate_extraction(doc, set(answered.get('facts') or []), set(answered.get('relief') or []))
    except ExtractionError as exc:
        if str(exc).startswith('unresolved target locator: '):
            locator = str(exc).split(': ', 1)[1][:60]
            # The offer reads the real paragraph of the answered pleading; it never adds a placeholder (#25).
            return {'blocked': 'unresolved', 'report': [
                f'{title[:60]}: {locator} of the pleading it answers could not be matched, so nothing was '
                'recorded for this document.'],
                'asks': [{'kind': 'unresolved', 'ref': locator,
                          'say': f'{title[:60]} answers {locator} of the pleading it responds to, which has no '
                                 'facts on record. Shall I read that paragraph of the answered pleading, add '
                                 'what it says as unverified facts, and then read this document again?'}]}
        return {'problems': [f'invalid: {exc}']}
    except (KeyError, TypeError) as exc:
        return {'problems': [f'invalid: {exc}']}

    pending = bool(attachment) and may_be_privileged
    if pending:
        # Path B's Unclear branch: facts only, and neither a position nor a link on a pending source.
        category = 'work_product'
        doc = {**doc, 'facts': [{**f, 'evidence': None} for f in doc['facts']], 'fact_positions': [],
               'relief_items': [], 'relief_positions': [], 'source_references': []}
    asks = []
    if category not in c.SOURCE_CATEGORIES:
        asks.append({'kind': 'category', 'ref': attachment['name'] if attachment else c.title_from_path(request['file_path']),
                     'say': CATEGORY_SAY})
    participants = request.get('participants') or {}
    source = source_row(request, read, document, category)
    if attachment:
        source.update(title=attachment['name'], file_hash=attachment['file_hash'], file_path=None,
                      execution_status=None, privilege_status='pending' if pending else None)
    filer = read.text(document, 'author_or_filing_party', 'document')
    if filer and category == 'court':
        # A court document's filing party is resolved (spec 2.2); 0 answers "none of the parties".
        # A list answer (a joint filing) leaves it NULL, as 0 does: the column holds one party.
        filed = _party(filer, participants, asks, 'document')
        source['filed_by_party_id'] = None if isinstance(filed, list) else (filed or None)
    else:
        filed = participants.get(filer) if filer else None
        source['filed_by_party_id'] = None if isinstance(filed, list) else (filed or None)

    facts, by_key = [], {}
    for i, row in enumerate(doc['facts']):
        fact = c.read_fact(read, row, f'facts[{i}]')
        facts.append(fact)
        if row.get('fact_key') in by_key:
            read.problems.append(f'facts[{i}].fact_key repeats')
        by_key[row.get('fact_key')] = fact

    positions = []
    for i, row in enumerate(doc['fact_positions']):
        where = f'fact_positions[{i}]'
        key = row.get('target_fact_key')
        target = by_key.get(key)
        party = _party(read.text(row, 'party_name', where, required=True), participants, asks, where)
        qualification, locator = read.text(row, 'qualification', where), read.text(row, 'source_locator', where)
        for party_id in _each(party):
            positions.append({
                'fact_id': _key(key, 'fact'),
                'fact_locator': target['locator'] if target else None,
                'fact_description': target['description'] if target else None,
                'party_id': party_id,
                'value': row.get('value'), 'basis': row.get('position_basis'),
                'qualification': qualification, 'locator': locator,
            })

    relief, relief_by_key = [], {}
    for i, row in enumerate(doc['relief_items']):
        where = f'relief_items[{i}]'
        seeking = _party(read.text(row, 'seeking_party_name', where, required=True), participants, asks, where)
        against = _party(read.text(row, 'against_party_name', where), participants, asks, where)
        description = read.text(row, 'description', where, required=True)
        locator = read.text(row, 'source_locator', where)
        items = [{'seeking_party_id': s, 'against_party_id': a, 'description': description, 'locator': locator}
                 for s in _each(seeking) for a in _each(against)]
        relief += items
        relief_by_key[row.get('relief_key')] = items

    relief_positions = []
    for i, row in enumerate(doc['relief_positions']):
        where = f'relief_positions[{i}]'
        key = row.get('target_relief_key')
        party = _party(read.text(row, 'party_name', where, required=True), participants, asks, where)
        qualification, locator = read.text(row, 'qualification', where), read.text(row, 'source_locator', where)
        for target in relief_by_key.get(key) or [{}]:
            for party_id in _each(party):
                relief_positions.append({
                    'relief_id': _key(key, 'relief'),
                    'seeking_party_id': target.get('seeking_party_id'),
                    'against_party_id': target.get('against_party_id'),
                    'description': target.get('description'), 'relief_locator': target.get('locator'),
                    'party_id': party_id,
                    'value': row.get('value'), 'qualification': qualification, 'locator': locator,
                })

    references = []
    for i, row in enumerate(doc['source_references']):
        where = f'source_references[{i}]'
        references.append({
            'type': row.get('reference_type'),
            'target_title': read.text(row, 'target_source_title', where),
            'locator': read.text(row, 'source_locator', where),
            'target_locator': read.text(row, 'target_locator', where),
            'description': read.text(row, 'description', where, required=True),
        })
        if row.get('reference_type') not in ('responds_to', 'incorporates', 'adopts',
                                             'paragraph_reference', 'procedural', 'other'):
            read.problems.append(f'{where}.reference_type is not one of the six')

    # Only a court document raises issues, and never an attachment (#82).
    issues = []
    for i, row in enumerate((doc.get('issues') or []) if category == 'court' and not attachment else []):
        where = f'issues[{i}]'
        targets = [(key, by_key.get(key)) for key in row.get('fact_keys') or []]
        issues.append({
            'issue_id': _key(row.get('issue_key'), 'issue'),
            'title': read.text(row, 'title', where, required=True),
            'description': read.text(row, 'description', where),
            'issue_type': row.get('issue_type'),
            # The marker's own separators never come from the result.
            'locator': re.sub(r'[|\]]', ' ', read.text(row, 'source_locator', where) or ''),
            'facts': [{'fact_id': _key(key, 'fact'),
                       'fact_locator': target['locator'] if target else None,
                       'fact_description': target['description'] if target else None}
                      for key, target in targets],
        })

    if read.problems:
        return {'problems': read.problems}
    if asks:
        return {'asks': asks}

    if attachment:
        return _attachment_plan(request, attachment, source, facts, positions, relief, relief_positions, references, pending)

    witness = None
    if route.get('witness') in ('fact', 'expert') and filer:
        witness = {'name': filer, 'type': route['witness']}
    flags = {k: c.flags_of(doc, k) for k in ('date_setting', 'other_copy', 'outgoing_letter')}
    other_title = (flags['other_copy'][0].get('detail') or '').strip() if flags['other_copy'] else None

    payload = {'source': source, 'facts': facts, 'positions': positions, 'relief': relief,
               'relief_positions': relief_positions, 'references': references, 'issues': issues, 'witness': witness,
               'answered_source_id': route.get('answers_source_id'), 'other_copy_title': other_title}
    passes, markers, report = c.post_passes(request, category, request['file_path'], source['title'],
                                            source['description'], flags)
    statements = [
        c.guard_privileged_store(), c.GUARD_PRIVILEGE_CHANGE, {'sql': GUARD_ANSWERED, 'refuse': True},
        c.PRIOR_STATUS, {'sql': c.REGISTER}, {'sql': c.REFRESH},
        c.insert_facts(), c.insert_links(),
        {'sql': CLOSE_POSITIONS}, {'sql': INSERT_POSITIONS, 'count': 'positions'},
        {'sql': INSERT_RELIEF, 'count': 'relief'},
        {'sql': CLOSE_RELIEF_POSITIONS}, {'sql': INSERT_RELIEF_POSITIONS},
        {'sql': INSERT_REFERENCES},
        {'sql': INSERT_ISSUES, 'count': 'issues'}, {'sql': MARK_ISSUES}, {'sql': INSERT_ISSUE_FACTS},
        {'sql': c.LINK_ISSUES},
    ]
    if route.get('transcript'):
        statements += [{'sql': NOTE_CONTRADICTIONS}, REPORT_CONTRADICTIONS]
    if witness:
        statements += [{'sql': INSERT_WITNESS}, {'sql': FILL_EXPERT_REPORT}, {'sql': ASSIGN_WITNESS}]
    statements += [c.flip()] + c.marker_statements(markers) + [c.SELECT_SOURCE]
    if other_title:
        statements.append({'sql': f'SELECT {c.other_copy()} AS other', 'value_as': 'other'})
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements,
            'post': passes, 'markers': markers, 'asks': [], 'report': report, 'title': source['title'],
            'date': source['date'], 'other_title': other_title}


def _attachment_plan(request, attachment, source, facts, positions, relief, relief_positions, references, pending):
    payload = {'source': source, 'parent_hash': request['file_hash'], 'facts': facts, 'positions': positions,
               'relief': relief, 'relief_positions': relief_positions, 'references': references, 'answered_source_id': None}
    statements = [GUARD_PARENT, GUARD_ATTACHMENT_HELD, _as_child(c.PRIOR_STATUS), {'sql': REGISTER_CHILD}] + [
        _as_child(st) for st in (
            {'sql': c.REFRESH}, c.insert_facts(), c.insert_links(),
            {'sql': CLOSE_POSITIONS}, {'sql': INSERT_POSITIONS, 'count': 'positions'},
            {'sql': INSERT_RELIEF, 'count': 'relief'},
            {'sql': CLOSE_RELIEF_POSITIONS}, {'sql': INSERT_RELIEF_POSITIONS},
            {'sql': INSERT_REFERENCES}, c.flip(), c.SELECT_SOURCE)]
    asks = []
    if pending:
        asks.append({'kind': 'privilege', 'ref': attachment['name'][:80],
                     'say': f'Attachment {attachment["name"][:80]} may be privileged. Is it privileged, not privileged, '
                            'or unclear for now? Its facts are held back until you decide.'})
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements, 'post': [],
            'markers': [], 'asks': asks, 'report': [], 'title': attachment['name']}
