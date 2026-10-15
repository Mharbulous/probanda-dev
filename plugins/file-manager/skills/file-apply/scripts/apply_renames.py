#!/usr/bin/env python3
"""Apply approved in-place renames from a JSON manifest.

Usage:
    python apply_renames.py <manifest.json>

Manifest shape:
    {
      "expected_total": 18,
      "renames": [
        {"src": "<abs path>", "dst": "<abs path>"},
        ...
      ]
    }

The caller writes the manifest from its approved plan. This script does the
in-place renames the caller would otherwise do by hand,
with a hard-fail preflight so a manifest that drifted from the approved plan
never partially applies.

Preflight (all-or-nothing; renames nothing on failure):
  - len(renames) must equal expected_total
  - every src must exist
  - no dst may already exist, unless src and dst are the same file (a case-only
    rename on a case-insensitive filesystem, applied via a temporary
    intermediate name)
  - a dst may be another pair's src (a swap or chain, applied in two passes
    and rolled back on failure); no two pairs may share a src or a dst
  - every pair must be in-place: dirname(src) == dirname(dst)

expected_total asserts the *approved* count, not the reviewed count — it
catches manifest-assembly slips, not files the caller dropped before approval.
"""
import json
import os
import secrets
import sys


def fail(msg):
    print("PREFLIGHT FAILED: " + msg, file=sys.stderr)
    sys.exit(1)


def two_pass(renames):
    """Stage every src under a unique name in its own folder, then move each
    staged path to its dst. On any failure, undo the completed moves and
    restore every staged path to its src. Returns None, or the error text."""
    staged = []
    done = []
    try:
        for pair in renames:
            tmp = "{}.swaptmp.{}".format(pair["src"], secrets.token_hex(4))
            os.rename(pair["src"], tmp)
            staged.append((pair["src"], tmp))
        for (_, tmp), pair in zip(staged, renames):
            os.rename(tmp, pair["dst"])
            done.append((tmp, pair["dst"]))
    except OSError as exc:
        stranded = []
        for tmp, dst in reversed(done):
            try:
                os.rename(dst, tmp)
            except OSError:
                stranded.append(dst)
        for src, tmp in reversed(staged):
            try:
                os.rename(tmp, src)
            except OSError:
                stranded.append(tmp)
        if stranded:
            return "{}; rollback also failed, left at: {}".format(exc, ", ".join(stranded))
        return str(exc)
    return None


def main():
    if len(sys.argv) != 2:
        fail("expected exactly one argument: path to the manifest JSON")

    with open(sys.argv[1], encoding="utf-8") as fh:
        manifest = json.load(fh)

    expected_total = manifest["expected_total"]
    renames = manifest["renames"]

    if len(renames) != expected_total:
        fail("expected_total={} but manifest lists {} renames".format(
            expected_total, len(renames)))

    sources = [os.path.normcase(pair["src"]) for pair in renames]
    destinations = [os.path.normcase(pair["dst"]) for pair in renames]
    if len(set(sources)) != len(sources):
        fail("two pairs share a source")
    if len(set(destinations)) != len(destinations):
        fail("two pairs share a destination")

    for pair in renames:
        src, dst = pair["src"], pair["dst"]
        if not os.path.exists(src):
            fail("source does not exist: " + src)
        if (os.path.exists(dst) and not os.path.samefile(src, dst)
                and os.path.normcase(dst) not in sources):
            fail("destination already exists: " + dst)
        if os.path.dirname(src) != os.path.dirname(dst):
            fail("not an in-place rename (folder differs): {} -> {}".format(src, dst))

    if any(d in sources and d != s for s, d in zip(sources, destinations)):
        error = two_pass(renames)
        if error:
            print("FAILED  swap rolled back: " + error, file=sys.stderr)
            sys.exit(1)
        for pair in renames:
            print("RENAMED {} -> {}".format(pair["src"], pair["dst"]))
        return

    failed = 0
    for pair in renames:
        src, dst = pair["src"], pair["dst"]
        try:
            if src != dst and os.path.exists(dst) and os.path.samefile(src, dst):
                # Case-only rename on a case-insensitive filesystem: src and dst
                # name the same file, so go through an intermediate name.
                tmp = src + ".casetmp"
                if os.path.exists(tmp):
                    raise OSError("intermediate name already exists: " + tmp)
                os.rename(src, tmp)
                try:
                    os.rename(tmp, dst)
                except OSError:
                    os.rename(tmp, src)
                    raise
            else:
                os.rename(src, dst)
            print("RENAMED {} -> {}".format(src, dst))
        except OSError as exc:
            print("FAILED  {} -> {}: {}".format(src, dst, exc), file=sys.stderr)
            failed += 1

    if failed:
        print("{} of {} renames failed.".format(failed, len(renames)), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
