"""ingest_authority.py -- the Path D writes for one extracted authority (MODULE + CLI).

Behind `matter_data__ingest_authority` (design-decisions.md #68). It opens no
database and reads no clock. It reads one file, the extractor's result at
`result_path`, checks it, and returns the fixed statements that apply
operations/ingest-extract.md Path D, with the checked result bound to every
statement as the one JSON parameter `:doc`. The data server runs them in
`matter_data__execute`'s own transaction, so every table and column name stays in
this script.

    request   {"matter_root", "result_path", "file_path", "file_hash",
               "bundled_pages" (optional: a bundled book's entry, e.g. "12-34")}
    refused   {"problems": [str, ...]}            nothing is to be written
    accepted  {"params": {"doc": <json text>},
               "statements": [{"sql", "refuse"?, "count"?, "value_as"?, "rows_as"?}],
               "treats_prior": <the result's treats_prior, or null>,
               "held_back": [<link the local store cannot hold>, ...]}

A statement marked `refuse` is a guard: any row it returns is a reason to write
nothing. `count` names the table the statement inserts into and how many rows
it was offered, so the caller can report inserted and skipped. `value_as` and
`rows_as` name the result key that takes the statement's first value or its
rows.

What the statements do, in Path D's order, in one transaction:

  authority   inserted unless a row already holds this file_hash and citation
              (a re-run). The same hash under another citation is refused,
              unless `bundled_pages` marks an entry of a bundled book, whose
              entries share the book's hash. Never `last_verified_at`.
  concepts    inserted where no row holds that (name, jurisdiction). A stored
              concept is reused unchanged.
  stubs       a `determined_by_concept_name` resolves to (a) a concept in this
              result with that exact name, else (b) a stored concept with that
              name in the parent concept's jurisdiction, else (c) a `test`
              concept with no criteria stubbed in that jurisdiction and listed
              under `stubs`.
  links       one per concept; an existing (concept, authority) link is kept.
  criteria    in the extractor's order, numbered on after the concept's highest
              stored criterion_order; one whose description the concept already
              holds is skipped.

Treatments are not written here: `treats_prior` is returned for the caller.
A link whose relationship the local CHECK cannot hold is not written either:
it is returned under `held_back`, with its relationship, for the practitioner.
The provision extractor's result is the same shape with fewer keys, and an
absent key is stored as NULL. Standard library only.

    python ingest_authority.py < request.json

The same module is the converter behind `matter_data__ingest_result` contracts
`caselaw` and `provision` (ingest orchestrator spec 2.1; see ingest_common.py for
the shape). A request with `results` takes that path, in one transaction, with
the checks above and these differences (design decision #79):

  treatments  no `treats_prior` is returned. Each treatment is a
              `[TREATMENT-PENDING:<citation>|<treatment>|<scope>]` marker on the
              authority's notes, because matching it is an attended judgment (#16).
  second copy a route with `second_copy_of` extracts nothing: a fixed statement
              appends `[SECOND-COPY:<hash>]` to that authority, or to the row it
              was merged into.
  no result   the extraction failed twice. Nothing is written, and the call is
              journaled as closed.

`dispatch_context` is what an extractor dispatch of those contracts is served:
the matter's live legal issues with every party's name taken out, and the
treatment vocabulary. No party name and no style of cause (#10).
"""

import json
import os
import re
import sys

_SKILL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_CONVENTIONS = os.path.join(_SKILL, 'shared', 'conventions.md')
_VOCABULARY = os.path.join(os.path.dirname(_SKILL), 'shared', 'treatment-vocabulary.md')

AUTHORITY_TYPES = ('case_law', 'statute', 'regulation', 'treatise', 'other')
# shared/extraction-protocol.md, "Descriptor mapping".
CONCEPT_TYPES = {'cause of action': 'cause_of_action', 'doctrine': 'doctrine',
                 'legal test': 'test', 'defence': 'defence', 'remedy': 'remedy'}
