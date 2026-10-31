"""ingest_facts.py -- the Path A writes for one document, from extract-facts' staged result (MODULE).

Behind `matter_data__ingest_result` contract `facts` (ingest orchestrator spec
2.1, 2.2; see ingest_common.py for the shape). It applies
operations/ingest-extract.md's Universal rules and Path A step 4 in one
transaction: register (or reuse) the top-level source as `partial`, then facts,
evidence links, factual positions, relief items and positions, source
references and, for a witness statement or expert report, the witness rows;
then flip to `complete`. `pleading_positions.py` validates the arrays first.

    request  {"file_path", "file_hash", "results": [{"result_id", "path"}],
              "participants": {name: party_id}, "answers": {...}, "route": {...},
              "mode": "attended"|"unattended"}

With no result (`results` empty) the extraction failed twice: the source is
registered `failed`, its honest status, and nothing else is written.

A result whose document may be privileged (a `privilege_signal` flag, or the
category `privileged`) writes nothing and is `blocked` `path_b`: the main thread
reads it as Path B with its privilege question. The category `authority` is
`blocked` `set_aside`, for /ingest's own path. An unresolved target locator is
`blocked` `unresolved` with the smallest one reported (Path A step 3).
"""

import json

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

# Witness statements and expert reports (ingest-extract.md lines 229-236): upsert by identity and type;
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



def _party(name, participants, asks, where):
    """A party field's id from the resolved participants, or an ask (spec 2.2): never guessed."""
    if name is None:
        return None
    if name in participants:
        return participants[name]
    if not any(a['ref'] == name for a in asks):
        asks.append({'kind': 'participant', 'ref': name,
                     'say': f'Which party is "{name[:80]}" in this matter?'})
    return None


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
    if not request.get('results'):
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
    if category == 'privileged' or (c.flags_of(doc, 'privilege_signal') and answers.get('category') is None):
        return {'blocked': 'path_b', 'asks': [{'kind': 'privilege', 'ref': title[:80],
                'say': f'"{title[:80]}" may be privileged. Is it privileged, not privileged, or unclear for now?'}]}
    if category == 'authority':
        return {'blocked': 'set_aside'}

    # The answered pleading's keys as they were dispatched, never the extraction's own (K-m2).
    answered = request.get('answered') or {}
    try:
        validate_extraction(doc, set(answered.get('facts') or []), set(answered.get('relief') or []))
    except ExtractionError as exc:
        if str(exc).startswith('unresolved target locator: '):
            locator = str(exc).split(': ', 1)[1][:60]
            return {'blocked': 'unresolved', 'report': [
                f'{title[:60]}: {locator} of the pleading it answers could not be matched, so nothing was '
                'recorded for this document.']}
        return {'problems': [f'invalid: {exc}']}
    except (KeyError, TypeError) as exc:
        return {'problems': [f'invalid: {exc}']}

    asks = []
    if category not in c.SOURCE_CATEGORIES:
        asks.append({'kind': 'category', 'ref': c.title_from_path(request['file_path']), 'say': CATEGORY_SAY})
    participants = request.get('participants') or {}
    source = source_row(request, read, document, category)
    filer = read.text(document, 'author_or_filing_party', 'document')
    if filer and category == 'court':
        # A court document's filing party is resolved (spec 2.2); 0 answers "none of the parties".
        source['filed_by_party_id'] = _party(filer, participants, asks, 'document') or None
    else:
        source['filed_by_party_id'] = (participants.get(filer) or None) if filer else None

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
        positions.append({
            'fact_id': _key(key, 'fact'),
            'fact_locator': target['locator'] if target else None,
            'fact_description': target['description'] if target else None,
            'party_id': _party(read.text(row, 'party_name', where, required=True), participants, asks, where),
            'value': row.get('value'), 'basis': row.get('position_basis'),
            'qualification': read.text(row, 'qualification', where),
            'locator': read.text(row, 'source_locator', where),
        })

    relief, relief_by_key = [], {}
    for i, row in enumerate(doc['relief_items']):
        where = f'relief_items[{i}]'
        item = {
            'seeking_party_id': _party(read.text(row, 'seeking_party_name', where, required=True),
                                       participants, asks, where),
            'against_party_id': _party(read.text(row, 'against_party_name', where), participants, asks, where),
            'description': read.text(row, 'description', where, required=True),
            'locator': read.text(row, 'source_locator', where),
        }
        relief.append(item)
        relief_by_key[row.get('relief_key')] = item

    relief_positions = []
    for i, row in enumerate(doc['relief_positions']):
        where = f'relief_positions[{i}]'
        key = row.get('target_relief_key')
        target = relief_by_key.get(key) or {}
        relief_positions.append({
            'relief_id': _key(key, 'relief'),
            'seeking_party_id': target.get('seeking_party_id'),
            'against_party_id': target.get('against_party_id'),
            'description': target.get('description'), 'relief_locator': target.get('locator'),
            'party_id': _party(read.text(row, 'party_name', where, required=True), participants, asks, where),
            'value': row.get('value'), 'qualification': read.text(row, 'qualification', where),
            'locator': read.text(row, 'source_locator', where),
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

    if read.problems:
        return {'problems': read.problems}
    if asks:
        return {'asks': asks}

    witness = None
    if route.get('witness') in ('fact', 'expert') and filer:
        witness = {'name': filer, 'type': route['witness']}
    flags = {k: c.flags_of(doc, k) for k in ('date_setting', 'other_copy', 'outgoing_letter')}
    other_title = (flags['other_copy'][0].get('detail') or '').strip() if flags['other_copy'] else None

    payload = {'source': source, 'facts': facts, 'positions': positions, 'relief': relief,
               'relief_positions': relief_positions, 'references': references, 'witness': witness,
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
    ]
    if witness:
        statements += [{'sql': INSERT_WITNESS}, {'sql': FILL_EXPERT_REPORT}, {'sql': ASSIGN_WITNESS}]
    statements += [c.flip()] + c.marker_statements(markers) + [c.SELECT_SOURCE]
    if other_title:
        statements.append({'sql': f'SELECT {c.other_copy()} AS other', 'value_as': 'other'})
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements,
            'post': passes, 'markers': markers, 'asks': [], 'report': report, 'title': source['title'],
            'date': source['date'], 'other_title': other_title}
