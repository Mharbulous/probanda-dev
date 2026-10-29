"""ingest_common.py -- what the ingest_result converters share (MODULE only).

Behind `matter_data__ingest_result` (ingest orchestrator spec 2.1, 2.2). The
converters (`ingest_facts.py`, `ingest_affidavit.py`, `ingest_sought_orders.py`,
`ingest_privileged.py`) open no database and read no clock. Each reads the
staged extractor results it is handed, checks them against their contract, and
returns fixed statements with the checked result bound as JSON parameters, read
through `json_each`. Every table and column name stays in these scripts (#56,
#66, #68). The data server runs the statements in `matter_data__execute`'s own
transaction, with statement groups for the exhibits of an affidavit.

A converter returns

    refused   {"problems": [str, ...]}           nothing is to be written
    accepted  {"params": {...}, "statements": [...], "post": [...], "asks": [...],
               "report": [...], "title": str}

A statement is {"sql", "refuse"?, "count"?, "value_as"?}: `count` names the
output count its rowcount adds to (facts, positions, relief, links, exhibits),
and `value_as` the result key that takes its first value. A group is
{"ref", "params"?, "statements"}. Standard library only.
"""

import json
import os
import re

CONTRACT_VERSION = 2
SOURCE_CATEGORIES = ('court', 'correspondence', 'production', 'work_product', 'disbursements')
# conventions.md 5: a prefixed note sends its row to the human queue at insert.
PREFIXES = ('DISCREPANCY:', 'UNCONFIRMED:', 'OCR:', 'REVERIFICATION:')
TODAY = "date('now','localtime')"
# conventions.md 11, exact text.
MARKERS = {
    'linkage': 'LINKAGE-PENDING: proceeding linkage check not yet run',
    'order_effects': 'ORDER-EFFECTS-PENDING: order-effects pass not yet run',
    'date_setting': 'DATE-ANCHOR-PENDING: date not yet recorded as an anchor',
}
# order-effects.md Step 1: the filename codes and the words of an extracted title.
ORDER_CODES = {'ORDR', 'CO', 'CDO', 'DJ', 'COJ', 'OMAA', 'NACL', 'NOWOL', 'NOAIP'}
ORDER_WORDS = re.compile(r'\b(?:ORDER|JUDGMENT|LAWYER|IN PERSON)\b|THIS COURT ORDERS', re.I)


class Reader:
    """Reads fields of a result, collecting every problem rather than stopping at the first."""

    def __init__(self):
        self.problems = []

    def text(self, obj, key, where, required=False):
        value = obj.get(key) if isinstance(obj, dict) else None
        if value is not None and not isinstance(value, str):
            self.problems.append(f'{where}.{key} must be a string or null')
            return None
        value = (value or '').strip() or None
        if required and value is None:
            self.problems.append(f'{where}.{key} is required')
        return value

    def items(self, obj, key, where):
        value = obj.get(key) if isinstance(obj, dict) else None
        if not isinstance(value, list):
            self.problems.append(f'{where}.{key} must be a list')
            return []
        return value


def load(entry):
    """One staged result, checked for the contract envelope (spec 6.2)."""
    with open(entry['path'], encoding='utf-8-sig') as fh:
        doc = json.load(fh)
    if not isinstance(doc, dict):
        raise ValueError('a staged result is not a JSON object')
    return doc


def verified_for(notes):
    return 2 if notes and notes.startswith(PREFIXES) else 0


def flags_of(doc, kind):
    return [f for f in doc.get('flags') or [] if isinstance(f, dict) and f.get('kind') == kind]


def stored_path(path):
    """conventions.md 2.4's form, for a path the data server already made relative."""
    p = (path or '').replace('/', '\\')
    while p.startswith('.\\'):
        p = p[2:]
    return p


def title_from_path(path):
    return os.path.splitext(os.path.basename(stored_path(path)))[0]


def top_level(hash_key='$.source.file_hash'):
    return f"""(SELECT min(s.source_id) FROM main.sources s
        WHERE s.file_hash = json_extract(:doc, '{hash_key}') AND s.parent_source_id IS NULL)"""


SOURCE = top_level()