REQUIREMENT_TYPES = {'mandatory element': 'element', 'weighed factor': 'factor'}
# Relationship code values. Their definitions are in
# .claude/skills/shared/treatment-vocabulary.md and nowhere else (design:
# docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md, ADR 0006).
# The extractor may give any principle-link value; the relationship CHECK holds
# only STORABLE_RELATIONSHIPS, so a link with any other value is held back and
# reported, never remapped.
RELATIONSHIPS = ('establishes', 'extends', 'reformulates', 'follows', 'applies', 'approves',
                 'explains', 'harmonizes', 'refers_to', 'considers', 'distinguishes', 'limits',
                 'declines_to_extend', 'declines_to_follow', 'declines_to_apply', 'questions',
                 'disapproves', 'overrules', 'departs_from', 'abrogates', 'superseded_by_statute')
STORABLE_RELATIONSHIPS = ('establishes', 'applies', 'distinguishes')

_AUTHORITY = """(SELECT min(a.authority_id) FROM law.authorities a
        WHERE a.file_hash = json_extract(:doc, '$.authority.file_hash')
          AND a.citation IS json_extract(:doc, '$.authority.citation'))"""


def _concept(row, name='$.name', jurisdiction='$.jurisdiction'):
    return f"""(SELECT min(k.concept_id) FROM law.legal_concepts k
        WHERE k.name = json_extract({row}.value, '{name}')
          AND k.jurisdiction IS json_extract({row}.value, '{jurisdiction}'))"""


GUARD_HASH = """
SELECT 'file_hash is already registered to authority #' || a.authority_id || ' ('
       || coalesce(a.citation, a.title) || '). Apply Path D''s duplicate routing or its '
       || 'second-copy rule. An entry of a bundled book needs bundled_pages.'
FROM law.authorities a
WHERE a.file_hash = json_extract(:doc, '$.authority.file_hash')
  AND a.citation IS NOT json_extract(:doc, '$.authority.citation')
  AND json_extract(:doc, '$.bundled') = 0
"""

GUARD_MERGED = """
SELECT 'authority #' || a.authority_id || ' holds this file_hash and citation and is merged into '
       || 'another row (' || substr(a.notes, 1, instr(a.notes, ']')) || '). Nothing is written to '
       || 'a merged row.'
FROM law.authorities a
WHERE a.file_hash = json_extract(:doc, '$.authority.file_hash')
  AND a.citation IS json_extract(:doc, '$.authority.citation')
  AND a.notes LIKE '[MERGED-INTO:%'
"""

INSERT_AUTHORITY = f"""
INSERT INTO law.authorities (title, citation, authority_type, jurisdiction, file_path, file_hash,
                             notes, disposition, fact_pattern, loss_description)
SELECT json_extract(:doc, '$.authority.title'), json_extract(:doc, '$.authority.citation'),
       json_extract(:doc, '$.authority.authority_type'), json_extract(:doc, '$.authority.jurisdiction'),
       json_extract(:doc, '$.authority.file_path'), json_extract(:doc, '$.authority.file_hash'),
       json_extract(:doc, '$.authority.notes'), json_extract(:doc, '$.authority.disposition'),
       json_extract(:doc, '$.authority.fact_pattern'), json_extract(:doc, '$.authority.loss_description')
WHERE {_AUTHORITY} IS NULL
"""

SELECT_AUTHORITY = f"SELECT {_AUTHORITY} AS authority_id"

INSERT_CONCEPTS = f"""
INSERT INTO law.legal_concepts (name, concept_type, description, jurisdiction, in_force_date, repeal_date)
SELECT json_extract(c.value, '$.name'), json_extract(c.value, '$.concept_type'),
       json_extract(c.value, '$.description'), json_extract(c.value, '$.jurisdiction'),
       json_extract(c.value, '$.in_force_date'), json_extract(c.value, '$.repeal_date')
FROM json_each(:doc, '$.concepts') c
WHERE {_concept('c')} IS NULL
ORDER BY c.key
"""

