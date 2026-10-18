"""ingest_coverage.py — ingest coverage over whole matter folders (MODULE + CLI).

Read-only. Runs operations/ingest-coverage.md host-side for the drafting
runtime, which spawns it over PYTHONPATH at session entry (design-decisions.md
#60). It executes that operation's own fenced code, with ingest-status.md's
probe and verdict code and conventions.md §2.4's stored_form, read from the
skill tree beside this script, so the markdown stays the single source and
this report and the per-letter check can never disagree.

Three statuses:

  {"status": "ok", "to_ingest", "records", "damaged", "unreadable", "folders",
   "missing", "newest_correspondence", "checked_at"}
                                             the operation's own output;
      "records" holds one {"path", "verdict", "source_id",
      "possible_version_of"} per "to_ingest" path, "folders" the patterns
      checked, and "checked_at" the UTC time this check ran
  {"status": "not_applicable", "reason": ...}  no case-data database in the folder
  {"status": "unavailable", "reason": ...}     law.sqlite or privileged.sqlite
      missing, or a database behind the current schema

Reads temp copies of all three databases (never a native file), takes no
lock, and writes nothing. Standard library only.

    python ingest_coverage.py <case_data_dir> <matter_root>
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone

import resolve_paths

_SKILL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_OPERATION = os.path.join(_SKILL, 'operations', 'ingest-coverage.md')
_STATUS = os.path.join(_SKILL, 'operations', 'ingest-status.md')
_CONVENTIONS = os.path.join(_SKILL, 'shared', 'conventions.md')

# The CLI's scope: the drafting runtime's session-entry check.
FOLDER_GLOBS = ['2. SOLICITOR CLIENT*', '3. CORRESPONDENCE*', '5. COURT*', '7. DISCOVERY*']
CORRESPONDENCE_GLOBS = FOLDER_GLOBS[:2]

_DATABASES = ('main', 'law', 'privileged')


def _fenced(path, lang, needle):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    for body in re.findall(r'```' + lang + r'\n(.*?)```', text, re.S):
        if needle in body:
            return body
    raise LookupError(f'no ```{lang} block containing {needle!r} in {path}')


def _load():
    """The operation's functions, in one namespace, and the ingest-status probe."""
    namespace = {}
    exec(_fenced(_CONVENTIONS, 'python', 'def stored_form('), namespace)
    exec(_fenced(_STATUS, 'python', 'def ingest_status('), namespace)
    exec(_fenced(_OPERATION, 'python', 'def scope_files('), namespace)
    exec(_fenced(_OPERATION, 'python', 'def coverage('), namespace)
    return namespace, _fenced(_STATUS, 'sql', '-- ingest-status probe')


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
                f"case data is at {_version_label(version)} and checking ingest coverage "
                f"needs {_version_label(resolve_paths.EXPECTED_USER_VERSION)}; "
                "run case_data__migrate (plan, then apply)"),
        }
    return None


def run(request):
    """One JSON request in, one JSON-serializable result out.

    request = {"case_data_dir": str, "matter_root": str,
               "folder_globs": [str], "correspondence_globs": [str]}
    """
    case_data_dir = request["case_data_dir"]
    matter_root = request["matter_root"]
    native = {name: os.path.join(case_data_dir, f'{name}.sqlite') for name in _DATABASES}
    if not os.path.isfile(native['main']):
        return {"status": "not_applicable",
                "reason": f"no case-data database in {case_data_dir}"}
    absent = [f'{name}.sqlite' for name in _DATABASES[1:] if not os.path.isfile(native[name])]
    if absent:
        return {"status": "unavailable",
                "reason": f"{' and '.join(absent)} missing from {case_data_dir}"}

    fn, probe = _load()
    scope = fn['scope_files'](matter_root, request["folder_globs"])
    tmp = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('coverage'))
    try:
        staged = {name: os.path.join(tmp, f'{name}.sqlite') for name in _DATABASES}
        for name in _DATABASES:
            shutil.copy2(native[name], staged[name])
        con = sqlite3.connect(staged['main'])
        try:
            behind = _behind(con)
            if behind:
                return behind
            con.execute("ATTACH DATABASE ? AS law", (staged['law'],))
            con.execute("ATTACH DATABASE ? AS privileged", (staged['privileged'],))
            con.row_factory = sqlite3.Row
            rows = [dict(r) for r in con.execute(
                probe, (json.dumps([f['hash'] for f in scope['files']]),))]
        finally:
            con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    entries = fn['ingest_status'](scope['files'], rows, matter_root, matter_root)
    return {"status": "ok", **fn['coverage'](scope, entries, request["correspondence_globs"]),
            "checked_at": datetime.now(timezone.utc).isoformat(timespec='seconds')}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: ingest_coverage.py <case_data_dir> <matter_root>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(run({"case_data_dir": sys.argv[1], "matter_root": sys.argv[2],
                          "folder_globs": FOLDER_GLOBS,
                          "correspondence_globs": CORRESPONDENCE_GLOBS}), indent=2))
