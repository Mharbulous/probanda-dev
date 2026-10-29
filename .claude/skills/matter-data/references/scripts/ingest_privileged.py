"""ingest_privileged.py -- Path B's writes for an internal document, from the main thread's staged object (MODULE).

Behind `matter_data__ingest_result` contract `privileged` (ingest orchestrator
spec 1.2 item 6, 2.1; see ingest_common.py for the shape). The main thread reads
the document inline, as Path B always has, and stages this object with
`matter_data__stage_result`; it writes no SQL. `answers.privilege` chooses
ingest-extract.md Path B's branch:

  yes      the privileged source (category from the object), each fact a bare
           `main.facts` row with its Statement of Fact on a privileged
           `fact_provenance.source_note` (operations/bare-privileged-facts.md
           1-2), and each client instruction. Nothing else reaches main.
  no       a `main.sources` row, work_product, listed 0, privilege_status
           'cleared', and the facts as ordinary rows.
  unclear  the same row with privilege_status 'pending', and facts only.

The staged object:

    {"contract": "privileged", "contract_version": 2, "ref",
     "document": {"title", "description", "category", "author", "recipient", "date"},
     "facts": [{"source_locator", "description", "category", "date_of_fact", "notes"}],
     "client_instructions": [{"party_name", "instructed_by", "date", "description",
                              "source_locator", "status", "proceeding_file_number",
                              "supersedes_instruction_id"?}]}

An instruction that changes a current one names it in `supersedes_instruction_id`:
that row is closed (`valid_to`, status `superseded`) and the new row carries it
as `prior_id`, never an update of its text (ingest-extract.md Path B).

A bare row's provenance is matched on (privileged source, locator, Statement), so
a repeated call writes nothing twice. A re-extraction never moves a document
between stores or changes its privilege status: either is refused store_change.
"""

import json

import ingest_common as c

PRIVILEGED_CATEGORIES = ('solicitor_client', 'privileged_correspondence', 'privileged_work_product', 'other')
INSTRUCTION_STATUSES = ('open', 'actioned', 'superseded')

PRIV = """(SELECT min(p.source_id) FROM privileged.privileged_sources p
        WHERE p.file_hash = json_extract(:doc, '$.source.file_hash'))"""

GUARD_MAIN = {'sql': f"""
SELECT 'store_change: this file is held in the case record, not the privileged store'
FROM main.sources s WHERE s.source_id = {c.SOURCE}
""", 'refuse': True}

PRIOR_PRIV = {'sql': f"""
SELECT CASE WHEN EXISTS (SELECT 1 FROM privileged.fact_provenance f WHERE f.source_id = {PRIV})
             OR EXISTS (SELECT 1 FROM privileged.client_instructions i WHERE i.source_id = {PRIV})
            THEN 'complete' END AS prior""", 'value_as': 'prior'}

REGISTER_PRIV = f"""
INSERT INTO privileged.privileged_sources (category, title, description, author, recipient, date, file_path,
                                           file_hash, verified, proceeding_id)
SELECT json_extract(:doc, '$.source.category'), json_extract(:doc, '$.source.title'),
       json_extract(:doc, '$.source.description'), json_extract(:doc, '$.source.author'),
       json_extract(:doc, '$.source.recipient'), json_extract(:doc, '$.source.date'),
       json_extract(:doc, '$.source.file_path'), json_extract(:doc, '$.source.file_hash'), 0,
       json_extract(:doc, '$.source.proceeding_id')
WHERE {PRIV} IS NULL
"""

SELECT_PRIV = {'sql': f'SELECT {PRIV} AS source_id', 'value_as': 'source_id'}

BARE = f"""
INSERT INTO main.facts (description, created_date, verified, human_reviewed, pending_reverification)
SELECT '', NULL, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM privileged.fact_provenance p
                  WHERE p.source_id = {PRIV} AND p.source_locator IS json_extract(:fact, '$.locator')
                    AND p.source_note = json_extract(:fact, '$.note'))
"""

PROVENANCE = f"""
INSERT INTO privileged.fact_provenance (fact_id, source_id, source_locator, source_note, verified)
SELECT last_insert_rowid(), {PRIV}, json_extract(:fact, '$.locator'), json_extract(:fact, '$.note'),
       json_extract(:fact, '$.verified')
WHERE changes() = 1
"""

CLOSE_PRIOR = f"""
UPDATE privileged.client_instructions SET valid_to = {c.TODAY}, status = 'superseded'
WHERE valid_to IS NULL
  AND instruction_id IN (SELECT json_extract(i.value, '$.supersedes') FROM json_each(:doc, '$.instructions') i)
"""

INSTRUCTIONS = f"""
INSERT INTO privileged.client_instructions (proceeding_id, party_id, instructed_by, date, description,
                                            source_id, source_locator, status, valid_from, prior_id, verified)
SELECT (SELECT p.proceeding_id FROM main.proceedings p
        WHERE p.file_number = json_extract(i.value, '$.file_number')),
       json_extract(i.value, '$.party_id'), json_extract(i.value, '$.instructed_by'),
       json_extract(i.value, '$.date'), json_extract(i.value, '$.description'), {PRIV},
       json_extract(i.value, '$.locator'), json_extract(i.value, '$.status'), {c.TODAY},
       json_extract(i.value, '$.supersedes'), 0
FROM json_each(:doc, '$.instructions') i
WHERE NOT EXISTS (SELECT 1 FROM privileged.client_instructions x WHERE x.source_id = {PRIV}
                    AND x.source_locator IS json_extract(i.value, '$.locator')
                    AND x.description = json_extract(i.value, '$.description'))
ORDER BY i.key
"""