SELECT_STUBS = f"""
SELECT json_extract(s.value, '$.name') AS name, json_extract(s.value, '$.jurisdiction') AS jurisdiction
FROM json_each(:doc, '$.determined_by') s
WHERE {_concept('s')} IS NULL
ORDER BY s.key
"""

INSERT_STUBS = f"""
INSERT INTO law.legal_concepts (name, concept_type, jurisdiction)
SELECT json_extract(s.value, '$.name'), 'test', json_extract(s.value, '$.jurisdiction')
FROM json_each(:doc, '$.determined_by') s
WHERE {_concept('s')} IS NULL
ORDER BY s.key
"""

INSERT_LINKS = f"""
INSERT INTO law.concept_authorities (concept_id, authority_id, relationship, proposition, finding,
                                     factual_context, obiter, order_terms)
SELECT n.concept_id, n.authority_id, n.relationship, n.proposition, n.finding, n.factual_context,
       n.obiter, n.order_terms
FROM (SELECT {_concept('l')} AS concept_id, {_AUTHORITY} AS authority_id,
             json_extract(l.value, '$.relationship') AS relationship,
             json_extract(l.value, '$.proposition') AS proposition,
             json_extract(l.value, '$.finding') AS finding,
             json_extract(l.value, '$.factual_context') AS factual_context,
             json_extract(l.value, '$.obiter') AS obiter,
             json_extract(l.value, '$.order_terms') AS order_terms,
             l.key AS seq
      FROM json_each(:doc, '$.links') l) n
WHERE NOT EXISTS (SELECT 1 FROM law.concept_authorities x
                  WHERE x.concept_id = n.concept_id AND x.authority_id = n.authority_id)
ORDER BY n.seq
"""

INSERT_CRITERIA = f"""
INSERT INTO law.legal_criteria (concept_id, requirement_type, criterion_order, criterion_description,
                                burden_of_proof, determined_by_concept_id, authority_id,
                                authority_proposition, notes, in_force_date, repeal_date)
SELECT n.concept_id, n.requirement_type,
       (SELECT coalesce(max(x.criterion_order), 0) FROM law.legal_criteria x
        WHERE x.concept_id = n.concept_id)
         + row_number() OVER (PARTITION BY n.concept_id ORDER BY n.seq),
       n.description, n.burden_of_proof, n.determined_by_concept_id, n.authority_id,
       n.authority_proposition, n.notes, n.in_force_date, n.repeal_date
FROM (SELECT {_concept('r')} AS concept_id, {_AUTHORITY} AS authority_id,
             json_extract(r.value, '$.requirement_type') AS requirement_type,
             json_extract(r.value, '$.description') AS description,
             json_extract(r.value, '$.burden_of_proof') AS burden_of_proof,
             CASE WHEN json_extract(r.value, '$.determined_by_name') IS NOT NULL
                  THEN {_concept('r', '$.determined_by_name', '$.determined_by_jurisdiction')}
             END AS determined_by_concept_id,
             json_extract(r.value, '$.authority_proposition') AS authority_proposition,
             json_extract(r.value, '$.notes') AS notes,
             json_extract(r.value, '$.in_force_date') AS in_force_date,
             json_extract(r.value, '$.repeal_date') AS repeal_date,
             r.key AS seq
      FROM json_each(:doc, '$.criteria') r) n
WHERE NOT EXISTS (SELECT 1 FROM law.legal_criteria x
                  WHERE x.concept_id = n.concept_id AND x.criterion_description = n.description)
"""


def _fenced(path, lang, needle):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    for body in re.findall(r'```' + lang + r'\n(.*?)```', text, re.S):
        if needle in body:
            return body
    raise LookupError(f'no ```{lang} block containing {needle!r} in {path}')


def _stored_form(path, root):
    """conventions.md §2.4's own helper, read from that file."""
    namespace = {}
    exec(_fenced(_CONVENTIONS, 'python', 'def stored_form('), namespace)
    return namespace['stored_form'](path, root)


