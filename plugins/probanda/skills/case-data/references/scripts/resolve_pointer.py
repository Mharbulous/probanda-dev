#!/usr/bin/env python3
"""resolve_pointer.py — CLI wrapper around the pointer-resolution preamble.

Resolves a matter's coclerk.json pointer to concrete database paths and prints
them as JSON. A thin CLI over resolve_paths.resolve_pointer (which ports the
inline preamble in ../../shared/conventions.md §2.3) and the staging helpers in
fuse_safe_io.

E1-ONLY. Do not run/import/copy/stage in a mediated/sandboxed (E2) filesystem —
the mount may serve stale/truncated bytes. See ../scripts.md.

Usage:
    python3 resolve_pointer.py <matter_root> [--migrate-only] [--sandbox]
"""

import argparse
import json
import sys

import resolve_paths


def main(argv=None):
    ap = argparse.ArgumentParser(description="Resolve coclerk.json to database paths.")
    ap.add_argument('matter_root', help="Path to the matter root folder.")
    ap.add_argument('--migrate-only', action='store_true',
                    help="Bypass the schema-version guard (migrate operation only).")
    ap.add_argument('--sandbox', action='store_true',
                    help="Running in a sandbox: preserve the durable host path on write-back.")
    args = ap.parse_args(argv)

    resolved = resolve_paths.resolve_pointer(
        args.matter_root,
        running_in_sandbox=args.sandbox,
        migrate_only=args.migrate_only,
        warn=lambda msg: sys.stderr.write(f"WARNING: {msg}\n"),
    )
    print(json.dumps(resolved, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
