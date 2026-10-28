"""case_data_resolver.py — where a matter's case data lives (MODULE).

The one resolver of a matter's matter-data folder (ADR 0013). Two readers take it:
resolve_paths.py imports it, and the data server's build pastes this file's text
into the backend's embedded helper (source/lawyer/mcp/scripts/resolver.mjs), so the
server still imports nothing from the skill tree at run time.

BYPASS-FREE BY DESIGN: this file holds no pointer write-back, no legacy migration and
no schema-version guard, so it has nothing a migrate_only flag could skip. The guard
bypass stays in resolve_paths.resolve_pointer, reached only from migrate_engine.py
(design-decisions.md #27). Never add resolve_pointer, or anything that imports
resolve_paths, here: the backend embeds this file whole.

E1-ONLY, as resolve_paths.py: it stages temp copies of main.sqlite. See ../scripts.md.

Standard library only.
"""

import os
import re
import shutil
import sqlite3
import tempfile

CASE_DATA_FOLDER = '0. CASE DATA'                       # the matter's case-data folder, and the firm root's name
ENV_ROOT_OVERRIDE = 'COCLERK_CASE_DATA_ROOT'            # replaces computed root when set


def staging_prefix(kind):
    """Temp-folder prefix `coclerk_<kind>_<tag>_`, tagged with the data runtime's per-call
    COCLERK_STAGING_TAG so a call killed on timeout has its folders removed by tag (#1060).
    Run by hand there is no tag, and the prefix is the untagged `coclerk_<kind>_`."""
    tag = os.environ.get('COCLERK_STAGING_TAG')
    return 'coclerk_%s_%s_' % (kind, tag) if tag else 'coclerk_%s_' % kind


def is_absolute(p):
    """True for a Windows drive-letter path, a UNC path, or a POSIX absolute path."""
    if not p:
        return False
    if re.match(r'^[A-Za-z]:[\\/]', p):
        return True
    if p.startswith('\\\\') or p.startswith('//'):
        return True
    return p.startswith('/')


def norm_join(base, *parts):
    """Path join tolerant of both separators; normalized to native form."""
    joined = os.path.join(base, *parts)
    return os.path.normpath(joined.replace('\\', os.sep).replace('/', os.sep))


def sanitize_short_name(name):
    """Strip illegal filename characters and trim to 60 chars."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name or '').strip()
    return cleaned[:60].strip()


def parse_folder_name(matter_folder):
    """Fallback identity from the matter folder name.

    Patterns like "<client>.<matter> Short Name" or "<matter> Short Name": the
    leading token (client.matter or matter-only) is the matter reference,
    stored under the `matter_id` metadata key; the remainder is the short
    name. Returns (matter_id, short_name).
    """
    base = os.path.basename(os.path.normpath(matter_folder))
    m = re.match(r'^\s*((?:\d+\.)?[A-Za-z]?\d+[A-Za-z0-9.\-]*)\s+(.*)$', base)
    if m:
        return m.group(1).strip(), sanitize_short_name(m.group(2))
    return sanitize_short_name(base), ''


def case_data_root(matter_root):
    """The firm-level case data root: env override, else the library's '0. CASE DATA'.
    A matter not yet relocated keeps its folder here (ADR 0013)."""
    override = os.environ.get(ENV_ROOT_OVERRIDE)
    if override:
        return override
    return norm_join(os.path.dirname(os.path.normpath(matter_root)), CASE_DATA_FOLDER)


def matter_case_data_dir(matter_root):
    """The matter's own case-data folder: MATTER_ROOT/0. CASE DATA (ADR 0013)."""
    return norm_join(matter_root, CASE_DATA_FOLDER)


def identity_from_metadata(main_sqlite_path):
    """Return (matter_id, short_name) from main.matter_metadata, or (None, None).

    Probes a temp copy so the native binary is never opened in place.
    """
    if not os.path.exists(main_sqlite_path):
        return None, None
    tmp = tempfile.mkdtemp(prefix=staging_prefix('probe'))
    dst = os.path.join(tmp, 'main.sqlite')
    try:
        shutil.copy2(main_sqlite_path, dst)
        con = sqlite3.connect(dst)
        try:
            rows = dict(con.execute(
                "SELECT key, value FROM matter_metadata "
                "WHERE key IN ('matter_id', 'short_name')").fetchall())
        finally:
            con.close()
        mid = rows.get('matter_id')
        sn = sanitize_short_name(rows.get('short_name', '') or '')
        return (mid, sn) if mid else (None, None)
    except Exception:
        return None, None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def resolve_case_data_dir(matter_root, stored, root, legacy_dir):
    """Select a usable stored nominee, else the matter's own 0. CASE DATA folder
    holding main.sqlite, else a not-yet-relocated folder under the firm root, else
    the matter's own folder as the default (ADR 0013).

    Returns ``(case_data_dir, rejected_nominee)``. A stored path is only a
    nomination: absolute and relative custom locations remain supported when
    they contain ``main.sqlite``.
    """
    if stored:
        nominee = os.path.normpath(stored) if is_absolute(stored) \
            else norm_join(matter_root, stored)
    else:
        nominee = None

    if nominee != legacy_dir and nominee \
            and os.path.exists(norm_join(nominee, 'main.sqlite')):
        return nominee, False

    in_matter = matter_case_data_dir(matter_root)
    if os.path.exists(norm_join(in_matter, 'main.sqlite')):
        return in_matter, bool(stored)

    # A matter not yet relocated keeps its folder under the firm root.
    # A matter folder can be renamed independently of its database folder.
    # Search only direct live-root children with the same matter reference,
    # then prove identity from main.sqlite before selecting one.
    matter_id, _ = parse_folder_name(matter_root)
    if matter_id and os.path.isdir(root):
        try:
            names = sorted(os.listdir(root))
        except OSError:
            names = []
        for name in names:
            candidate = norm_join(root, name)
            candidate_id, _ = parse_folder_name(candidate)
            if candidate_id.casefold() != matter_id.casefold():
                continue
            main_sqlite = norm_join(candidate, 'main.sqlite')
            if not os.path.isfile(main_sqlite):
                continue
            metadata_id, _ = identity_from_metadata(main_sqlite)
            if metadata_id and metadata_id.casefold() == matter_id.casefold():
                return candidate, bool(stored)

    # The firm-root folder named for the matter, as it was derived before ADR 0013. It wins
    # while it exists, even without main.sqlite, so a matter not yet relocated is rebuilt in place.
    mid, sn = None, None
    for cand in (nominee, legacy_dir):
        if cand:
            mid, sn = identity_from_metadata(norm_join(cand, 'main.sqlite'))
            if mid:
                break
    if not mid:
        mid, sn = parse_folder_name(matter_root)
    firm_folder = norm_join(root, f"{mid} {sn}".strip())
    if os.path.isdir(firm_folder):
        return firm_folder, bool(stored and nominee != legacy_dir
                                 and os.path.normcase(nominee) != os.path.normcase(firm_folder))

    derived = in_matter
    rejected = bool(stored and nominee != legacy_dir
                    and os.path.normcase(nominee) != os.path.normcase(derived))
    return derived, rejected