class _Reader:
    """Reads fields of the result, collecting every problem rather than stopping at the first."""

    def __init__(self):
        self.problems = []

    def text(self, obj, key, where, required=False):
        """A trimmed string, or None for null, absent or blank."""
        value = obj.get(key)
        if value is not None and not isinstance(value, str):
            self.problems.append(f'{where}.{key} must be a string or null')
            return None
        value = (value or '').strip() or None
        if required and value is None:
            self.problems.append(f'{where}.{key} is required')
        return value

    def choice(self, obj, key, where, allowed):
        value = obj.get(key)
        if not isinstance(value, str) or value not in allowed:
            self.problems.append(f'{where}.{key} must be one of: ' + ' | '.join(allowed))
            return None
        return allowed[value] if isinstance(allowed, dict) else value


def _load(path):
    """The result at `path`, or the problems that keep it from being one."""
    try:
        with open(path, encoding='utf-8-sig') as fh:
            doc = json.load(fh)
    except (OSError, ValueError) as exc:
        return None, [f'result_path could not be read as JSON: {exc}']
    if not isinstance(doc, dict) or not isinstance(doc.get('authority'), dict) \
            or not isinstance(doc.get('concepts'), list):
        return None, ['the result is not the extractor\'s JSON object: it needs an '
                      '"authority" object and a "concepts" list']
    return doc, []


def _check(doc, file_path, file_hash, bundled_pages, read):
    """The checked result as the statements read it, with what the plans report of it."""
    problems = read.problems
    if not file_path or re.match(r'^[A-Za-z]:', file_path) or file_path.startswith('\\'):
        problems.append('file_path must name the file relative to the matter root '
                        '(shared/conventions.md §2.4)')
    if not re.fullmatch(r'[0-9a-f]{64}', file_hash):
        problems.append('file_hash must be the file\'s SHA-256 as 64 lowercase hex characters')

    source = doc['authority']
    authority = {
        'title': read.text(source, 'title', 'authority', required=True),
        'citation': read.text(source, 'citation', 'authority', required=bool(bundled_pages)),
        'authority_type': read.choice(source, 'authority_type', 'authority', AUTHORITY_TYPES),
        'jurisdiction': read.text(source, 'jurisdiction', 'authority'),
        'file_path': file_path,
        'file_hash': file_hash,
        'notes': f'Bundled authority, pp. {bundled_pages}' if bundled_pages else None,
        'disposition': read.text(doc, 'authority_disposition', 'result'),
        'fact_pattern': read.text(doc, 'fact_pattern', 'result'),
        'loss_description': read.text(doc, 'loss_description', 'result'),
    }

    concepts, links, held_back, by_concept, offered = [], [], [], {}, 0
    for i, entry in enumerate(doc['concepts']):
        where = f'concepts[{i}]'
        if not isinstance(entry, dict):
            problems.append(f'{where} must be an object')
            continue
        key = (read.text(entry, 'name', where, required=True), read.text(entry, 'jurisdiction', where))
        concept_type = read.choice(entry, 'concept_kind', where, CONCEPT_TYPES)
        relationship = read.choice(entry, 'authority_role', where, RELATIONSHIPS)
        if key not in by_concept:
            by_concept[key] = []
            concepts.append({
                'name': key[0], 'jurisdiction': key[1], 'concept_type': concept_type,
                'description': read.text(entry, 'description', where),
                'in_force_date': read.text(entry, 'in_force_date', where),
                'repeal_date': read.text(entry, 'repeal_date', where),
            })
            link = {
                'name': key[0], 'jurisdiction': key[1], 'relationship': relationship,
                'proposition': read.text(entry, 'authority_proposition', where),
                'finding': read.text(entry, 'authority_finding', where),
                'factual_context': read.text(entry, 'factual_context', where),
                'obiter': read.text(entry, 'obiter', where),
                'order_terms': read.text(entry, 'order_terms', where),
            }
            if relationship is None or relationship in STORABLE_RELATIONSHIPS:
                links.append(link)
            else:
                held_back.append(link)
        rows = entry.get('criteria') or []
        if not isinstance(rows, list):
            problems.append(f'{where}.criteria must be a list')
            continue
        for j, row in enumerate(rows):
            at = f'{where}.criteria[{j}]'
            offered += 1
            if not isinstance(row, dict):
                problems.append(f'{at} must be an object')
                continue
            order = row.get('criterion_order')
            if not isinstance(order, int) or isinstance(order, bool):
                problems.append(f'{at}.criterion_order must be an integer')
                order = 0
            by_concept[key].append((order, len(by_concept[key]), at, {
                'name': key[0], 'jurisdiction': key[1],
                'requirement_type': read.choice(row, 'requirement_kind', at, REQUIREMENT_TYPES),
                'description': read.text(row, 'criterion_description', at, required=True),
                'burden_of_proof': read.text(row, 'burden_of_proof', at),
                'determined_by_name': read.text(row, 'determined_by_concept_name', at),
                'determined_by_jurisdiction': None,
                'authority_proposition': read.text(row, 'authority_proposition', at),
                'notes': read.text(row, 'notes', at),
                'in_force_date': read.text(row, 'in_force_date', at),
                'repeal_date': read.text(row, 'repeal_date', at),
            }))

    jurisdictions = {}
    for name, jurisdiction in by_concept:
        jurisdictions.setdefault(name, []).append(jurisdiction)

    criteria, determined_by = [], []
    for (name, parent), rows in by_concept.items():
        seen = set()
        for _, _, at, row in sorted(rows, key=lambda r: r[:2]):
            if row['description'] in seen:
                continue
            seen.add(row['description'])
            target = row['determined_by_name']
            if target is not None:
                held = jurisdictions.get(target)
                if held is None or parent in held:
                    row['determined_by_jurisdiction'] = parent
                    # Not in this result: (b) or (c), looked up then stubbed in the parent's jurisdiction.
                    if held is None and (target, parent) not in determined_by:
                        determined_by.append((target, parent))
                elif len(held) == 1:
                    row['determined_by_jurisdiction'] = held[0]
                else:
                    problems.append(
                        f'{at}.determined_by_concept_name {target!r} cannot be resolved: the result '
                        f'holds concepts of that name in {len(held)} jurisdictions, none of them '
                        f'the parent concept\'s')
            criteria.append(row)

    if problems:
        return None
    payload = {
        'authority': authority, 'bundled': 1 if bundled_pages else 0,
        'concepts': concepts, 'links': links, 'criteria': criteria,
        'determined_by': [{'name': n, 'jurisdiction': j} for n, j in determined_by],
    }
    return {'payload': payload, 'concepts': concepts, 'determined_by': determined_by,
            'held_back': held_back, 'offered': offered}


