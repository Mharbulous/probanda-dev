"""supersede_draft.py -- the deterministic steps of operations/supersede-draft.md (CLI).

Pure stdio: no database, no matter file, no clock. It reads one JSON request,
runs one of the operation's own fenced functions, read from the skill tree beside
this script, and prints the result, so the markdown stays their single source
(design-decisions.md #64, on #60's footing). The date in an emit-sql decision is
the caller's, read through matter_data__query (conventions §10).

    python supersede_draft.py candidates < request.json
        {"newcomers": [...], "registered": [...], "pages": {...},
         "scan_folder": "...", "matter_root": "..."}  ->  JSON list of pairs
    python supersede_draft.py rank < request.json
        {"a": "filed", "b": "draft"}  ->  {"keep": ..., "basis": ...}
    python supersede_draft.py fold-plan < request.json
        {"rows": [...], "superseded": id or null, "kept": id or null}  ->  JSON plan
    python supersede_draft.py emit-sql < decision.json
        the §6 decision  ->  the SQL script for matter_data__execute
    python supersede_draft.py rehash-sql < request.json
        {"old": sha256, "new": sha256, "file_path": "..."}  ->  the §6b SQL script
    python supersede_draft.py probe < {}
        ->  §4's pair probe SQL

`matter_data__execute`'s generator imports `generate` and runs `emit-sql` (after
the probe and `fold-plan`) or `rehash-sql` on the host, so their SQL never
reaches the model (ingest orchestrator spec 2.5).

A refused request prints "REFUSED: <reason>" on stderr and exits 2. Standard
library only.
"""

import json
import os
import re
import sys

_SKILL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_OPERATION = os.path.join(_SKILL, 'operations', 'supersede-draft.md')
_CONVENTIONS = os.path.join(_SKILL, 'shared', 'conventions.md')


def _fenced(path, lang, needle):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    for body in re.findall(r'```' + lang + r'\n(.*?)```', text, re.S):
        if needle in body:
            return body
    raise LookupError(f'no ```{lang} block containing {needle!r} in {path}')


def load():
    """The operation's functions, in one namespace."""
    namespace = {}
    exec(_fenced(_CONVENTIONS, 'python', 'def stored_form('), namespace)
    for needle in ('def candidates(', 'def rank(', 'def fold_plan(', 'def emit_sql('):
        exec(_fenced(_OPERATION, 'python', needle), namespace)
    return namespace


def run(command, request):
    fn = load()
    if command == 'candidates':
        return fn['candidates'](request['newcomers'], request['registered'], request.get('pages') or {},
                                request.get('scan_folder') or '', request['matter_root'])
    if command == 'rank':
        return fn['rank'](request.get('a'), request.get('b'))
    if command == 'fold-plan':
        return fn['fold_plan'](request['rows'], request.get('superseded'), request.get('kept'))
    if command == 'emit-sql':
        return fn['emit_sql'](request)
    if command == 'rehash-sql':
        return fn['rehash_sql'](request.get('old'), request.get('new'), request.get('file_path'))
    if command == 'probe':
        return _fenced(_OPERATION, 'sql', '-- supersede-draft pair probe')
    raise ValueError(f'unknown command {command!r}')


def generate(request):
    """matter_data__execute's generator (ingest orchestrator spec 2.5): `run` for the command the
    request names, imported by the data server over PYTHONPATH."""
    return run(request['command'], request)


def main(argv):
    if len(argv) != 2:
        print('usage: supersede_draft.py candidates|rank|fold-plan|emit-sql|rehash-sql < request.json', file=sys.stderr)
        return 1
    try:
        result = run(argv[1], json.load(sys.stdin))
    except (ValueError, KeyError) as exc:
        print(f'REFUSED: {exc}', file=sys.stderr)
        return 2
    print(result if isinstance(result, str) else json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
