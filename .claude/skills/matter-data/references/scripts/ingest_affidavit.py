"""ingest_affidavit.py -- the Path C writes for an affidavit, from extract-affidavit's staged results (MODULE).

Behind `matter_data__ingest_result` contracts `affidavit_body` and
`affidavit_exhibits` (ingest orchestrator spec 2.1-2.3; see ingest_common.py for
the shape).

affidavit_body (Pass 1): one transaction. The body row is registered (or
reused) `partial`, with its execution status and its sworn date; the deponent
is upserted as a fact witness and assigned to the body's proceeding; the body
facts carry their basis of knowledge and informant. An informant the extractor
marked `informant_privileged` is written NULL, never into main
(ingest-extract.md L268), and an ask says so; its answer (`answers.informants`,
locator to privileged source id) records the informant in that source's
`fact_provenance`. An id naming no privileged source is asked again; `0` means
no document on file (a call, a meeting), and nothing more is written for it. A
body-level privilege signal is reported, not asked. A rendered `.docx` body has
no exhibits: it is flipped to `complete` at once.

affidavit_exhibits (Pass 3): one transaction, each exhibit in its own statement
group, so an exhibit that fails is rolled back alone and the rest go on (spec
2.3). The exhibit's letter is the one it was dispatched for (its ref's last
part); an extractor letter that differs fails the exhibit's contract, and a ref
naming no expected letter fails that exhibit alone. An
exhibit is deduplicated by (parent, letter in its title); a row registered
`failed` is reused and refreshed. `needs_human` or an uncertain stamp letter
writes it `verified = 2`; a privilege signal writes it as Path B's Unclear
branch (facts only, `privilege_status = 'pending'`) and asks. Each exhibit's
group is followed by a fallback group that, when the exhibit's own group rolled
back, records it `failed` at `verified = 2` with an `UNCONFIRMED:` note; an
exhibit failing its contract is recorded the same way. Either is returned in
`invalid` or as a failed group and read once more (R4); an exhibit whose
extraction failed twice is registered `failed` at `verified = 2`. The call in
which every expected letter has a row, none `failed` but those that failed
twice, sets the body's final status: `complete`, or `partial` when the run
could not locate some exhibits the body lists (`deferred`).

    request  {..., "exhibits": {"expected": [L], "failed": [L], "deferred": [L], "uncertain": [L]}}
"""

import json
import re

import ingest_common as c

BODY = c.top_level()
LETTER = re.compile(r'^(?:[A-Z]{1,2}|\d{1,3})$')
NOTE_FAILED = 'UNCONFIRMED: the exhibit could not be read into the record.'
NOTE_TWICE = 'UNCONFIRMED: the exhibit could not be read after two attempts.'

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

# A privileged informant, once the practitioner names the privileged source it came from (#17).
INFORMANT_PROVENANCE = f"""
INSERT INTO privileged.fact_provenance (fact_id, source_id, source_locator, source_note, verified)
SELECT n.fact_id, n.privileged_source_id, n.locator, 'INFORMANT: ' || n.name, 0
FROM (SELECT (SELECT min(x.fact_id) FROM main.facts x WHERE x.source_id = {BODY}
                AND x.source_locator IS json_extract(i.value, '$.locator')
                AND x.description = json_extract(i.value, '$.description')) AS fact_id,
             json_extract(i.value, '$.privileged_source_id') AS privileged_source_id,
             json_extract(i.value, '$.locator') AS locator, json_extract(i.value, '$.name') AS name
      FROM json_each(:doc, '$.informants') i) n
WHERE n.fact_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM privileged.privileged_sources s WHERE s.source_id = n.privileged_source_id)
  AND NOT EXISTS (SELECT 1 FROM privileged.fact_provenance p
                  WHERE p.fact_id = n.fact_id AND p.source_id = n.privileged_source_id)
"""

# An answer naming no privileged document on file is asked again, never an error (K-M3).
INFORMANT_UNKNOWN = {'sql': """
SELECT 'privileged_informant' AS kind, json_extract(i.value, '$.key') AS ref,
       'The privileged document named for the information at ' || substr(json_extract(i.value, '$.key'), 1, 40)
       || ' was not found. Which privileged document does it come from?' AS say
FROM json_each(:doc, '$.informants') i
WHERE NOT EXISTS (SELECT 1 FROM privileged.privileged_sources s
                  WHERE s.source_id = json_extract(i.value, '$.privileged_source_id'))
""", 'ask': True}

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