def plan(request):
    if 'results' in request:
        return _result_plan(request)
    doc, unread = _load(request['result_path'])
    if unread:
        return {'problems': unread}
    read = _Reader()
    file_path = _stored_form(request.get('file_path') or '', request.get('matter_root') or '')
    checked = _check(doc, file_path, request.get('file_hash') or '', (request.get('bundled_pages') or '').strip(), read)
    if checked is None:
        return {'problems': read.problems}
    payload, concepts, determined_by = checked['payload'], checked['concepts'], checked['determined_by']
    held_back, offered = checked['held_back'], checked['offered']
    return {
        'params': {'doc': json.dumps(payload, ensure_ascii=False)},
        'statements': [
            {'sql': GUARD_HASH, 'refuse': True},
            {'sql': GUARD_MERGED, 'refuse': True},
            {'sql': INSERT_AUTHORITY, 'count': {'table': 'authorities', 'of': 1}},
            {'sql': SELECT_AUTHORITY, 'value_as': 'authority_id'},
            {'sql': INSERT_CONCEPTS, 'count': {'table': 'legal_concepts', 'of': len(concepts)}},
            {'sql': SELECT_STUBS, 'rows_as': 'stubs'},
            {'sql': INSERT_STUBS, 'count': {'table': 'legal_concepts', 'of': len(determined_by)}},
            {'sql': INSERT_LINKS, 'count': {'table': 'concept_authorities',
                                            'of': len(doc['concepts']) - len(held_back)}},
            {'sql': INSERT_CRITERIA, 'count': {'table': 'legal_criteria', 'of': offered}},
        ],
        'treats_prior': doc.get('treats_prior'),
        'held_back': held_back,
    }