def guard_privileged_store():
    return {'sql': """
SELECT 'store_change: this file is held in the privileged store'
FROM privileged.privileged_sources p WHERE p.file_hash = json_extract(:doc, '$.source.file_hash')
""", 'refuse': True}


PRIOR_STATUS = {'sql': f"SELECT (SELECT ingestion_status FROM main.sources WHERE source_id = {SOURCE}) AS prior",
                'value_as': 'prior'}
SELECT_SOURCE = {'sql': f"SELECT {SOURCE} AS source_id", 'value_as': 'source_id'}

# Register with an honest status, then flip (extraction-protocol.md); the re-extraction rule reuses
# the hash's top-level row and refreshes what extraction derives, never privilege_status or listed.
REGISTER = f"""
INSERT INTO main.sources (category, title, description, filed_by_party_id, date, file_path, file_hash,
                          listed, verified, notes, ingestion_status, execution_status, proceeding_id,
                          privilege_status)
SELECT json_extract(:doc, '$.source.category'), json_extract(:doc, '$.source.title'),
       json_extract(:doc, '$.source.description'), json_extract(:doc, '$.source.filed_by_party_id'),
       json_extract(:doc, '$.source.date'), json_extract(:doc, '$.source.file_path'),
       json_extract(:doc, '$.source.file_hash'), 0, json_extract(:doc, '$.source.verified'),
       json_extract(:doc, '$.source.notes'), json_extract(:doc, '$.source.status'),
       json_extract(:doc, '$.source.execution_status'),
       coalesce(json_extract(:doc, '$.source.proceeding_id'),
                (SELECT CASE WHEN count(*) = 1 THEN min(p.proceeding_id) END FROM main.proceedings p
                 WHERE p.file_number = json_extract(:doc, '$.source.file_number'))),
       json_extract(:doc, '$.source.privilege_status')
WHERE {SOURCE} IS NULL
"""

REFRESH = f"""
UPDATE main.sources
SET category = json_extract(:doc, '$.source.category'), title = json_extract(:doc, '$.source.title'),
    description = json_extract(:doc, '$.source.description'),
    date = coalesce(json_extract(:doc, '$.source.date'), date),
    filed_by_party_id = coalesce(json_extract(:doc, '$.source.filed_by_party_id'), filed_by_party_id),
    execution_status = coalesce(json_extract(:doc, '$.source.execution_status'), execution_status),
    ingestion_status = json_extract(:doc, '$.source.status')
WHERE source_id = {SOURCE} AND ingestion_status IS NOT 'complete'
"""

GUARD_PRIVILEGE_CHANGE = {'sql': f"""
SELECT 'store_change: the held row''s privilege status differs'
FROM main.sources s WHERE s.source_id = {SOURCE}
  AND s.privilege_status IS NOT json_extract(:doc, '$.source.privilege_status')
""", 'refuse': True}


def flip(status='complete', source=SOURCE):
    return {'sql': f"""
UPDATE main.sources SET ingestion_status = '{status}', last_ingested_at = {TODAY}
WHERE source_id = {source} AND ingestion_status = 'partial'
"""}


def insert_facts(source=SOURCE, path='$.facts', with_knowledge=False):
    """Facts are idempotent by (source_id, source_locator, description) (ingest-extract.md L19)."""
    extra_cols = ', basis_of_knowledge, informant' if with_knowledge else ''
    extra_vals = (", json_extract(f.value, '$.basis_of_knowledge'), json_extract(f.value, '$.informant')"
                  if with_knowledge else '')
    return {'sql': f"""
INSERT INTO main.facts (description, category, date_of_fact, source_id, source_locator, verified,
                        created_date, notes, pending_reverification{extra_cols})
SELECT json_extract(f.value, '$.description'), json_extract(f.value, '$.category'),
       json_extract(f.value, '$.date_of_fact'), {source}, json_extract(f.value, '$.locator'),
       json_extract(f.value, '$.verified'), {TODAY}, json_extract(f.value, '$.notes'), 0{extra_vals}
FROM json_each(:doc, '{path}') f
WHERE NOT EXISTS (SELECT 1 FROM main.facts x
                  WHERE x.source_id = {source}
                    AND x.source_locator IS json_extract(f.value, '$.locator')
                    AND x.description = json_extract(f.value, '$.description'))
ORDER BY f.key
""", 'count': 'facts'}


