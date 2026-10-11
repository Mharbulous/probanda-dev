"""Read one statement of law for its scrutiny review (references/scrutiny.md).

The runtime's drafting_forms__draft_harness step scrutiny_review runs this script through its
Python driver: one JSON request on stdin, one JSON result on stdout. It opens the database
read-only and writes nothing; the confirmation write stays the session's, through execute.

request = {"db_path": str, "statement_id": int, "proposed_authority_id": int | null}

result = {"status": "ok" | "no_excerpt",
          "statement": {"id", "proposition", "authority": {"id", "title", "citation", "kind"},
                        "pinpoint", "verification"},
          "excerpt": str | null,           the stored excerpt, for the runtime only
          "finding": str | null,           the doubt text
          "answer_file_named": str | null, the first "6. LAW ... .md" fragment of the finding
          "proposed_authority": {...}}     only when proposed_authority_id was given
       | {"status": "not_found" | "proposed_authority_not_found", "detail": str}

A proposed authority must be a row of the statement's own proceeding.
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

# The research lawyer's answer file, as research_filing__save_answer names it under 6. LAW.
_ANSWER_FILE = re.compile(r'6\. LAW[\\/][^`"<>|*?\r\n]*?\.md(?![A-Za-z0-9_])')

_STATEMENT = (
    "SELECT s.id, s.proceeding_id, a.proposition, s.pinpoint, s.excerpt, s.doubt, s.verification, "
    "au.id, au.style_of_cause_or_title, au.citation, au.kind "
    "FROM statements_of_law s "
    "LEFT JOIN law_assertions a ON a.id = s.law_assertion_id "
    "JOIN authorities au ON au.id = s.authority_id "
    "WHERE s.id = ?")

_AUTHORITY = (
    "SELECT id, style_of_cause_or_title, citation, kind FROM authorities "
    "WHERE id = ? AND proceeding_id = ?")


def _authority(row):
    return {"id": row[0], "title": row[1], "citation": row[2], "kind": row[3]}


def run(request):
    statement_id = int(request["statement_id"])
    proposed_id = request.get("proposed_authority_id")
    uri = Path(request["db_path"]).resolve().as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    try:
        row = con.execute(_STATEMENT, (statement_id,)).fetchone()
        if row is None:
            return {"status": "not_found", "detail": f"no statement of law {statement_id}"}
        proposed = None
        if proposed_id is not None:
            found = con.execute(_AUTHORITY, (int(proposed_id), row[1])).fetchone()
            if found is None:
                return {"status": "proposed_authority_not_found",
                        "detail": f"no authority {proposed_id} in the statement's proceeding"}
            proposed = _authority(found)
    finally:
        con.close()

    _, _, proposition, pinpoint, excerpt, doubt, verification = row[:7]
    named = _ANSWER_FILE.search(doubt or "")
    result = {
        "status": "ok" if (excerpt or "").strip() else "no_excerpt",
        "statement": {"id": row[0], "proposition": proposition, "authority": _authority(row[7:]),
                      "pinpoint": pinpoint, "verification": verification},
        "excerpt": excerpt,
        "finding": doubt,
        "answer_file_named": named.group(0) if named else None,
    }
    if proposed is not None:
        result["proposed_authority"] = proposed
    return result


if __name__ == "__main__":
    print(json.dumps(run(json.loads(sys.stdin.read()))))
