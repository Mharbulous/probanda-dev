"""ingest_affidavit.py -- the Path C writes for an affidavit, from extract-affidavit's staged results (MODULE).

Behind `matter_data__ingest_result` contracts `affidavit_body` and
`affidavit_exhibits` (ingest orchestrator spec 2.1-2.3; see ingest_common.py for
the shape).

affidavit_body (Pass 1): one transaction. The body row is registered (or
reused) `partial`, with its execution status; the deponent is upserted as a
fact witness and assigned to the body's proceeding; the body facts carry their
basis of knowledge and informant. An informant the extractor flagged
`privilege_signal` is written NULL, never into main (ingest-extract.md L268),
and an ask says so. A rendered `.docx` body has no exhibits: it is flipped to
`complete` at once.

affidavit_exhibits (Pass 3): one transaction, each exhibit in its own statement
group, so an exhibit that fails is rolled back alone and the rest go on (spec
2.3). An exhibit is deduplicated by (parent, letter in its title). `needs_human`
or an uncertain stamp letter writes it `verified = 2`; a privilege signal
writes it as Path B's Unclear branch (facts only, `privilege_status =
'pending'`) and asks. An exhibit whose extraction failed twice is registered
`failed` at `verified = 2`. The call in which every expected letter has a row
sets the body's final status: `complete`, or `partial` when the run could not
locate some exhibits the body lists (`deferred`).

    request  {..., "exhibits": {"expected": [L], "failed": [L], "deferred": [L], "uncertain": [L]}}
"""

import json

import ingest_common as c

BODY = c.top_level()

UPSERT_DEPONENT = """
INSERT INTO main.witnesses (name, witness_type)
SELECT json_extract(:doc, '$.deponent'), 'fact'
WHERE json_extract(:doc, '$.deponent') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM main.witnesses w
                  WHERE w.name = json_extract(:doc, '$.deponent') AND w.witness_type = 'fact')
"""

ASSIGN_DEPONENT = f"""
INSERT INTO main.proceeding_witnesses (proceeding_id, witness_id)
SELECT s.proceeding_id, (SELECT min(w.witness_id) FROM main.witnesses w
                         WHERE w.name = json_extract(:doc, '$.deponent') AND w.witness_type = 'fact')
FROM main.sources s
WHERE s.source_id = {BODY} AND s.proceeding_id IS NOT NULL AND json_extract(:doc, '$.deponent') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM main.proceeding_witnesses pw JOIN main.witnesses w ON w.witness_id = pw.witness_id
                  WHERE pw.proceeding_id = s.proceeding_id AND w.name = json_extract(:doc, '$.deponent')
                    AND w.witness_type = 'fact')
"""

GUARD_BODY = {'sql': f"SELECT 'waiting: the affidavit body is not registered yet' WHERE {BODY} IS NULL",
              'refuse': True}

_EXHIBIT = f"""(SELECT min(e.source_id) FROM main.sources e
        WHERE e.parent_source_id = {BODY}
          AND (e.title = 'Exhibit ' || json_extract(:ex, '$.letter')
               OR e.title LIKE 'Exhibit ' || json_extract(:ex, '$.letter') || ' %'))"""

REGISTER_EXHIBIT = f"""
INSERT INTO main.sources (proceeding_id, category, title, description, date, file_path, file_hash, listed,
                          verified, notes, parent_source_id, ingestion_status, privilege_status)
SELECT b.proceeding_id, b.category, json_extract(:ex, '$.title'), json_extract(:ex, '$.description'),
       json_extract(:ex, '$.date'), b.file_path, b.file_hash, 0, json_extract(:ex, '$.verified'),
       json_extract(:ex, '$.notes'), b.source_id, json_extract(:ex, '$.status'),
       json_extract(:ex, '$.privilege_status')
FROM main.sources b
WHERE b.source_id = {BODY} AND {_EXHIBIT} IS NULL
"""

EXHIBIT_FACTS = f"""
INSERT INTO main.facts (description, category, date_of_fact, source_id, source_locator, verified,
                        created_date, notes, pending_reverification)
SELECT json_extract(f.value, '$.description'), json_extract(f.value, '$.category'),
       json_extract(f.value, '$.date_of_fact'), {_EXHIBIT}, json_extract(f.value, '$.locator'),
       json_extract(f.value, '$.verified'), {c.TODAY}, json_extract(f.value, '$.notes'), 0
FROM json_each(:ex, '$.facts') f
WHERE NOT EXISTS (SELECT 1 FROM main.facts x WHERE x.source_id = {_EXHIBIT}
                    AND x.source_locator IS json_extract(f.value, '$.locator')
                    AND x.description = json_extract(f.value, '$.description'))
ORDER BY f.key
"""

