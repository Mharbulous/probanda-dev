"""resolve_authority_source.py — find a stored authority's own file and give it as a PDF (MODULE + CLI).

Read-only. The executable form of operations/verify-law.md §2's locating rule:

  1. Match law.authorities rows to the caller's citation: equal after collapsing whitespace and
     case; failing that, rows whose citation contains the neutral citation (e.g. "2026 BCCA 74")
     parsed from the caller's citation, which tolerates a pinpoint suffix in either store. A row
     tombstoned by a merge ("[MERGED-INTO:" notes, design-decisions.md #22) is not a match. Two or
     more rows -> `authority_ambiguous`, listing them.
  2. recorded_path: the row's stored path (matter-relative or legacy absolute, #50) exists and its
     sha256 equals the stored hash.
  3. hash_search: otherwise walk `6. LAW`, then the rest of the matter tree, skipping TRASH,
     0. CASE DATA, privileged and disclosed folders and hashing only .pdf .doc .docx .rtf files,
     until one's sha256 equals the stored hash. Stops at HASH_SEARCH_S with `search_truncated`.
     A OneDrive cloud-only file is skipped unread and counted in `skipped_cloud_only`; a file
     that cannot be read is listed in `unreadable`.
  4. named_path: only when the caller named a file and nothing above resolved. `hash_identity` is
     true only if its sha256 equals the matched row's stored hash.
  5. unresolved: nothing found. `tried` names each path tried and why it failed (missing, hash
     mismatch), `searched` the folders walked.

The original bytes are always what is hashed. A non-PDF source is then converted to PDF by
Microsoft Word through COM (PowerShell, publish-bcsc-form's render.py shape), from a temp copy so
nothing is written beside the matter's file, into `<cache_dir>/<sha256>.pdf` through a temp name
and a rename. A cached PDF is reused, so a re-run skips Word. No Word -> `converter_missing`; Word
failing or writing no PDF -> `conversion_failed` with its stderr. Word gets what is left of
DEADLINE_S; under WORD_MIN_S left, it is not started (`conversion_failed`, call again). On a
timeout, each WINWORD.EXE that was not running before the launch is killed by its PID and named in
the detail. There is no LibreOffice path.

The result speaks the drafting runtime's vocabulary (`path`, `sha256`), never this skill's column
names. Statuses: `ok`, `authority_ambiguous`, `unresolved`, `converter_missing`,
`conversion_failed`. Reads a temp copy of law.sqlite only, takes no lock, writes nothing but the
cache file. Standard library only.

    python resolve_authority_source.py < request.json
    request = {"case_data_dir", "matter_root", "citation", "source_path"?, "cache_dir"}
"""

import csv
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

import resolve_paths

HASH_SEARCH_S = 20
DEADLINE_S = 38                     # the runtime gives the whole call 40 s
WORD_MIN_S = 5                      # less left than this, and Word is not started
LAW_FOLDER = '6. LAW'
SKIPPED = {'trash', '0. case data', 'privileged', 'disclosed'}
SEARCHED_SUFFIXES = {'.pdf', '.doc', '.docx', '.rtf'}
_NEUTRAL = re.compile(r'\b(\d{4})\s+([A-Z]{2,6})\s+(\d+)\b')
_MERGED = '[MERGED-INTO:'
# FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_OFFLINE: a OneDrive cloud-only file.
CLOUD_ONLY = 0x400000 | 0x1000

_WORD_SCRIPT = (
    '$ErrorActionPreference = "Stop"\n'
    '$word = New-Object -ComObject Word.Application\n'
    '$word.Visible = $false\n'
    '$word.DisplayAlerts = 0\n'
    'try {\n'
    '    $doc = $word.Documents.Open($env:COCLERK_RENDER_SOURCE, $false, $true, $false)\n'
    '    $doc.ExportAsFixedFormat($env:COCLERK_RENDER_PDF, 17)\n'
    '    $doc.Close([ref]$false)\n'
    '} finally {\n'
    '    $word.Quit()\n'
    '}\n'
)


