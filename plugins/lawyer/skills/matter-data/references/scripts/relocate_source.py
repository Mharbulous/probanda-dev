"""relocate_source.py -- operations/relocate-source.md for matter_data__relocate_source (MODULE).

Behind `matter_data__relocate_source` (design-decisions.md #75). It opens no
database: the data server runs the probe through matter_data__query and the
write through matter_data__execute. It executes the operation's own fenced
probe and `relocate_plan`, with conventions.md §2.4's `stored_form`, read from
the skill tree beside it, so the markdown stays the single source. The server
runs on the host, so the matter folder `relocate_plan` reads is `matter_root`.

    {"op": "probe", "hash"}                      -> {"sql", "params"}
    {"op": "plan", "rows", "matter_root", "hash", "store", "old_path", "new_path"}
                                                 -> relocate_plan's plan, plus "stored_path"
    {"op": "confirm", "rows", "plan_rows", "matter_root", "new_path"}
                                                 -> {"confirmed": bool}

`rows` are the probe's rows. `confirm` is Step 4: every record the plan moved
must now store the new path. A bad `hash` or `store` raises ValueError.
Standard library only.
"""

import os
import re

_SKILL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_OPERATION = os.path.join(_SKILL, 'operations', 'relocate-source.md')
_CONVENTIONS = os.path.join(_SKILL, 'shared', 'conventions.md')

_STORES = ('main', 'privileged', 'law')


def _fenced(path, lang, needle):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    for body in re.findall(r'```' + lang + r'\n(.*?)```', text, re.S):
        if needle in body:
            return body
    raise LookupError(f'no ```{lang} block containing {needle!r} in {path}')


def _functions():
    namespace = {}
    exec(_fenced(_CONVENTIONS, 'python', 'def stored_form('), namespace)
    exec(_fenced(_OPERATION, 'python', 'def relocate_plan('), namespace)
    return namespace


def _check(request):
    if not re.fullmatch(r'[0-9a-f]{64}', request.get('hash') or ''):
        raise ValueError('hash must be the lowercase hex SHA-256 of the file')
    if 'store' in request and request['store'] not in _STORES:
        raise ValueError(f"store must be one of {', '.join(_STORES)}")


def run(request):
    op = request['op']
    if op == 'probe':
        _check(request)
        return {'sql': _fenced(_OPERATION, 'sql', '-- relocate-source probe'), 'params': [request['hash']]}
    fn = _functions()
    new_path = fn['stored_form'](request['new_path'], request['matter_root'])
    if op == 'plan':
        _check(request)
        plan = fn['relocate_plan'](request['rows'], request['store'], request['hash'],
                                   request['old_path'], request['new_path'],
                                   request['matter_root'], request['matter_root'])
        return {**plan, 'stored_path': new_path}
    if op == 'confirm':
        now = {(r['store'], r['id']): r['file_path'] for r in request['rows']}
        moved = [r for r in request['plan_rows'] if r['action'] == 'moved']
        return {'confirmed': all(now.get((r['store'], r['id'])) == new_path for r in moved)}
    raise ValueError(f'unknown op {op!r}')
