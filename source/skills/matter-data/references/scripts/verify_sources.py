#!/usr/bin/env python3
"""verify_sources.py — integrity check of every stored source citation.

Read-only. For every file_path + locator across main.sources,
privileged.privileged_sources, and the rows that reference them (facts,
positions, evidence_links, fact_provenance), checks that the referenced file
exists under the matter root and that the computed citation
`<file_path>#<locator>` is well formed. Reports checked / OK / broken and lists
the broken citations for the lawyer to fix. Writes nothing.

E1-ONLY. Do not run/import/copy/stage in a mediated/sandboxed (E2) filesystem —
the mount may serve stale/truncated bytes. See ../scripts.md.

Usage:
    python3 verify_sources.py <matter_root>
"""

import argparse
import json
import os
import re
import sys

import fuse_safe_io
import resolve_paths

# Accepted locator forms per the citation format in ../../shared/conventions.md:
#   para. 14 | para. 14(a) | p42-L3-L18 | p3 | ¶14 | hdr
LOCATOR_RE = re.compile(
    r'^(?:para\.\s*\d+(?:\([a-z0-9]+\))?|p\d+(?:-L\d+-L\d+)?|¶\d+|hdr)$',
    re.IGNORECASE)


def locator_ok(locator):
    """A NULL/empty locator is acceptable (source-level, no pinpoint)."""
    if locator is None or str(locator).strip() == '':
        return True
    return bool(LOCATOR_RE.match(str(locator).strip()))


def collect_citations(con):
    """Yield (origin, ref_id, file_path, locator) across sources and referrers.

    file_path always resolves through the owning source; locators come from the
    referencing rows where they carry a pinpoint.
    """
    rows = []
    # main.sources — the file_path authority for main-side citations.
    src_paths = {}
    for source_id, file_path in con.execute(
            "SELECT source_id, file_path FROM sources WHERE file_path IS NOT NULL"):
        src_paths[source_id] = file_path
        rows.append(('sources', source_id, file_path, None))
    # facts, positions, evidence_links reference a source + a locator.
    for table, id_col in (('facts', 'fact_id'),
                          ('positions', 'position_id'),
                          ('evidence_links', 'evidence_link_id')):
        for ref_id, source_id, locator in con.execute(
                f"SELECT {id_col}, source_id, source_locator FROM {table} "
                "WHERE source_id IS NOT NULL"):
            fp = src_paths.get(source_id)
            if fp is not None:
                rows.append((table, ref_id, fp, locator))
    # privileged.privileged_sources + fact_provenance.
    priv_paths = {}
    for source_id, file_path in con.execute(
            "SELECT source_id, file_path FROM privileged.privileged_sources "
            "WHERE file_path IS NOT NULL"):
        priv_paths[source_id] = file_path
        rows.append(('privileged.privileged_sources', source_id, file_path, None))
    for fact_id, source_id, locator in con.execute(
            "SELECT fact_id, source_id, source_locator FROM privileged.fact_provenance"):
        fp = priv_paths.get(source_id)
        if fp is not None:
            rows.append(('privileged.fact_provenance', fact_id, fp, locator))
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description="Verify stored source citations resolve.")
    ap.add_argument('matter_root', help="Path to the matter root folder.")
    args = ap.parse_args(argv)

    matter_root = os.path.normpath(args.matter_root)
    resolved = resolve_paths.resolve_pointer(
        matter_root, warn=lambda m: sys.stderr.write(f"WARNING: {m}\n"))

    tmpdir, copies = fuse_safe_io.stage_copies(resolved)
    checked = ok = broken = 0
    broken_rows = []
    try:
        con = fuse_safe_io.open_attached(copies)
        try:
            for origin, ref_id, file_path, locator in collect_citations(con):
                checked += 1
                abspath = file_path if os.path.isabs(file_path) \
                    else resolve_paths.norm_join(matter_root, file_path)
                exists = os.path.exists(abspath)
                if exists and locator_ok(locator):
                    ok += 1
                else:
                    broken += 1
                    broken_rows.append({
                        'origin': origin,
                        'id': ref_id,
                        'file_path': file_path,
                        'locator': locator,
                        'file_missing': not exists,
                        'bad_locator': not locator_ok(locator),
                    })
        finally:
            con.close()
    finally:
        fuse_safe_io.cleanup(tmpdir)

    print(json.dumps({'checked': checked, 'ok': ok, 'broken': broken,
                      'broken_rows': broken_rows}, indent=2))
    return 1 if broken else 0


if __name__ == '__main__':
    raise SystemExit(main())