def _collapse(text):
    return ' '.join((text or '').split()).casefold()


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def _rows(case_data_dir):
    """(citation, title, stored path, stored hash) of every live authority row."""
    law = os.path.join(case_data_dir, 'law.sqlite')
    if not os.path.isfile(law):
        return None
    tmp = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('authority'))
    try:
        staged = os.path.join(tmp, 'law.sqlite')
        shutil.copy2(law, staged)
        con = sqlite3.connect(staged)
        try:
            return [row[:4] for row in con.execute(
                "SELECT citation, title, file_path, file_hash, notes FROM authorities")
                if not (row[4] or '').lstrip().startswith(_MERGED)]
        finally:
            con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _match(rows, citation):
    wanted = _collapse(citation)
    exact = [r for r in rows if r[0] and _collapse(r[0]) == wanted]
    if exact:
        return exact
    neutral = _NEUTRAL.search(citation or '')
    if not neutral:
        return []
    pattern = re.compile(r'(?<!\d)%s\s+%s\s+%s(?!\d)' % neutral.groups(), re.IGNORECASE)
    return [r for r in rows if r[0] and pattern.search(r[0])]


def _absolute(matter_root, stored):
    return os.path.normpath(stored) if resolve_paths.is_absolute(stored) \
        else resolve_paths.norm_join(matter_root, stored)


def _hash_search(matter_root, wanted, started):
    """(path or None, searched folders, truncated, cloud-only files skipped, unreadable paths).

    A file OneDrive holds in the cloud only is skipped, never hashed, because reading it would
    download it.
    """
    law_dir = os.path.join(matter_root, LAW_FOLDER)
    roots = ([law_dir] if os.path.isdir(law_dir) else []) + [matter_root]
    searched, cloud_only, unreadable = [], 0, []
    for root in roots:
        searched.append(root)
        for folder, dirs, files in os.walk(root):
            dirs[:] = sorted(d for d in dirs if d.casefold() not in SKIPPED
                             and os.path.join(folder, d) != law_dir)
            for name in sorted(files):
                if os.path.splitext(name)[1].lower() not in SEARCHED_SUFFIXES:
                    continue
                if time.monotonic() - started > HASH_SEARCH_S:
                    return None, searched, True, cloud_only, unreadable
                path = os.path.join(folder, name)
                try:
                    if getattr(os.stat(path), 'st_file_attributes', 0) & CLOUD_ONLY:
                        cloud_only += 1
                        continue
                    if _sha256(path) == wanted:
                        return path, searched, False, cloud_only, unreadable
                except OSError:
                    unreadable.append(path)
    return None, searched, False, cloud_only, unreadable


def _format(path):
    with open(path, 'rb') as handle:
        head = handle.read(8)
    if head.startswith(b'%PDF'):
        return 'pdf'
    if head.startswith(b'{\\rtf'):
        return 'rtf'
    if head.startswith(b'PK'):
        return 'docx'
    if head.startswith(b'\xd0\xcf\x11\xe0'):
        return 'doc'
    return None


def _word_installed():
    if os.name != 'nt' or shutil.which('powershell') is None:
        return False
    candidates = (
        os.path.join(os.environ.get('ProgramFiles', ''),
                     'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
        os.path.join(os.environ.get('ProgramFiles(x86)', ''),
                     'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
    )
    return any(os.path.isfile(c) for c in candidates)


def _word_pids():
    """The PIDs of the running WINWORD.EXE processes."""
    done = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq WINWORD.EXE', '/FO', 'CSV', '/NH'],
                          capture_output=True, text=True)
    return {int(row[1]) for row in csv.reader(done.stdout.splitlines())
            if len(row) > 1 and row[1].isdigit()}


def _convert(source, sha256, cache_dir, started):
    """(status, detail, pdf path, cached) for a non-PDF source."""
    cached = os.path.join(cache_dir, sha256 + '.pdf')
    if os.path.isfile(cached):
        return 'ok', None, cached, True
    if not _word_installed():
        return ('converter_missing',
                'Microsoft Word (WINWORD.EXE under Office16) and PowerShell are needed to convert '
                'a non-PDF source, and Word was not found', None, False)
    budget = DEADLINE_S - (time.monotonic() - started)
    if budget < WORD_MIN_S:
        return 'conversion_failed', 'no time left for Word; call again', None, False
    os.makedirs(cache_dir, exist_ok=True)
    partial = os.path.join(cache_dir, '%s.%d.partial.pdf' % (sha256, os.getpid()))
    tmp = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('authority'))
    try:
        copy = os.path.join(tmp, 'source' + os.path.splitext(source)[1].lower())
        shutil.copyfile(source, copy)
        env = {**os.environ, 'COCLERK_RENDER_SOURCE': copy, 'COCLERK_RENDER_PDF': partial}
        before = _word_pids()
        try:
            done = subprocess.run(
                ['powershell', '-NoProfile', '-NonInteractive', '-Command', _WORD_SCRIPT],
                capture_output=True, text=True, timeout=budget, env=env)
        except subprocess.TimeoutExpired:
            # Word is a separate COM server, so killing PowerShell leaves it running. Only the
            # instances that were not running before this launch are killed, each by its PID.
            killed = sorted(_word_pids() - before)
            for pid in killed:
                subprocess.run(['taskkill', '/PID', str(pid), '/F'], capture_output=True, text=True)
            return ('conversion_failed',
                    'Word did not finish converting within %d s; killed WINWORD.EXE PIDs: %s' % (
                        budget, ', '.join(map(str, killed)) or 'none'), None, False)
        if done.returncode != 0 or not os.path.isfile(partial):
            return ('conversion_failed',
                    'Word exited %d without writing a PDF: %s' % (
                        done.returncode, done.stderr.strip() or '(no stderr)'), None, False)
        os.replace(partial, cached)
        return 'ok', None, cached, False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        try:
            os.remove(partial)
        except OSError:
            pass


