"""ingest_sought_orders.py -- a Notice of Application's Part 1, from extract-sought-orders' staged result (MODULE).

Behind `matter_data__ingest_result` contract `sought_orders` (ingest orchestrator
spec 2.1; see ingest_common.py for the shape). Applies ingest-extract.md Path A
steps 3 and 4 for the capture (decision #44): the array must be present, every
order_number and order_text non-empty, the numbers unique. A
`not_a_notice_of_application` result writes no row. Each row is inserted once,
keyed on (source_id, order_number). `numbering_absent` writes each row
`UNCONFIRMED:` at verified = 2; an `ocr_uncertain` entry writes `OCR:` at
verified = 2. The document's own `facts` write registers its source first; until
it has, the call is refused `waiting`.
"""

import json

import ingest_common as c

GUARD_SOURCE = {'sql': f"SELECT 'waiting: the document is not registered yet' WHERE {c.SOURCE} IS NULL",
                'refuse': True}

INSERT = f"""
INSERT OR IGNORE INTO main.sought_orders (source_id, order_number, order_text, verified, notes)
SELECT {c.SOURCE}, json_extract(o.value, '$.number'), json_extract(o.value, '$.text'),
       json_extract(o.value, '$.verified'), json_extract(o.value, '$.notes')
FROM json_each(:doc, '$.orders') o
ORDER BY o.key
"""


def plan(request):
    if len(request.get('results') or []) != 1:
        return {'problems': ['contract sought_orders takes one result']}
    doc = c.load(request['results'][0])
    read = c.Reader()
    rows = read.items(doc, 'sought_orders', 'result')
    if read.problems:
        return {'problems': read.problems}
    orders, seen = [], set()
    if not doc.get('not_a_notice_of_application'):
        for i, row in enumerate(rows):
            where = f'sought_orders[{i}]'
            number = read.text(row, 'order_number', where, required=True)
            text = read.text(row, 'order_text', where, required=True)
            if number in seen:
                read.problems.append(f'{where}.order_number {number!r} repeats')
            seen.add(number)
            notes = None
            if doc.get('numbering_absent'):
                notes = 'UNCONFIRMED: Part 1 unnumbered; ordinal assigned positionally'
            elif row.get('ocr_uncertain'):
                notes = 'OCR: the wording of this order was not read with certainty.'
            orders.append({'number': number, 'text': text, 'notes': notes, 'verified': c.verified_for(notes)})
    if read.problems:
        return {'problems': read.problems}
    payload = {'source': {'file_hash': request['file_hash']}, 'orders': orders}
    return {'params': {'doc': json.dumps(payload, ensure_ascii=False)},
            'statements': [GUARD_SOURCE, {'sql': INSERT, 'count': 'relief'}, c.SELECT_SOURCE],
            'post': [], 'markers': [], 'asks': [], 'report': [], 'title': None, 'date': None}
