"""housekeeping_log.py -- operations/housekeeping-log.md modes `record` and `retry` (MODULE).

Behind `matter_data__housekeeping_log` (design-decisions.md #75). It opens no
database. It checks the caller's entries and returns the operation's own
fenced statements, one per entry, read from the skill tree beside it, so the
markdown stays the single source. Each statement's named values are bound, not
spliced: entry i's `:name` becomes `:r<i>_name`, so every statement shares one
set of params and the data server runs them in one matter_data__execute
transaction.

    {"mode": "record", "entries": [{file_name, file_hash, folder_type, outcome,
                                    reason?, failure_class?}, ...]}
    {"mode": "retry", "hashes": [file_hash, ...]}

    refused   {"problems": [str, ...]}            nothing is to be written
    accepted  {"statements": [{"sql"}], "params": {...}}

`outcome` is `renamed`, `manual_review` or `not_ingested` (a settled verdict,
whose `folder_type` is required) or `ingest_failed` (an ingest failure, whose
`reason` and `failure_class` are required and whose `folder_type` may be null
for a root file). Standard library only.
"""

import os
import re

_SKILL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_LOG = os.path.join(_SKILL, 'operations', 'housekeeping-log.md')

SETTLED = ('renamed', 'manual_review', 'not_ingested')
FAILURE_CLASSES = ('deterministic', 'extractor')


def _fenced(path, lang, needle):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    for body in re.findall(r'```' + lang + r'\n(.*?)```', text, re.S):
        if needle in body:
            return body
    raise LookupError(f'no ```{lang} block containing {needle!r} in {path}')


def _text(value):
    return isinstance(value, str) and value.strip() != ''


def _hash(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def _entry_problems(i, e):
    at = f'entries[{i}]'
    if not isinstance(e, dict):
        return [f'{at} must be an object']
    problems = []
    if not _text(e.get('file_name')):
        problems.append(f'{at}.file_name must be the file\'s basename')
    if not _hash(e.get('file_hash')):
        problems.append(f'{at}.file_hash must be the lowercase hex SHA-256 of the file')
    outcome = e.get('outcome')
    if outcome in SETTLED:
        if not _text(e.get('folder_type')):
            problems.append(f'{at}.folder_type must name the folder type the file now sits in')
    elif outcome == 'ingest_failed':
        if e.get('folder_type') is not None and not _text(e.get('folder_type')):
            problems.append(f'{at}.folder_type must be a folder type, or null for a root file')
        if not _text(e.get('reason')):
            problems.append(f'{at}.reason must be one sentence saying what failed')
        if e.get('failure_class') not in FAILURE_CLASSES:
            problems.append(f"{at}.failure_class must be one of {', '.join(FAILURE_CLASSES)}")
    else:
        problems.append(f"{at}.outcome must be one of {', '.join(SETTLED + ('ingest_failed',))}")
    return problems


def _bind(i, sql, values, params):
    """Entry i's copy of `sql`, every `:name` renamed `:r<i>_name`, its values added to params."""
    for name in set(re.findall(r':(\w+)', sql)):
        params[f'r{i}_{name}'] = values.get(name)
    return {'sql': re.sub(r':(\w+)', lambda m: f':r{i}_{m.group(1)}', sql)}


def plan(request):
    mode = request.get('mode')
    statements, params = [], {}
    if mode == 'record':
        entries = request.get('entries')
        if not isinstance(entries, list) or not entries:
            return {'problems': ['record needs a non-empty entries list']}
        problems = [p for i, e in enumerate(entries) for p in _entry_problems(i, e)]
        if problems:
            return {'problems': problems}
        verdict = _fenced(_LOG, 'sql', '-- housekeeping-log record: settled verdict')
        failure = _fenced(_LOG, 'sql', '-- housekeeping-log record: ingest failure')
        for i, e in enumerate(entries):
            sql = failure if e['outcome'] == 'ingest_failed' else verdict
            statements.append(_bind(i, sql, e, params))
    elif mode == 'retry':
        hashes = request.get('hashes')
        if not isinstance(hashes, list) or not hashes:
            return {'problems': ['retry needs a non-empty hashes list']}
        problems = [f'hashes[{i}] must be the lowercase hex SHA-256 of the file'
                    for i, h in enumerate(hashes) if not _hash(h)]
        if problems:
            return {'problems': problems}
        retry = _fenced(_LOG, 'sql', '-- housekeeping-log retry')
        for i, h in enumerate(hashes):
            statements.append(_bind(i, retry, {'file_hash': h}, params))
    else:
        return {'problems': ['mode must be record or retry']}
    return {'statements': statements, 'params': params}
