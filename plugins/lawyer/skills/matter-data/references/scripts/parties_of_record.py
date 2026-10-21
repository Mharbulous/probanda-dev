"""parties_of_record.py — the parties of record of one proceeding (MODULE + CLI).

Read-only. Given a matter-data folder and a proceeding's file number, returns
each party of record of that proceeding with its counsel and address for
service, each value resolved to the party's per-proceeding override when set,
else the party's own value (design-decisions.md #55). Given no file number and
a list of case_party_ids instead (a proceeding before filing has no court
record), returns each of those parties with its own counsel and address for
service, no override applying, and `roles` empty; an id case data does not
hold is absent from `parties`. The drafting runtime spawns it over PYTHONPATH,
the way matter_data__migrate reaches its engine, and prints counsel from it
(design-decisions.md #56).

The result speaks the drafting runtime's vocabulary, never this skill's
column names, so no matter-data table or column name has to appear in the
runtime. Three statuses, never a bare empty list:

  {"status": "ok", "file_number": ..., "parties": [
      {"case_party_id", "name", "roles", "counsel_name", "counsel_firm",
       "counsel_email", "counsel_phone", "address_for_service",
       "address_for_service_filed_on"}, ...]}
  {"status": "not_applicable", "reason": ...}  no matter-data database in the
      folder, or neither a file number nor case_party_ids: nothing to read
  {"status": "unavailable", "reason": ...}     the record cannot be read as
      asked: no proceeding or two with the file number, a database behind
      the current schema, or a party whose role rows carry different overrides

Reads a temp copy of main.sqlite only (never the native file, never law or
privileged), takes no lock, and writes nothing. Standard library only.

    python parties_of_record.py <case_data_dir> <file_number>
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile

import resolve_paths

# The resolved fields, in output order: (output key, column on both tables).
_FIELDS = (
    ('counsel_name', 'lawyer_name'),
    ('counsel_firm', 'lawyer_firm'),
    ('counsel_email', 'lawyer_email'),
    ('counsel_phone', 'lawyer_phone'),
    ('address_for_service', 'address'),
    ('address_for_service_filed_on', 'service_address_filed_date'),
)

_PARTIES_SQL = (
    "SELECT p.party_id, p.name, pp.role, "
    + ", ".join(f"pp.{col}, p.{col}" for _, col in _FIELDS)
    + " FROM proceeding_parties pp JOIN parties p ON p.party_id = pp.party_id"
    " WHERE pp.proceeding_id = ? ORDER BY p.party_id, pp.role"
)


def _version_label(version):
    return f"v{version // 10}.{version % 10}"


def _behind(con):
    """The `unavailable` result for a database behind the current schema, else None."""
    uv = con.execute("PRAGMA user_version").fetchone()[0]
    version = resolve_paths.LEGACY_USER_VERSION if uv == 0 else uv
    if version < resolve_paths.EXPECTED_USER_VERSION:
        return {
            "status": "unavailable",
            "reason": (
                f"case data is at {_version_label(version)} and reading parties of "
                f"record needs {_version_label(resolve_paths.EXPECTED_USER_VERSION)}; "
                "run matter_data__migrate (plan, then apply)"),
        }
    return None


def _read(con, file_number):
    behind = _behind(con)
    if behind:
        return behind
    ids = [row[0] for row in con.execute(
        "SELECT proceeding_id FROM proceedings WHERE trim(file_number) = ?",
        (file_number,))]
    if len(ids) != 1:
        found = "no matter-data proceeding has" if not ids else f"{len(ids)} matter-data proceedings have"
        return {"status": "unavailable", "reason": f"{found} file number {file_number}"}

    parties = []
    for row in con.execute(_PARTIES_SQL, (ids[0],)):
        party_id, name, role, pairs = row[0], row[1], row[2], row[3:]
        values = {key: (pairs[2 * i] if pairs[2 * i] is not None else pairs[2 * i + 1])
                  for i, (key, _) in enumerate(_FIELDS)}
        if parties and parties[-1]["case_party_id"] == party_id:
            entry = parties[-1]
            differing = [key for key, _ in _FIELDS if entry[key] != values[key]]
            if differing:
                return {
                    "status": "unavailable",
                    "reason": (
                        f"{name} (case party {party_id}) carries different overrides "
                        f"on its role rows in proceeding {file_number}: "
                        f"{', '.join(differing)}"),
                }
            entry["roles"].append(role)
            continue
        parties.append({"case_party_id": party_id, "name": name, "roles": [role], **values})
    return {"status": "ok", "file_number": file_number, "parties": parties}


def _read_ids(con, case_party_ids):
    behind = _behind(con)
    if behind:
        return behind
    sql = (
        "SELECT party_id, name, " + ", ".join(col for _, col in _FIELDS)
        + " FROM parties WHERE party_id IN (" + ", ".join("?" * len(case_party_ids))
        + ") ORDER BY party_id")
    parties = [
        {"case_party_id": row[0], "name": row[1], "roles": [],
         **{key: row[2 + i] for i, (key, _) in enumerate(_FIELDS)}}
        for row in con.execute(sql, case_party_ids)
    ]
    return {"status": "ok", "case_party_ids": case_party_ids, "parties": parties}


def run(request):
    """One JSON request in, one JSON-serializable result out.

    request = {"case_data_dir": str, "file_number": str | None,
               "case_party_ids": [int] | None}  (read only with no file number)
    """
    case_data_dir = request.get("case_data_dir")
    file_number = (request.get("file_number") or "").strip()
    case_party_ids = [int(i) for i in request.get("case_party_ids") or []]
    if not file_number and not case_party_ids:
        return {"status": "not_applicable",
                "reason": "the proceeding has no file number, so it has no court record to read"}
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
            return _read(con, file_number) if file_number else _read_ids(con, case_party_ids)
        finally:
            con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: parties_of_record.py <case_data_dir> <file_number>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(run({"case_data_dir": sys.argv[1], "file_number": sys.argv[2]}), indent=2))