# The re-extraction rule for an exhibit: a row recorded `failed` is reused and takes the new reading.
# Its privilege_status never changes but from NULL to pending (ingest-extract.md L37, N-6).
REFRESH_FAILED_EXHIBIT = f"""
UPDATE main.sources
SET title = json_extract(:ex, '$.title'), description = json_extract(:ex, '$.description'),
    date = json_extract(:ex, '$.date'), verified = json_extract(:ex, '$.verified'),
    notes = json_extract(:ex, '$.notes'), ingestion_status = json_extract(:ex, '$.status'),
    privilege_status = coalesce(privilege_status, json_extract(:ex, '$.privilege_status'))
WHERE source_id = {_EXHIBIT} AND ingestion_status = 'failed'
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
        AND json_extract(:ex, '$.privilege_status') IS NULL
        AND (SELECT privilege_status FROM main.sources WHERE source_id = {_EXHIBIT}) IS NOT 'pending') n
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
                     AND (e.title = 'Exhibit ' || l.value OR e.title LIKE 'Exhibit ' || l.value || ' %')
                     AND (e.ingestion_status IS NOT 'failed'
                          OR l.value IN (SELECT value FROM json_each(:doc, '$.failed')))))
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
    answered = answers.get('informants') or {}
    facts, asks, informants = [], [], []
    for i, row in enumerate(read.items(doc, 'body_facts', 'result')):
        fact = c.read_fact(read, row, f'body_facts[{i}]', with_knowledge=True)
        if fact.get('informant') and row.get('informant_privileged') is True:
            # #17: the privileged identity never lands in main.
            locator = fact['locator'] or str(i)
            answer = answered.get(locator)
            if isinstance(answer, int) and not isinstance(answer, bool):
                # 0: it came from no document on file (a call, a meeting), so the name stays out of
                # the record and nothing more is written for it.
                if answer != 0:
                    informants.append({'key': locator, 'locator': fact['locator'], 'description': fact['description'],
                                       'name': fact['informant'], 'privileged_source_id': answer})
            else:
                asks.append({'kind': 'privileged_informant', 'ref': locator,
                             'say': f'The source of the information at {locator[:40]} may be privileged, so it '
                                    'was left out of the case record. Which privileged document does it come '
                                    'from, if any? It will be recorded there.'})
            fact['informant'] = None
        facts.append(fact)
    if read.problems:
        return {'problems': read.problems}

    source = _source(request, category, 'partial')
    source['date'] = read.text(doc, 'sworn_date', 'result')
    if route.get('page_range'):
        source['notes'] = f"Book segment pp. {route['page_range']}"
    flags = {k: c.flags_of(doc, k) for k in ('date_setting', 'other_copy', 'outgoing_letter')}
    other_title = (flags['other_copy'][0].get('detail') or '').strip() if flags['other_copy'] else None
    passes, markers, report = c.post_passes(request, category, request['file_path'], source['title'],
                                            None, flags)
    for flag in c.flags_of(doc, 'privilege_signal')[:3]:
        # A sworn body is recorded as usual; a passage that may disclose privilege is pointed out (N16).
        where = f" (p. {flag['page']})" if isinstance(flag.get('page'), int) and not isinstance(flag.get('page'), bool) else ''
        report.append(f'{source["title"][:60]}: a passage{where} may disclose privileged material. It was '
                      'recorded as sworn; check whether any of it should be kept out of the case record.')
    payload = {'source': source, 'deponent': name, 'facts': facts, 'informants': informants,
               'other_copy_title': other_title}
    statements = [
        c.guard_privileged_store(), c.GUARD_PRIVILEGE_CHANGE, c.PRIOR_STATUS,
        {'sql': c.REGISTER}, {'sql': c.REFRESH},
        {'sql': UPSERT_DEPONENT}, {'sql': ASSIGN_DEPONENT},
        c.insert_facts(with_knowledge=True), {'sql': INFORMANT_PROVENANCE}, INFORMANT_UNKNOWN,
    ]
    if route.get('rendering'):
        # A Word body embeds no exhibits (ingest-extract.md Path C): complete once Pass 1 commits.
        statements.append(c.flip())
    statements += c.marker_statements(markers) + [c.SELECT_SOURCE]
    if other_title:
        statements.append({'sql': f'SELECT {c.other_copy()} AS other', 'value_as': 'other'})
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements,
            'post': passes, 'markers': markers, 'asks': asks, 'report': report, 'title': source['title'],
            'date': source['date'], 'other_title': other_title}


def _source(request, category, status):
    route = request.get('route') or {}
    answers = request.get('answers') or {}
    return {'category': category, 'title': c.title_from_path(request['file_path']), 'description': None,
            'date': None, 'file_path': c.stored_path(request['file_path']), 'file_hash': request['file_hash'],
            'file_number': None, 'proceeding_id': answers.get('proceeding_id') or route.get('proceeding_id'),
            'execution_status': route.get('execution'), 'filed_by_party_id': None, 'verified': 0,
            'notes': None, 'status': status, 'privilege_status': None}


def _exhibit(read, doc, letter, uncertain):
    """One exhibit's row and facts. `letter` is the dispatched one (K-M8): the extractor's own
    letter, when it gives a different one, fails the contract rather than move the facts."""
    given = read.text(doc, 'exhibit_letter', 'result')
    if given is not None and given != letter:
        read.problems.append(f'result.exhibit_letter {given!r} is not the dispatched letter {letter!r}')
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


def _failed_exhibit(letter, note):
    return {'letter': letter, 'title': f'Exhibit {letter}', 'description': None, 'date': None,
            'verified': 2, 'notes': note, 'status': 'failed', 'privilege_status': None, 'facts': []}


def _exhibits_plan(request, read):
    run = request.get('exhibits') or {}
    expected = run.get('expected') or []
    uncertain = set(run.get('uncertain') or [])
    if request.get('results') and not expected:
        # No exhibit list: writing one would complete the body on the first exhibit (S-M6).
        return {'problems': ['no exhibit list is known for this affidavit']}
    groups, written, asks, invalid, pending = [], [], [], [], []
    for entry in request.get('results') or []:
        letter = (entry.get('ref') or '').rsplit(':', 1)[-1]
        if not LETTER.match(letter) or letter not in expected:
            # That exhibit alone fails, and is read once more; the rest of the call goes on (N11).
            invalid.append(letter)
            continue
        doc = c.load(entry)
        ex_read = c.Reader()
        ex = _exhibit(ex_read, doc, letter, uncertain)
        if ex_read.problems:
            # A result that fails its contract is recorded for review and read once more (spec 2.3, R5).
            ex = _failed_exhibit(letter, NOTE_FAILED)
            invalid.append(letter)
        if ex['privilege_status']:
            pending.append(letter)
            asks.append({'kind': 'privilege', 'ref': letter,
                         'say': f'Exhibit {letter} may be privileged. Is it privileged, not privileged, '
                                'or unclear for now? Its facts are held back until you decide.'})
        groups.append(_group(ex))
        # Recorded for review when the group above rolled back (a constraint, spec 2.3).
        groups.append(_group(_failed_exhibit(letter, NOTE_FAILED), 'fallback ' + letter, register_only=True))
        written.append(letter)
    for letter in run.get('failed') or []:
        if letter not in written:
            groups.append(_group(_failed_exhibit(letter, NOTE_TWICE)))
    payload = {'source': {'file_hash': request['file_hash']}, 'expected': expected,
               'deferred': run.get('deferred') or [], 'failed': run.get('failed') or []}
    statements = [GUARD_BODY, c.PRIOR_STATUS] + groups + [{'sql': FINAL_STATUS}, SELECT_FINAL, c.SELECT_SOURCE]
    report = []
    if run.get('deferred'):
        report.append('Exhibits ' + ', '.join(run['deferred'])[:120] + ' could not be located in the file '
                      'and were not read.')
    twice = [letter for letter in run.get('failed') or [] if letter not in written]
    if run.get('closing') and twice:
        # Said once, on the call that settles the affidavit (N12).
        report.append('Exhibits ' + ', '.join(twice)[:120] + ' could not be read after two attempts and are '
                      'marked for review.')
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements,
            'post': [], 'markers': [], 'asks': asks, 'report': report, 'title': None, 'date': None,
            'invalid': invalid, 'pending': pending}


def _group(ex, ref=None, register_only=False):
    statements = [{'sql': REGISTER_EXHIBIT, 'count': None if register_only else 'exhibits'}]
    if not register_only:
        statements += [{'sql': REFRESH_FAILED_EXHIBIT},
                       {'sql': EXHIBIT_FACTS, 'count': 'facts'},
                       {'sql': EXHIBIT_LINKS, 'count': 'links'}]
    return {'ref': ref or ex['letter'], 'params': {'ex': json.dumps(ex, ensure_ascii=False)},
            'statements': statements}


def plan(request):
    read = c.Reader()
    if request.get('contract') == 'affidavit_exhibits':
        return _exhibits_plan(request, read)
    return _body_plan(request, read)
