#!/usr/bin/env python3
"""get_matter_profile.py — matter completeness + proceedings/parties summary.

Read-only. Prints the matter_metadata completeness (the expected identifying
keys, which are present, which are missing/blank) plus a per-proceeding summary
with parties grouped by role. This is the E1 convenience mirror of the profile /
proceedings-profile operations' summaries; it inspects only, it never writes.

E1-ONLY. Do not run/import/copy/stage in a mediated/sandboxed (E2) filesystem —
the mount may serve stale/truncated bytes. See ../scripts.md.

Usage:
    python3 get_matter_profile.py <matter_root>
"""

import argparse
import json
import sys

import fuse_safe_io
import resolve_paths

# Matter-level completeness keys (../../shared/profile-protocol.md).
EXPECTED_KEYS = [
    'matter_id', 'client_no', 'matter_no', 'short_name', 'client_name',
    'filing_lawyer_name', 'filing_lawyer_firm',
]


def matter_completeness(con):
    rows = dict(con.execute("SELECT key, value FROM matter_metadata").fetchall())
    present, missing = {}, []
    for key in EXPECTED_KEYS:
        val = rows.get(key)
        if val is None or str(val).strip() == '':
            missing.append(key)
        else:
            present[key] = val
    return present, missing, rows


def proceedings_summary(con):
    rows = con.execute(
        "SELECT pr.proceeding_id, pr.court, pr.registry, pr.file_number, "
        "       pr.style_of_cause, pr.courthouse_address, pr.trial_date, pr.status, "
        "       pp.role, pa.name, pa.party_type, pa.lawyer_name, pa.lawyer_firm "
        "FROM proceedings pr "
        "LEFT JOIN proceeding_parties pp ON pp.proceeding_id = pr.proceeding_id "
        "LEFT JOIN parties pa ON pa.party_id = pp.party_id "
        "ORDER BY pr.proceeding_id, pp.role").fetchall()
    procs = {}
    for (pid, court, registry, file_number, style, courthouse, trial_date, status,
         role, name, party_type, lawyer_name, lawyer_firm) in rows:
        p = procs.setdefault(pid, {
            'proceeding_id': pid, 'court': court, 'registry': registry,
            'file_number': file_number, 'style_of_cause': style,
            'courthouse_address': courthouse, 'trial_date': trial_date,
            'status': status, 'parties': [],
        })
        if name is not None:
            p['parties'].append({
                'role': role, 'name': name, 'party_type': party_type,
                'lawyer_name': lawyer_name, 'lawyer_firm': lawyer_firm,
            })
    return list(procs.values())


def main(argv=None):
    ap = argparse.ArgumentParser(description="Matter completeness + proceedings summary.")
    ap.add_argument('matter_root', help="Path to the matter root folder.")
    args = ap.parse_args(argv)

    resolved = resolve_paths.resolve_pointer(
        args.matter_root, warn=lambda m: sys.stderr.write(f"WARNING: {m}\n"))
    tmpdir, copies = fuse_safe_io.stage_copies(resolved)
    try:
        con = fuse_safe_io.open_attached(copies)
        try:
            present, missing, all_meta = matter_completeness(con)
            procs = proceedings_summary(con)
        finally:
            con.close()
    finally:
        fuse_safe_io.cleanup(tmpdir)

    print(json.dumps({
        'matter_metadata': all_meta,
        'present_keys': present,
        'missing_keys': missing,
        'complete': not missing,
        'proceedings': procs,
    }, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