def run(request):
    """One JSON request in, one JSON-serializable result out (see the module docstring)."""
    started = time.monotonic()
    matter_root = request['matter_root']
    citation = request.get('citation') or ''
    rows = _rows(request['case_data_dir'])
    matched = _match(rows or [], citation)
    if len(matched) > 1:
        return {'status': 'authority_ambiguous',
                'candidates': [{'citation': r[0], 'title': r[1], 'path': r[2]} for r in matched]}

    stored_hash = matched[0][3] if matched else None
    tried, searched, truncated, found, arm = [], [], False, None, None
    cloud_only, unreadable = 0, []
    if matched:
        stored = matched[0][2]
        if not stored:
            tried.append({'path': None, 'reason': 'no stored path'})
        elif not stored_hash:
            tried.append({'path': _absolute(matter_root, stored), 'reason': 'no stored hash'})
        else:
            path = _absolute(matter_root, stored)
            if not os.path.isfile(path):
                tried.append({'path': path, 'reason': 'missing'})
            elif _sha256(path) != stored_hash:
                tried.append({'path': path, 'reason': 'hash mismatch'})
            else:
                found, arm = path, 'recorded_path'
        if not found and stored_hash:
            found, searched, truncated, cloud_only, unreadable = _hash_search(
                matter_root, stored_hash, started)
            arm = 'hash_search' if found else None

    named = request.get('source_path')
    if not found and named:
        path = _absolute(matter_root, named)
        if os.path.isfile(path):
            found, arm = path, 'named_path'
        else:
            tried.append({'path': path, 'reason': 'missing'})

    if not found:
        if rows is None:
            reason = 'no law.sqlite in %s' % request['case_data_dir']
        elif not matched:
            reason = 'no stored authority matches the citation %r' % citation
        else:
            reason = 'the stored authority file was not found'
        return {'status': 'unresolved', 'reason': reason, 'tried': tried, 'searched': searched,
                'search_truncated': truncated, 'skipped_cloud_only': cloud_only,
                'unreadable': unreadable}

    sha256 = _sha256(found)
    source = {'arm': arm, 'path': found, 'sha256': sha256,
              'hash_identity': bool(stored_hash) and sha256 == stored_hash,
              'source_format': _format(found), 'tried': tried, 'searched': searched,
              'search_truncated': truncated, 'skipped_cloud_only': cloud_only,
              'unreadable': unreadable}
    if source['source_format'] == 'pdf':
        return {'status': 'ok', **source, 'converter': None, 'pdf': found, 'cached': False}
    if source['source_format'] is None:
        return {'status': 'conversion_failed', **source, 'converter': None,
                'detail': 'not a PDF, RTF or Word file: %s' % found}
    status, detail, pdf, cached = _convert(found, sha256, request['cache_dir'], started)
    result = {'status': status, **source, 'converter': 'word', 'pdf': pdf, 'cached': cached}
    if detail:
        result['detail'] = detail
    return result


if __name__ == '__main__':
    print(json.dumps(run(json.loads(sys.stdin.read())), indent=2))