def fact_of(row, source=SOURCE, locator='$.fact_locator', description='$.fact_description'):
    """The fact a row names: an answered fact's id, or this source's fact by its locator and wording."""
    return f"""coalesce(json_extract({row}.value, '$.fact_id'),
        (SELECT min(x.fact_id) FROM main.facts x WHERE x.source_id = {source}
           AND x.source_locator IS json_extract({row}.value, '{locator}')
           AND x.description = json_extract({row}.value, '{description}')))"""


def insert_links(source=SOURCE, path='$.facts'):
    """An evidence link where the document itself proves the fact; a current link is kept."""
    return {'sql': f"""
INSERT INTO main.evidence_links (source_id, fact_id, source_locator, strength, valid_from, verified, notes)
SELECT {source}, n.fact_id, n.locator, n.strength, {TODAY}, n.verified, n.notes
FROM (SELECT {fact_of('f', source, '$.locator', '$.description')} AS fact_id,
             json_extract(f.value, '$.locator') AS locator,
             json_extract(f.value, '$.evidence.strength') AS strength,
             json_extract(f.value, '$.evidence.verified') AS verified,
             json_extract(f.value, '$.evidence.notes') AS notes, f.key AS seq
      FROM json_each(:doc, '{path}') f
      WHERE json_type(f.value, '$.evidence') = 'object') n
WHERE NOT EXISTS (SELECT 1 FROM main.evidence_links x
                  WHERE x.source_id = {source} AND x.fact_id = n.fact_id AND x.valid_to IS NULL)
ORDER BY n.seq
""", 'count': 'links'}


def append_marker(marker, source=SOURCE):
    """conventions.md 11's append statement; `marker` is an SQL expression."""
    return {'sql': f"""
UPDATE main.sources
SET notes = CASE WHEN notes IS NULL OR notes = '' THEN {marker} ELSE notes || char(10) || {marker} END
WHERE source_id = {source} AND {marker} IS NOT NULL AND (notes IS NULL OR instr(notes, {marker}) = 0)
"""}


def other_copy(source=SOURCE):
    """The registered top-level court source the extractor's other_copy flag names by title,
    matched without regard to case or surrounding space."""
    return f"""(SELECT min(s.source_id) FROM main.sources s
        WHERE s.parent_source_id IS NULL AND s.category = 'court' AND s.source_id IS NOT {source}
          AND lower(trim(s.title)) = lower(trim(json_extract(:doc, '$.other_copy_title'))))"""


def marker_statements(markers, source=SOURCE):
    """The unattended markers, in ingest-unattended.md's order (Substitutions 1f, 1g, 1h, 1j)."""
    out = []
    for m in markers:
        if m == 'other_copy':
            expr = f"'SUPERSEDE-PENDING: possible other version of source #' || {other_copy(source)} || '.'"
        else:
            expr = "'" + MARKERS[m].replace("'", "''") + "'"
        out.append(append_marker(expr, source))
    return out


def read_fact(read, row, where, with_knowledge=False):
    fact = {
        'locator': read.text(row, 'source_locator', where),
        'description': read.text(row, 'description', where, required=True),
        'category': read.text(row, 'category', where),
        'date_of_fact': read.text(row, 'date_of_fact', where),
        'notes': read.text(row, 'notes', where),
    }
    if fact['description'] and fact['description'].startswith(PREFIXES):
        read.problems.append(f'{where}.description carries a review prefix; it belongs in notes')
    fact['verified'] = row.get('verified') if row.get('verified') == 2 else verified_for(fact['notes'])
    evidence = row.get('evidence')
    if isinstance(evidence, dict) and evidence.get('is_proof_source'):
        strength = evidence.get('strength')
        if not isinstance(strength, int) or isinstance(strength, bool) or not -2 <= strength <= 2:
            read.problems.append(f'{where}.evidence.strength must be an integer in -2..2')
        notes = read.text(evidence, 'notes', where + '.evidence')
        fact['evidence'] = {'strength': strength, 'notes': notes, 'verified': verified_for(notes)}
    elif evidence not in (None, False) and not isinstance(evidence, dict):
        read.problems.append(f'{where}.evidence must be an object or null')
    if with_knowledge:
        basis = row.get('basis_of_knowledge')
        if basis not in ('personal', 'information_and_belief'):
            read.problems.append(f'{where}.basis_of_knowledge must be personal or information_and_belief')
        fact['basis_of_knowledge'] = basis
        fact['informant'] = read.text(row, 'informant', where, required=basis == 'information_and_belief')
    return fact