EXHIBIT_LINKS = f"""
INSERT INTO main.evidence_links (source_id, fact_id, source_locator, strength, valid_from, verified, notes)
SELECT {_EXHIBIT}, n.fact_id, n.locator, n.strength, {c.TODAY}, n.verified, n.notes
FROM (SELECT (SELECT min(x.fact_id) FROM main.facts x WHERE x.source_id = {_EXHIBIT}
                AND x.source_locator IS json_extract(f.value, '$.locator')
                AND x.description = json_extract(f.value, '$.description')) AS fact_id,
             json_extract(f.value, '$.locator') AS locator,
             json_extract(f.value, '$.evidence.strength') AS strength,
             json_extract(f.value, '$.evidence.verified') AS verified,
             json_extract(f.value, '$.evidence.notes') AS notes, f.key AS seq
      FROM json_each(:ex, '$.facts') f
      WHERE json_type(f.value, '$.evidence') = 'object'
        AND json_extract(:ex, '$.privilege_status') IS NULL) n
WHERE NOT EXISTS (SELECT 1 FROM main.evidence_links x
                  WHERE x.source_id = {_EXHIBIT} AND x.fact_id = n.fact_id AND x.valid_to IS NULL)
ORDER BY n.seq
"""

FINAL_STATUS = f"""
UPDATE main.sources
SET ingestion_status = CASE WHEN json_array_length(:doc, '$.deferred') = 0 THEN 'complete' ELSE 'partial' END,
    last_ingested_at = {c.TODAY}
WHERE source_id = {BODY} AND ingestion_status = 'partial'
  AND (SELECT count(*) FROM json_each(:doc, '$.expected') l
       WHERE EXISTS (SELECT 1 FROM main.sources e WHERE e.parent_source_id = {BODY}
                     AND (e.title = 'Exhibit ' || l.value OR e.title LIKE 'Exhibit ' || l.value || ' %')))
      = json_array_length(:doc, '$.expected')
"""

SELECT_FINAL = {'sql': f"SELECT (SELECT ingestion_status FROM main.sources WHERE source_id = {BODY}) AS final",
                'value_as': 'final'}


def _body_plan(request, read):
    route = request.get('route') or {}
    answers = request.get('answers') or {}
    category = answers.get('category') or route.get('category') or 'court'
    if not request.get('results'):
        source = _source(request, category, 'failed')
        return {'params': {'doc': json.dumps({'source': source}, ensure_ascii=False)},
                'statements': [c.guard_privileged_store(), c.PRIOR_STATUS, {'sql': c.REGISTER}, c.SELECT_SOURCE],
                'post': [], 'markers': [], 'asks': [], 'report': [], 'title': source['title'], 'failed': True}
    if len(request['results']) != 1:
        return {'problems': ['contract affidavit_body takes one result']}
    doc = c.load(request['results'][0])
    deponent = doc.get('deponent') if isinstance(doc.get('deponent'), dict) else {}
    name = read.text(deponent, 'name', 'deponent', required=True)
    signals = {f.get('ref') for f in c.flags_of(doc, 'privilege_signal')}
    facts, asks = [], []
    for i, row in enumerate(read.items(doc, 'body_facts', 'result')):
        fact = c.read_fact(read, row, f'body_facts[{i}]', with_knowledge=True)
        if fact.get('informant') and fact['locator'] in signals:
            fact['informant'] = None
            asks.append({'kind': 'privileged_informant', 'ref': fact['locator'] or str(i),
                         'say': f'The source of the information at {fact["locator"]} may be privileged, so it '
                                'was left out of the case record. Say which privileged document it comes from '
                                'to record it there.'})
        facts.append(fact)
    if read.problems:
        return {'problems': read.problems}

    source = _source(request, category, 'partial')
    source['title'] = c.title_from_path(request['file_path'])
    if route.get('page_range'):
        source['notes'] = f"Book segment pp. {route['page_range']}"
    flags = {k: c.flags_of(doc, k) for k in ('date_setting', 'other_copy', 'outgoing_letter')}
    other_title = (flags['other_copy'][0].get('detail') or '').strip() if flags['other_copy'] else None
    passes, markers, report = c.post_passes(request, category, request['file_path'], source['title'],
                                            None, flags)
    payload = {'source': source, 'deponent': name, 'facts': facts, 'other_copy_title': other_title}
    statements = [
        c.guard_privileged_store(), c.GUARD_PRIVILEGE_CHANGE, c.PRIOR_STATUS,
        {'sql': c.REGISTER}, {'sql': c.REFRESH},
        {'sql': UPSERT_DEPONENT}, {'sql': ASSIGN_DEPONENT},
        c.insert_facts(with_knowledge=True),
    ]
    if route.get('rendering'):
        # A Word body embeds no exhibits (ingest-extract.md Path C): complete once Pass 1 commits.
        statements.append(c.flip())
    statements += c.marker_statements(markers) + [c.SELECT_SOURCE]
    if other_title:
        statements.append({'sql': f'SELECT {c.other_copy()} AS other', 'value_as': 'other'})
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements,
            'post': passes, 'markers': markers, 'asks': asks, 'report': report, 'title': source['title'],
            'date': None}


