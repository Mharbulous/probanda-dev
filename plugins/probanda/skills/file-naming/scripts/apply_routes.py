#!/usr/bin/env python3
"""Apply an approved housekeeping routing plan from a JSON manifest.

Usage:
    python apply_routes.py <manifest.json>

Manifest shape:
    {
      "expected_total": 12,
      "src_root": "<abs path all sources must sit directly in>",
      "allowed_dst_roots": ["<abs path>", ...],
      "routes": [
        {"src": "<abs path>", "dst_dir": "<abs leaf destination dir>"},
        ...
      ]
    }

The orchestrator writes the manifest from the approved route-plan.json
payload. This is the move counterpart to apply_renames.py: apply_renames.py
hard-rejects any pair whose folder differs (a rename is never a move); this
script performs exactly that move, for a routing profile whose whole job is
relocating a file to a different, sibling destination folder.

Preflight (all-or-nothing; moves nothing on failure):
  - len(routes) must equal expected_total
  - every src must exist and sit directly in src_root (dirname(src) == src_root)
  - every dst_dir must lie under one of allowed_dst_roots
  - dst_dir must differ from dirname(src) (a route to the current folder is
    an upstream modeling error, not a valid route)

Unlike apply_renames.py, a destination-filename collision does NOT fail the
batch: the file is moved under a numbered suffix (see resolve_destination)
instead of overwriting. Only the preflight checks above are hard, whole-batch
failures. A missing leaf destination folder is created (os.makedirs), never
the full category template -- just the specific folder each route names.

expected_total asserts the *approved* count, not the reviewed count -- it
catches manifest-assembly slips, not dispatch drops.
"""
import json
import os
import shutil
import sys


def fail(msg):
    print("PREFLIGHT FAILED: " + msg, file=sys.stderr)
    sys.exit(1)


def under_root(path, root):
    path = os.path.normcase(os.path.normpath(path))
    root = os.path.normcase(os.path.normpath(root))
    return path == root or path.startswith(root + os.sep)


def resolve_destination(dst_dir, basename):
    """Return a free destination path under dst_dir for basename, appending
    a numbered suffix ` (2)`, ` (3)`, ... if the plain name is already taken.
    Never overwrites an existing, different file."""
    root, ext = os.path.splitext(basename)
    candidate = os.path.join(dst_dir, basename)
    n = 2
    while os.path.exists(candidate):
        candidate = os.path.join(dst_dir, "{} ({}){}".format(root, n, ext))
        n += 1
    return candidate


def main():
    if len(sys.argv) != 2:
        fail("expected exactly one argument: path to the manifest JSON")

    with open(sys.argv[1], encoding="utf-8") as fh:
        manifest = json.load(fh)

    expected_total = manifest["expected_total"]
    src_root = manifest["src_root"]
    allowed_dst_roots = manifest["allowed_dst_roots"]
    routes = manifest["routes"]

    if len(routes) != expected_total:
        fail("expected_total={} but manifest lists {} routes".format(
            expected_total, len(routes)))

    for pair in routes:
        src, dst_dir = pair["src"], pair["dst_dir"]
        if not os.path.exists(src):
            fail("source does not exist: " + src)
        if os.path.dirname(src) != src_root:
            fail("source is not directly in src_root: " + src)
        if not any(under_root(dst_dir, root) for root in allowed_dst_roots):
            fail("destination folder is outside every allowed root: " + dst_dir)
        if os.path.normcase(os.path.normpath(dst_dir)) == \
                os.path.normcase(os.path.normpath(os.path.dirname(src))):
            fail("destination folder is the source's own folder: " + src)

    failed = 0
    for pair in routes:
        src, dst_dir = pair["src"], pair["dst_dir"]
        try:
            os.makedirs(dst_dir, exist_ok=True)
            dst = resolve_destination(dst_dir, os.path.basename(src))
            shutil.move(src, dst)
            if os.path.basename(dst) != os.path.basename(src):
                print("ROUTED  {} -> {} (collision, suffixed)".format(src, dst))
            else:
                print("ROUTED  {} -> {}".format(src, dst))
        except OSError as exc:
            print("FAILED  {}: {}".format(src, exc), file=sys.stderr)
            failed += 1

    if failed:
        print("{} of {} routes failed.".format(failed, len(routes)), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