def leading_code(file_path):
    """The file name's CODE token: the first token after a leading date, else the first token."""
    tokens = [t for t in re.split(r'[\s_]+', title_from_path(file_path).upper()) if t]
    if tokens and re.fullmatch(r'\d{4}-\d{2}-\d{2}', tokens[0]):
        tokens = tokens[1:]
    return tokens[0] if tokens else ''


def is_order(file_path, title, description, kind=None):
    """order-effects.md Step 1, its filename and extractor-signal arms. Over-inclusive by design,
    but a Notice of Application asks for orders and makes none."""
    if kind == 'notice_of_application':
        return False
    return leading_code(file_path) in ORDER_CODES or bool(ORDER_WORDS.search(f'{title or ""} {description or ""}'))


def _norm(text):
    return ' '.join(re.sub(r'[^\w&]+', ' ', (text or '').lower()).split())


def firm_wrote(request, flags):
    """ingest-extract.md's delivery-check test: the letter's own face shows the practitioner's firm
    writing out (the outgoing_letter flag names the firm as written, matched to the firm's name),
    and it is not an email."""
    if os.path.splitext(stored_path(request.get('file_path')))[1].lower() in ('.eml', '.msg'):
        return False
    firm = _norm(request.get('firm_name'))

    def names(detail):
        # Whole words only: "Quill Law" is not "Quill Lawson LLP" (N17).
        detail = _norm(detail)
        return bool(detail) and (f' {firm} ' in f' {detail} ' or f' {detail} ' in f' {firm} ')
    return bool(firm) and any(names(f.get('detail')) for f in flags.get('outgoing_letter', []))


def post_passes(request, category, file_path, title, description, flags):
    """Spec 1.6: the after-completion passes whose detection rule fires for a top-level main row,
    in their fixed order, and the unattended markers that stand in for them."""
    unattended = request.get('mode') == 'unattended'
    court_file = re.match(r'^5\.', stored_path(file_path).split('\\', 1)[0] or '') is not None
    passes, markers, report = [], [], []
    if category == 'court' or court_file:
        (markers if unattended else passes).append('linkage')
    kind = (request.get('route') or {}).get('kind')
    if category == 'court' and is_order(file_path, title, description, kind):
        (markers if unattended else passes).append('order_effects')
    if category in ('court', 'correspondence'):
        for flag in flags.get('date_setting', []):
            if unattended:
                markers.append('date_setting')
                continue
            # ingest-extract.md "Date-setting correspondence", its fixed line; {source} is the
            # written row's id, filled in by the data server.
            detail = (flag.get('detail') or 'a date').strip()[:120]
            where = f", p. {flag['page']}" if isinstance(flag.get('page'), int) else ''
            report.append(f'This document sets a date: {detail}{where}. Record it as an anchor through the docket '
                          f'clerk, citing source {{source}} ({(title or "")[:60]}). Nothing was recorded here.')
        passes.append('procedural_history')
    if category == 'court' and flags.get('other_copy'):
        (markers if unattended else passes).append('other_copy')
    if category == 'correspondence' and not unattended and firm_wrote(request, flags):
        passes.append('delivery_check')
    elif category == 'correspondence' and not unattended and flags.get('outgoing_letter') and not request.get('firm_name'):
        # With no firm profile the firm's own letters cannot be told apart (N14): said, not skipped silently.
        report.append("Whether this letter was delivered was not checked, because the firm's name is not set up "
                      "in Probanda.")
    passes.append('name_check')
    return passes, list(dict.fromkeys(markers)), report
