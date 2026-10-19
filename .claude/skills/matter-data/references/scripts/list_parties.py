"""list_parties.py — every party in a matter's case data (MODULE + CLI).

Read-only. Given a matter-data folder, returns every party with its type, its
counsel of record, its address and contact_info, and each proceeding it is a
party to with its role there. practice_data__contact_checks spawns it over
PYTHONPATH, as the drafting runtime spawns parties_of_record.py (#56), to find
the parties no practice-data matter role points to (ADR 0009, firm-wide
contacts spec 4.4). Three statuses, never a bare empty list:

  {"status": "ok", "parties": [
      {"party_id", "name", "party_type", "lawyer_name", "lawyer_firm",
       "lawyer_email", "lawyer_phone", "address", "contact_info",
       "proceedings": [{"proceeding_id", "role"}, ...]}, ...]}
  {"status": "not_applicable", "reason": ...}  no matter-data database in the folder
  {"status": "unavailable", "reason": ...}     a database behind the current schema

Reads a temp copy of main.sqlite only (never the native file, never law or
privileged), takes no lock, and writes nothing. Standard library only.

    python list_parties.py <case_data_dir>
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile

import resolve_paths
from parties_of_record import _behind

_COLUMNS = ('party_id', 'name', 'party_type', 'lawyer_name', 'lawyer_firm',
            'lawyer_email', 'lawyer_phone', 'address', 'contact_info')


def _read(con):
    behind = _behind(con)
    if behind:
        return behind
    parties = {}
    for row in con.execute(f"SELECT {', '.join(_COLUMNS)} FROM parties ORDER BY party_id"):
        parties[row[0]] = {**dict(zip(_COLUMNS, row)), "proceedings": []}
    for party_id, proceeding_id, role in con.execute(
            "SELECT party_id, proceeding_id, role FROM proceeding_parties "
            "ORDER BY party_id, proceeding_id, role"):
        if party_id in parties:
            parties[party_id]["proceedings"].append({"proceeding_id": proceeding_id, "role": role})
    return {"status": "ok", "parties": list(parties.values())}


def run(request):
    """One JSON request in, one JSON-serializable result out.

    request = {"case_data_dir": str}
    """
    case_data_dir = request.get("case_data_dir")
    main = os.path.join(case_data_dir, 'main.sqlite')
    if not os.path.isfile(main):
        return {"status": "not_applicable",
                "reason": f"no matter-data database in {case_data_dir}"}
    tmp = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('parties'))
    try:
        staged = os.path.join(tmp, 'main.sqlite')
        shutil.copy2(main, staged)
        con = sqlite3.connect(staged)
        try:
            return _read(con)
        finally:
            con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: list_parties.py <case_data_dir>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(run({"case_data_dir": sys.argv[1]}), indent=2))