def _source(request, category, status):
    route = request.get('route') or {}
    answers = request.get('answers') or {}
    return {'category': category, 'title': c.title_from_path(request['file_path']), 'description': None,
            'date': None, 'file_path': c.stored_path(request['file_path']), 'file_hash': request['file_hash'],
            'file_number': None, 'proceeding_id': answers.get('proceeding_id') or route.get('proceeding_id'),
            'execution_status': route.get('execution'), 'filed_by_party_id': None, 'verified': 0,
            'notes': None, 'status': status, 'privilege_status': None}


def _exhibit(read, doc, letter_hint, uncertain):
    letter = read.text(doc, 'exhibit_letter', 'result') or letter_hint
    title = read.text(doc, 'title', 'result')
    signal = bool(c.flags_of(doc, 'privilege_signal'))
    notes = None
    if letter in uncertain:
        notes = f'OCR: the stamp letter {letter} was not read with certainty.'
    facts = [c.read_fact(read, row, f'facts[{i}]') for i, row in enumerate(read.items(doc, 'facts', 'result'))]
    return {
        'letter': letter,
        'title': f'Exhibit {letter} — {title}' if title else f'Exhibit {letter}',
        'description': read.text(doc, 'description', 'result'),
        'date': read.text(doc, 'date', 'result'),
        'verified': 2 if doc.get('needs_human') or notes else 0,
        'notes': notes, 'status': 'complete',
        'privilege_status': 'pending' if signal else None,
        'facts': facts,
    }


def _exhibits_plan(request, read):
    run = request.get('exhibits') or {}
    uncertain = set(run.get('uncertain') or [])
    groups, written, asks = [], [], []
    for entry in request.get('results') or []:
        doc = c.load(entry)
        hint = (entry.get('ref') or '').rsplit(':', 1)[-1]
        ex_read = c.Reader()
        ex = _exhibit(ex_read, doc, hint, uncertain)
        if ex_read.problems:
            # A result that fails its contract is still recorded, at verified = 2 (spec 2.3).
            ex = {**ex, 'facts': [], 'verified': 2, 'status': 'failed',
                  'notes': 'UNCONFIRMED: the exhibit could not be read into the record.'}
        if ex['privilege_status']:
            asks.append({'kind': 'privilege', 'ref': ex['letter'],
                         'say': f'Exhibit {ex["letter"]} may be privileged. Is it privileged, not privileged, '
                                'or unclear for now? Its facts are held back until you decide.'})
        groups.append(_group(ex))
        written.append(ex['letter'])
    for letter in run.get('failed') or []:
        if letter not in written:
            groups.append(_group({'letter': letter, 'title': f'Exhibit {letter}', 'description': None,
                                  'date': None, 'verified': 2, 'notes': None, 'status': 'failed',
                                  'privilege_status': None, 'facts': []}))
    payload = {'source': {'file_hash': request['file_hash']}, 'expected': run.get('expected') or [],
               'deferred': run.get('deferred') or []}
    statements = [GUARD_BODY, c.PRIOR_STATUS] + groups + [{'sql': FINAL_STATUS}, SELECT_FINAL, c.SELECT_SOURCE]
    report = []
    if run.get('deferred'):
        report.append('Exhibits ' + ', '.join(run['deferred'])[:120] + ' could not be located in the file '
                      'and were not read.')
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements,
            'post': [], 'markers': [], 'asks': asks, 'report': report, 'title': None, 'date': None}


def _group(ex):
    return {'ref': ex['letter'], 'params': {'ex': json.dumps(ex, ensure_ascii=False)},
            'statements': [{'sql': REGISTER_EXHIBIT, 'count': 'exhibits'},
                           {'sql': EXHIBIT_FACTS, 'count': 'facts'},
                           {'sql': EXHIBIT_LINKS, 'count': 'links'}]}


def plan(request):
    read = c.Reader()
    if request.get('contract') == 'affidavit_exhibits':
        return _exhibits_plan(request, read)
    return _body_plan(request, read)
