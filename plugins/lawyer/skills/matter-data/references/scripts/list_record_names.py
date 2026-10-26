"""list_record_names.py — the names a matter's case data records (MODULE + CLI).

Read-only. Given one or more matter-data folders, returns for each the text the
suggestion cross-check builds its tokens from: each document's title, each
document's file name, each proceeding's file number and style of cause, and each party's name with its counsel and firm.
The data server spawns it over PYTHONPATH, as practice_data__contact_checks
spawns list_parties.py (#56), so every table name and all the SQL stay here.
The result is never logged or sent: the data server only matches a suggestion's
text against it, on this computer (Commandment 3).

Per folder, one of three statuses, never a bare empty list:

  {"status": "ok", "titles": [...], "file_names": [...], "matter": [...], "parties": [...]}
  {"status": "not_applicable", ...}  no matter-data database in the folder
  {"status": "unavailable", ...}     a database behind the current schema

Each folder is read from a temp copy of main.sqlite only (never the native file,
never law or privileged), through list_parties.read_staged. Takes no lock and
writes nothing. Standard library only.

    python list_record_names.py <case_data_dir> [<case_data_dir> ...]
"""

import json
import ntpath
import sys

from list_parties import read_staged
from parties_of_record import _behind


def _texts(con, sql):
    return [row[0] for row in con.execute(sql) if isinstance(row[0], str) and row[0].strip()]


def _base_name(path):
    # A file_path may be written with either separator, whatever the host.
    return ntpath.basename(path.replace('/', '\\'))


def _read(con):
    behind = _behind(con)
    if behind:
        return behind
    # Never the housekeeping review log: only its own operation reads it (design decision #26 (d)).
    file_names = [_base_name(p) for p in _texts(con, "SELECT file_path FROM sources ORDER BY source_id")]
    parties = []
    for row in con.execute("SELECT name, lawyer_name, lawyer_firm FROM parties ORDER BY party_id"):
        parties += [value for value in row if isinstance(value, str) and value.strip()]
    return {
        "status": "ok",
        "titles": _texts(con, "SELECT title FROM sources ORDER BY source_id"),
        "file_names": [name for name in file_names if name],
        "matter": (_texts(con, "SELECT file_number FROM proceedings ORDER BY proceeding_id")
                   + _texts(con, "SELECT style_of_cause FROM proceedings ORDER BY proceeding_id")),
        "parties": parties,
    }


def run(request):
    """One JSON request in, one JSON-serializable result out.

    request = {"case_data_dirs": [str, ...]}; the result holds one entry per folder, in order.
    """
    results = []
    for case_data_dir in request.get("case_data_dirs") or []:
        try:
            results.append(read_staged(case_data_dir, 'names', _read))
        except Exception as exc:  # one unreadable folder never hides the others
            results.append({"status": "unavailable", "reason": type(exc).__name__})
    return {"results": results}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: list_record_names.py <case_data_dir> [<case_data_dir> ...]", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(run({"case_data_dirs": sys.argv[1:]}), indent=2))