# The ingest_result path: the guards above, as refusals the data server reads by their code.
_REFUSALS = [
    {'sql': f"SELECT 'refused: this file is already held as another authority' FROM ({GUARD_HASH}) LIMIT 1", 'refuse': True},
    {'sql': f"SELECT 'refused: this file is held by an authority merged into another' FROM ({GUARD_MERGED}) LIMIT 1", 'refuse': True},
]

_CANONICAL = """(SELECT CASE WHEN a.notes LIKE '[MERGED-INTO:#%'
             THEN CAST(substr(a.notes, 15, instr(substr(a.notes, 15), ' ') - 1) AS INTEGER)
             ELSE a.authority_id END
        FROM law.authorities a WHERE a.authority_id = json_extract(:doc, '$.authority_id'))"""

GUARD_NAMED = {'sql': f"""SELECT 'refused: the authority this file was matched to is not on file'
WHERE {_CANONICAL} IS NULL""", 'refuse': True}

SECOND_COPY_HELD = {'sql': f"""SELECT (SELECT authority_id FROM law.authorities
        WHERE authority_id = {_CANONICAL} AND instr(coalesce(notes, ''), json_extract(:doc, '$.marker')) > 0) AS prior""",
                    'value_as': 'prior'}

APPEND_SECOND_COPY = f"""
UPDATE law.authorities
SET notes = CASE WHEN notes IS NULL OR notes = '' THEN json_extract(:doc, '$.marker')
                 ELSE notes || char(10) || json_extract(:doc, '$.marker') END
WHERE authority_id = {_CANONICAL} AND instr(coalesce(notes, ''), json_extract(:doc, '$.marker')) = 0
"""

SELECT_CANONICAL = {'sql': f"SELECT {_CANONICAL} AS source_id", 'value_as': 'source_id'}

REPORT_STUBS = {'sql': f"""SELECT 'A sub-test, ' || s.name || ', was added with no criteria yet.' FROM ({SELECT_STUBS}) s""",
                'report': True}


def _append_treatment(i):
    marker = f"json_extract(:doc, '$.treatments[{i}]')"
    return {'sql': f"""
UPDATE law.authorities
SET notes = CASE WHEN notes IS NULL OR notes = '' THEN {marker} ELSE notes || char(10) || {marker} END
WHERE authority_id = {_AUTHORITY} AND instr(coalesce(notes, ''), {marker}) = 0
"""}


def _treatments(doc, read):
    """conventions.md 11's marker for each treatment the result reports. `|` and `]` end its fields,
    so neither survives inside one."""
    given = doc.get('treats_prior') or []
    markers = []
    for i, entry in enumerate([given] if isinstance(given, dict) else given):
        where = f'treats_prior[{i}]'
        if not isinstance(entry, dict):
            read.problems.append(f'{where} must be an object')
            continue
        fields = [read.text(entry, 'citation', where) or read.text(entry, 'title', where, required=True),
                  read.text(entry, 'treatment', where, required=True), read.text(entry, 'scope', where) or 'full']
        markers.append('[TREATMENT-PENDING:' + '|'.join(re.sub(r'[|\]]', ' ', f or '') for f in fields) + ']')
    return markers


