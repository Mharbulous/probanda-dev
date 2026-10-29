"""dispatch_context.py -- what an extractor dispatch needs from case data (MODULE + CLI).

Read-only. Behind `matter_data__ingest_run` action `next` (ingest orchestrator
spec 6.1), which stores these values with each dispatch so that
`matter_data__dispatch_inputs` serves them to the extractor and none passes
through the main session:

  matter_context   the matter's proceedings and parties, with each party's roles
  answered_facts   for a response, every non-bare fact of the pleading it answers,
                   keyed `fact:<fact_id>` (ingest-extract.md Path A step 1)
  answered_relief  that pleading's relief items, keyed `relief:<relief_id>`

Reads a temp copy of main.sqlite only (list_parties.read_staged), takes no lock
and writes nothing. Standard library only.

    python dispatch_context.py <case_data_dir> [answers_source_id]
"""

import json
import sys

from list_parties import read_staged
from parties_of_record import _behind


def _read(answers_source_id):
    def read(con):
        behind = _behind(con)
        if behind:
            return behind
        proceedings = [
            {'court': court, 'registry': registry, 'file_number': number, 'style_of_cause': style}
            for court, registry, number, style in con.execute(
                "SELECT court, registry, file_number, style_of_cause FROM proceedings ORDER BY proceeding_id")]
        parties = {}
        for party_id, name in con.execute("SELECT party_id, name FROM parties ORDER BY party_id"):
            parties[party_id] = {'name': name, 'roles': []}
        for party_id, role in con.execute(
                "SELECT party_id, role FROM proceeding_parties ORDER BY party_id, proceeding_id"):
            if party_id in parties and role not in parties[party_id]['roles']:
                parties[party_id]['roles'].append(role)
        out = {'status': 'ok', 'matter_context': {'proceedings': proceedings, 'parties': list(parties.values())},
               'answered_facts': [], 'answered_relief': []}
        if answers_source_id is not None:
            title = (con.execute("SELECT title FROM sources WHERE source_id = ?", (answers_source_id,))
                     .fetchone() or [None])[0]
            out['answered_facts'] = [
                {'fact_key': f'fact:{fact_id}', 'source_title': title, 'source_locator': locator,
                 'description': description}
                for fact_id, locator, description in con.execute(
                    "SELECT fact_id, source_locator, description FROM facts "
                    "WHERE source_id = ? AND description <> '' ORDER BY fact_id", (answers_source_id,))]
            out['answered_relief'] = [
                {'relief_key': f'relief:{relief_id}', 'source_locator': locator, 'description': description}
                for relief_id, locator, description in con.execute(
                    "SELECT relief_id, source_locator, description FROM relief_items "
                    "WHERE source_id = ? ORDER BY relief_id", (answers_source_id,))]
        return out
    return read


def run(request):
    """request = {"case_data_dir": str, "answers_source_id": int | None}"""
    return read_staged(request.get('case_data_dir'), 'dispatch', _read(request.get('answers_source_id')))


if __name__ == '__main__':
    if len(sys.argv) not in (2, 3):
        print('usage: dispatch_context.py <case_data_dir> [answers_source_id]', file=sys.stderr)
        sys.exit(1)
    print(json.dumps(run({'case_data_dir': sys.argv[1],
                          'answers_source_id': int(sys.argv[2]) if len(sys.argv) == 3 else None}), indent=2))
