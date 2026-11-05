"""write_recheck.py -- what an ingest write relies on, looked up again (MODULE + CLI).

Read-only. Behind `matter_data__ingest_result`, inside the write lock, when other
runs have written to the matter since this document was read (group locking spec
7.2 and section 8). A converter opens no database, so this looks up:

  other_version      a court document another run has just recorded that may be
                     another copy of this file (supersede-draft.md's `candidates`)
  answers_source_id  the pleading a response answers, following any supersession
                     to its current copy
  proceeding_gone    the given proceedings no longer on file
  parties_gone       the parties a practitioner chose that are no longer on file
  names              every party's name, for a question asked again

Reads a temp copy of main.sqlite only (list_parties.read_staged), takes no lock
and writes nothing. Standard library only.

    python write_recheck.py < request.json
"""

import json
import re
import sys

import supersede_draft
from ingest_common import append_marker
from list_parties import read_staged
from parties_of_record import _behind

_SUPERSEDED = re.compile(r'\[SUPERSEDED-BY:#(\d+)')
_MAX_HOPS = 10


def _current_copy(con, source_id):
    """`source_id`, or the copy that superseded it, however many times."""
    for _ in range(_MAX_HOPS):
        row = con.execute("SELECT notes FROM sources WHERE source_id = ?", (source_id,)).fetchone()
        match = _SUPERSEDED.search((row[0] or '') if row else '')
        if match is None:
            break
        source_id = int(match.group(1))
    return source_id


def _other_version(con, request):
    ids = [i for i in request.get('version_source_ids') or [] if isinstance(i, int)]
    if not ids:
        return None
    marks = ','.join('?' * len(ids))
    rows = [
        {'source_id': source_id, 'title': title, 'file_path': file_path, 'notes': notes}
        for source_id, title, file_path, notes in con.execute(
            f"SELECT source_id, title, file_path, notes FROM sources WHERE parent_source_id IS NULL "
            f"AND category = 'court' AND source_id IN ({marks}) AND file_hash IS NOT ?",
            (*ids, request.get('file_hash')))]
    pairs = supersede_draft.run('candidates', {
        'newcomers': [{'path': request['file_path'], 'hash': request.get('file_hash'), 'court': True}],
        'registered': rows, 'pages': {}, 'scan_folder': '', 'matter_root': request['matter_root'],
    })
    found = next((p['source_id'] for p in pairs if 'newcomer' in p), None)
    if found is None:
        return None
    return {'source_id': found, 'title': next(r['title'] for r in rows if r['source_id'] == found)}


def _read(request):
    def read(con):
        behind = _behind(con)
        if behind:
            return behind
        answers = request.get('answers_source_id')
        parties = dict(con.execute("SELECT party_id, name FROM parties"))
        proceedings = {row[0] for row in con.execute("SELECT proceeding_id FROM proceedings")}
        return {
            'status': 'ok',
            'other_version': _other_version(con, request),
            'answers_source_id': None if answers is None else _current_copy(con, answers),
            'proceeding_gone': [i for i in request.get('proceeding_ids') or [] if i not in proceedings],
            'parties_gone': [i for i in request.get('chosen_parties') or [] if i not in parties],
            'names': {str(k): v for k, v in parties.items()},
        }
    return read


def run(request):
    """request = {case_data_dir, matter_root, file_path, file_hash, answers_source_id,
    proceeding_ids, chosen_parties, version_source_ids}"""
    return read_staged(request.get('case_data_dir'), 'write recheck', _read(request))


def pending_marker(request):
    """The unattended stand-in for the choice of copy (ingest-unattended.md Substitution 1h's marker)."""
    other, source = int(request['other_id']), int(request['source_id'])
    return append_marker(f"'SUPERSEDE-PENDING: possible other version of source #{other}.'", str(source))


if __name__ == '__main__':
    print(json.dumps(run(json.load(sys.stdin)), indent=2))