def _result_plan(request):
    route = request.get('route') or {}
    file_path, file_hash = request.get('file_path') or '', request.get('file_hash') or ''
    title = os.path.splitext(os.path.basename(file_path.replace('\\', '/')))[0]
    if isinstance(route.get('second_copy_of'), int):
        doc = {'authority_id': route['second_copy_of'], 'marker': f'[SECOND-COPY:{file_hash}]'}
        return {'params': {'doc': json.dumps(doc)},
                'statements': [GUARD_NAMED, SECOND_COPY_HELD, {'sql': APPEND_SECOND_COPY}, SELECT_CANONICAL],
                'post': [], 'markers': [], 'asks': [], 'report': [], 'title': title,
                'summary': f'{title[:60]} is a second copy of an authority already held, so it was recorded by reference.'}
    if not request.get('results'):
        return {'params': {}, 'statements': [{'sql': 'SELECT NULL AS source_id', 'value_as': 'source_id'}],
                'post': [], 'markers': [], 'asks': [], 'report': [], 'title': title, 'failed': True,
                'summary': f'{title[:60]} could not be read, so nothing was recorded for it.'}
    if len(request['results']) != 1:
        return {'problems': [f"contract {request.get('contract')} takes one result per authority"]}
    doc, unread = _load(request['results'][0]['path'])
    if unread:
        return {'problems': unread}
    if request.get('contract') == 'provision' and doc['authority'].get('authority_type') == 'case_law':
        return {'blocked': 'set_aside'}
    read = _Reader()
    checked = _check(doc, file_path, file_hash, '', read)
    treatments = _treatments(doc, read)
    if checked is None or read.problems:
        return {'problems': read.problems}
    payload = {**checked['payload'], 'treatments': treatments}
    report = [f"The link to {link['name'][:60]} ({link['relationship']}) could not be recorded here, and is reported instead."
              for link in checked['held_back']]
    if treatments:
        report.append('This decision treats an earlier one. That waits for an attended check, which matches it.')
    name = payload['authority']['title'] or title
    return {
        'params': {'doc': json.dumps(payload, ensure_ascii=False)},
        'statements': _REFUSALS + [
            {'sql': f'SELECT {_AUTHORITY} AS prior', 'value_as': 'prior'},
            {'sql': INSERT_AUTHORITY},
            {'sql': INSERT_CONCEPTS}, REPORT_STUBS, {'sql': INSERT_STUBS},
            {'sql': INSERT_LINKS, 'count': 'links'}, {'sql': INSERT_CRITERIA},
        ] + [_append_treatment(i) for i in range(len(treatments))] + [
            {'sql': SELECT_AUTHORITY, 'value_as': 'source_id'},
        ],
        'post': [], 'markers': [], 'asks': [], 'report': report, 'title': name,
        'summary': f"{name[:60]}: recorded as a legal authority, with {len(checked['concepts'])} concepts.",
    }


def _scrubbed(text, names):
    """`text` with each party's name, and each word of four letters or more in it, taken out (#10).
    A word too many costs a phrase of the context; a name left in is the harm the rule prevents."""
    if not text:
        return text
    for name in names:
        for part in sorted({name, *(w for w in re.findall(r'\w+', name) if len(w) >= 4)}, key=len, reverse=True):
            text = re.sub(r'(?<!\w)' + re.escape(part) + r'(?!\w)', 'a party', text, flags=re.I)
    return text


def dispatch_context(request):
    """request = {"case_data_dir": str}. Read-only, from a temp copy of main.sqlite."""
    from list_parties import read_staged
    from parties_of_record import _behind

    def read(con):
        behind = _behind(con)
        if behind:
            return behind
        names = [row[0] for row in con.execute('SELECT name FROM parties')]
        names += [row[0] for row in con.execute('SELECT style_of_cause FROM proceedings') if row[0]]
        issues = [{'title': _scrubbed(title, names), 'description': _scrubbed(description, names)}
                  for title, description in con.execute(
                      "SELECT title, description FROM issues WHERE status = 'open' "
                      "AND issue_type IN ('legal', 'mixed') ORDER BY issue_id")]
        with open(_VOCABULARY, encoding='utf-8') as fh:
            return {'status': 'ok', 'legal_context': issues, 'treatment_vocabulary': fh.read()}
    return read_staged(request.get('case_data_dir'), 'authority dispatch', read)


if __name__ == '__main__':
    print(json.dumps(plan(json.load(sys.stdin)), indent=2))
