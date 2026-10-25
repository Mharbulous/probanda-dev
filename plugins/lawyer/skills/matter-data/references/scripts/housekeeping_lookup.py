"""housekeeping_lookup.py — ingest status and the review-log lookup for a work list (MODULE + CLI).

Read-only. Runs operations/ingest-status.md and operations/housekeeping-log.md's
`lookup` mode host-side for a work-list builder that spawns it over PYTHONPATH
once per run (design-decisions.md #73).
It executes those operations' own fenced code, with conventions.md §2.4's
stored_form, read from the skill tree beside this script, so the markdown
stays the single source.

Three statuses:

  {"status": "ok", "ingest": [...], "reviews": [...]}
      one ingest-status entry and one review-log lookup result per input
      file, in input order. A review result is {"reviewed", "outcome",
      "reviewed_at", "matched_on", "not_ingested", "ingest_failure"}
  {"status": "not_applicable", "reason": ...}  no matter-data database in the folder
  {"status": "unavailable", "reason": ...}     law.sqlite or privileged.sqlite
      missing, or a database behind the current schema

Reads temp copies of all three databases (never a native file), takes no
lock, and writes nothing. Standard library only.

    python housekeeping_lookup.py < request.json

request = {"case_data_dir": str, "matter_root": str, "files": [{"path", "hash"}]},
each path in stored form (conventions §2.4) and each hash the file's SHA-256.
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile

import fuse_safe_io
import resolve_paths

_SKILL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_STATUS = os.path.join(_SKILL, 'operations', 'ingest-status.md')
_LOG = os.path.join(_SKILL, 'operations', 'housekeeping-log.md')
_CONVENTIONS = os.path.join(_SKILL, 'shared', 'conventions.md')

_DATABASES = ('main', 'law', 'privileged')
_SETTLED = ('renamed', 'manual_review', 'not_ingested')


def _fenced(path, lang, needle):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    for body in re.findall(r'```' + lang + r'\n(.*?)```', text, re.S):
        if needle in body:
            return body
    raise LookupError(f'no ```{lang} block containing {needle!r} in {path}')


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
                f"case data is at {_version_label(version)} and this lookup "
                f"needs {_version_label(resolve_paths.EXPECTED_USER_VERSION)}; "
                "run matter_data__migrate (plan, then apply)"),
        }
    return None


def _newest(rows):
    return max(rows, key=lambda r: r['reviewed_at'] or '') if rows else None


def review(f, log_rows):
    """housekeeping-log.md's `lookup` join for one file: a hash match is preferred over a name
    match for the settled verdict, `not_ingested` matches by hash only, and the ingest failure is
    the newest `ingest_failed` row matching by hash."""
    name = f['path'].split('\\')[-1]
    by_hash = [r for r in log_rows if r['file_hash'] == f['hash']]
    by_name = [r for r in log_rows if r['file_name'] == name]
    settled = _newest([r for r in by_hash if r['outcome'] in _SETTLED])
    matched_on = 'hash'
    if settled is None:
        settled = _newest([r for r in by_name if r['outcome'] in _SETTLED])
        matched_on = 'name'
    failure = _newest([r for r in by_hash if r['outcome'] == 'ingest_failed'])
    return {
        'reviewed': settled is not None,
        'outcome': settled['outcome'] if settled else None,
        'reviewed_at': settled['reviewed_at'] if settled else None,
        'matched_on': matched_on if settled else None,
        'not_ingested': any(r['outcome'] == 'not_ingested' for r in by_hash),
        'ingest_failure': {
            'reason': failure['reason'], 'failure_class': failure['failure_class'],
            'retry_next_run': failure['retry_next_run'], 'reviewed_at': failure['reviewed_at'],
        } if failure else None,
    }


def run(request):
    """One JSON request in, one JSON-serializable result out."""
    case_data_dir = request["case_data_dir"]
    matter_root = request["matter_root"]
    files = request["files"]
    native = {name: os.path.join(case_data_dir, f'{name}.sqlite') for name in _DATABASES}
    if not os.path.isfile(native['main']):
        return {"status": "not_applicable",
                "reason": f"no matter-data database in {case_data_dir}"}
    absent = [f'{name}.sqlite' for name in _DATABASES[1:] if not os.path.isfile(native[name])]
    if absent:
        return {"status": "unavailable",
                "reason": f"{' and '.join(absent)} missing from {case_data_dir}"}
    if not files:
        return {"status": "ok", "ingest": [], "reviews": []}

    namespace = {}
    exec(_fenced(_CONVENTIONS, 'python', 'def stored_form('), namespace)
    exec(_fenced(_STATUS, 'python', 'def ingest_status('), namespace)
    probe = _fenced(_STATUS, 'sql', '-- ingest-status probe')
    hashes = [f['hash'] for f in files]
    names = [f['path'].split('\\')[-1] for f in files]
    lookup = (_fenced(_LOG, 'sql', '-- housekeeping-log lookup')
              .replace('<hash placeholders>', ', '.join('?' * len(hashes)))
              .replace('<name placeholders>', ', '.join('?' * len(names))))

    tmp = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('hklookup'))
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
            rows = [dict(r) for r in con.execute(probe, (json.dumps(hashes),))]
            log_rows = [dict(r) for r in con.execute(lookup, hashes + names)]
        finally:
            con.close()
    finally:
        fuse_safe_io.cleanup(tmp)

    entries = namespace['ingest_status'](files, rows, matter_root, matter_root)
    return {"status": "ok", "ingest": entries, "reviews": [review(f, log_rows) for f in files]}


if __name__ == "__main__":
    print(json.dumps(run(json.loads(sys.stdin.read())), indent=2))