def _note(fact):
    """bare-privileged-facts.md 2's labelled lines; a line break inside a value becomes a space."""
    one = lambda v: ' '.join(str(v).split())
    lines = [f"STATEMENT: {one(fact['description'])}"]
    for label, key in (('CATEGORY', 'category'), ('DATE OF FACT', 'date_of_fact'), ('NOTES', 'notes'),
                       ('LOCATOR', 'locator')):
        if fact.get(key):
            lines.append(f'{label}: {one(fact[key])}')
    return '\n'.join(lines)


def plan(request):
    if len(request.get('results') or []) != 1:
        return {'problems': ['contract privileged takes one result']}
    answer = ((request.get('answers') or {}).get('privilege') or '').lower()
    if answer not in ('yes', 'no', 'unclear'):
        return {'problems': ['answers.privilege must be yes, no or unclear']}
    doc = c.load(request['results'][0])
    read = c.Reader()
    document = doc.get('document') if isinstance(doc.get('document'), dict) else {}
    facts = [c.read_fact(read, row, f'facts[{i}]') for i, row in enumerate(read.items(doc, 'facts', 'result'))]
    title = read.text(document, 'title', 'document') or c.title_from_path(request['file_path'])
    participants = request.get('participants') or {}
    asks = []

    if answer != 'yes':
        status = 'cleared' if answer == 'no' else 'pending'
        source = {'category': 'work_product', 'title': title,
                  'description': read.text(document, 'description', 'document'),
                  'date': read.text(document, 'date', 'document'),
                  'file_path': c.stored_path(request['file_path']), 'file_hash': request['file_hash'],
                  'file_number': None, 'proceeding_id': (request.get('answers') or {}).get('proceeding_id'),
                  'execution_status': None, 'filed_by_party_id': None, 'verified': 0, 'notes': None,
                  'status': 'partial', 'privilege_status': status}
        if read.problems:
            return {'problems': read.problems}
        payload = {'source': source, 'facts': facts}
        statements = [c.guard_privileged_store(), c.GUARD_PRIVILEGE_CHANGE, c.PRIOR_STATUS,
                      {'sql': c.REGISTER}, {'sql': c.REFRESH}, c.insert_facts()]
        if answer == 'no':
            statements.append(c.insert_links())
        statements += [c.flip(), c.SELECT_SOURCE]
        return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements,
                'post': [], 'markers': [], 'asks': [], 'report': [], 'title': title, 'date': source['date']}

    category = read.text(document, 'category', 'document')
    if category not in PRIVILEGED_CATEGORIES:
        read.problems.append('document.category must be one of: ' + ' | '.join(PRIVILEGED_CATEGORIES))
    instructions = []
    for i, row in enumerate(read.items(doc, 'client_instructions', 'result') if 'client_instructions' in doc else []):
        where = f'client_instructions[{i}]'
        name = read.text(row, 'party_name', where, required=True)
        if name and name not in participants:
            asks.append({'kind': 'participant', 'ref': name, 'say': f'Which party is "{name[:80]}" in this matter?'})
        status = row.get('status') or 'open'
        if status not in INSTRUCTION_STATUSES:
            read.problems.append(f'{where}.status must be open, actioned or superseded')
        supersedes = row.get('supersedes_instruction_id')
        if supersedes is not None and (not isinstance(supersedes, int) or isinstance(supersedes, bool)):
            read.problems.append(f'{where}.supersedes_instruction_id must be an instruction id')
        instructions.append({
            'party_id': participants.get(name), 'instructed_by': read.text(row, 'instructed_by', where, required=True),
            'date': read.text(row, 'date', where, required=True),
            'description': read.text(row, 'description', where, required=True),
            'locator': read.text(row, 'source_locator', where), 'status': status,
            'file_number': read.text(row, 'proceeding_file_number', where), 'supersedes': supersedes,
        })
    if read.problems:
        return {'problems': read.problems}
    if asks:
        return {'asks': asks}
    source = {'category': category, 'title': title,
              'description': read.text(document, 'description', 'document'),
              'author': read.text(document, 'author', 'document'),
              'recipient': read.text(document, 'recipient', 'document'),
              'date': read.text(document, 'date', 'document'),
              'file_path': c.stored_path(request['file_path']), 'file_hash': request['file_hash'],
              'proceeding_id': (request.get('answers') or {}).get('proceeding_id')}
    payload = {'source': source, 'instructions': instructions}
    statements = [GUARD_MAIN, PRIOR_PRIV, {'sql': REGISTER_PRIV}]
    for i, fact in enumerate(facts):
        bound = {'locator': fact['locator'], 'note': _note(fact), 'verified': fact['verified']}
        statements.append({'ref': f'fact {i}', 'params': {'fact': json.dumps(bound, ensure_ascii=False)},
                           'statements': [{'sql': BARE, 'count': 'facts'}, {'sql': PROVENANCE}]})
    statements += [{'sql': CLOSE_PRIOR}, {'sql': INSTRUCTIONS}, SELECT_PRIV]
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)}, 'statements': statements,
            'post': [], 'markers': [], 'asks': [], 'report': [], 'title': title, 'date': source['date'],
            'store': 'privileged'}
