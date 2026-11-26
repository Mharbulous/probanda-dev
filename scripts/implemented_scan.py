#!/usr/bin/env python3
"""
implemented_scan: mark each suggestion item a plugin release shipped as implemented.

  python scripts/implemented_scan.py scan --to <sha> --before <sha> [--repo <path>] [--dry-run]
  python scripts/implemented_scan.py scan --to <sha> --since <commit or date> [--repo <path>] [--dry-run]

An item becomes Implemented when the plugin release that includes the fix
commit naming it is pushed to main (design decision 17; lifecycle plan Phase 9).
A release of plugin P is a commit that changes the `version` in
plugins/P/.claude-plugin/plugin.json (the /release command makes it).
.github/workflows/mark-implemented.yml runs it on each push to main that changes
a plugin.json (`--before`), and by hand for a backfill (`--since`).

Which releases are scanned. For each plugin in source/assignment.json, its
releases up to --to are the commits that set a new version, oldest first. With
--before, the scan takes each release not reachable from --before (the ones
this push brought); a plugin whose version did not change has none. With
--since, it takes each release after that commit, or after that date (by commit
date). Each release R of P has a range: from P's release before R (the start
of history when R is P's first) to R.

The scan, for one range of plugin P:
- Commits: every non-merge commit reachable from R and not from the range's
  start, on any parent. Fix commits are built on worktree branches that are
  merged into main, so the commit naming an item is often reached only through a
  merge's second parent. A merge is skipped, as scripts/check_fix_commit.py
  skips it: it names no item, and its diff repeats its branch's commits.
- Each `Suggestion <id> item <n>` line in a commit's message names an item
  (the form scripts/check_fix_commit.py requires of a fix commit).
- P's source roots are the folders scripts/build_plugin.py builds plugins/P/
  from, read through scripts/plugin_layout.py: source/P/; source/skills/<top>/
  for each skill tree P ships (its skills in source/assignment.json, and
  shared/, which every plugin ships); the build folder of each server P ships
  (plugin_layout.SERVERS); and plugins/P/ itself. A fix commit usually changes
  only source, and the release rebuilds plugins/P/ from it.
- A commit reaches P when a path it changed (against its first parent) lies
  under one of P's source roots. Test files count like any other. A commit
  that changed only paths outside every root of P, such as docs/, reaches
  nothing. Only P's roots count in P's range.
- An item is implemented in R when a commit in R's range naming it reaches P.
  Its release is `P <version>`, the version in plugins/P/.claude-plugin/plugin.json
  at R. Ranges are taken oldest release first (by commit date, then in
  source/assignment.json's plugin order), and the first release that reaches an
  item wins: a later one is reported as `also reached` and sends nothing.
- An item named only by commits that reached no plugin is skipped and left
  Approved: its fix has not shipped. No call is made for it.
- Each other item is set once, through suggestion-set-status's implemented form
  (cloud/legal-commons/supabase/functions/suggestion-set-status/), with the
  project secret key from the environment variable SUPABASE_SUGGESTIONS_SECRET_KEY. The
  function refuses an item that is not approved (declined, undecided, or
  already implemented in another release) with a 409; that is reported and not
  retried. The same item with the same release is saved again, so the scan can
  be run again with the same arguments.

Nothing printed holds the key or any suggestion text: only commit ids, item ids
and numbers, releases, badges and the function's fixed replies. `--dry-run`
prints what would be set and calls nothing.

Exit 0: every call was saved or refused by the function (each refusal is
reported). Exit 1: a call failed some other way. Exit 2: the arguments or git
could not be read. On exit 1 it prints the command that runs it again.
"""

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import plugin_layout  # noqa: E402

_spec = importlib.util.spec_from_file_location("check_fix_commit", HERE / "check_fix_commit.py")
check_fix_commit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_fix_commit)

VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
ENDPOINT = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/suggestion-set-status"
KEY_ENV = "SUPABASE_SUGGESTIONS_SECRET_KEY"


class ScanError(Exception):
    """The arguments or git could not be read."""


def git(repo, *args):
    out = subprocess.run(["git", "-C", str(repo), *args], capture_output=True)
    if out.returncode != 0:
        raise ScanError(f"git {' '.join(args)} failed: {out.stderr.decode('utf-8', 'replace').strip()}")
    return out.stdout.decode("utf-8")


def commit_of(repo, rev):
    if not rev:
        raise ScanError("a commit is missing")
    return git(repo, "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}").strip()


def manifest(plugin):
    return f"plugins/{plugin}/.claude-plugin/plugin.json"


# --- Which releases are scanned -----------------------------------------------------------

def blobs(repo, specs):
    """{`<rev>:<path>`: its bytes, or None when missing} for each spec, in one git call."""
    out = subprocess.run(["git", "-C", str(repo), "cat-file", "--batch"],
                         input="".join(f"{s}\n" for s in specs).encode(), capture_output=True)
    if out.returncode != 0:
        raise ScanError(f"git cat-file failed: {out.stderr.decode('utf-8', 'replace').strip()}")
    data, pos, found = out.stdout, 0, {}
    for spec in specs:
        end = data.index(b"\n", pos)
        header = data[pos:end].decode("utf-8", "replace").split()
        pos = end + 1
        if len(header) != 3:  # `<spec> missing`
            found[spec] = None
            continue
        size = int(header[2])
        found[spec] = data[pos:pos + size]
        pos += size + 1
    return found


def version_of(blob, where):
    if blob is None:
        return None
    try:
        version = json.loads(blob).get("version")
    except (ValueError, AttributeError) as err:
        raise ScanError(f"{where} could not be read: {err}")
    if not isinstance(version, str) or not VERSION.match(version):
        raise ScanError(f"{where} has no x.y.z version")
    return version


def releases(repo, plugin, to):
    """[(commit, commit time, version)], oldest first: each commit up to `to` that set a new version of plugin."""
    path = manifest(plugin)
    log = [line.split() for line in git(repo, "log", "--topo-order", "--reverse", "--format=%H %ct",
                                        to, "--", path).splitlines()]
    found = blobs(repo, [f"{c}{s}:{path}" for c, _t in log for s in ("", "^")])
    out = []
    for commit, when in log:
        new = version_of(found[f"{commit}:{path}"], f"{path} at {commit[:12]}")
        old = version_of(found[f"{commit}^:{path}"], f"{path} at {commit[:12]}^")
        # A merge can repeat a version its branch already set: that is not a new release.
        if new is not None and new != old and (not out or out[-1][2] != new):
            out.append((commit, int(when), new))
    return out


def source_roots(spec):
    """The folders (each ending in /) whose files feed plugin `spec` when it is built."""
    tops = set(spec["skills"]) | {"shared"}
    return (f"source/{spec['name']}/", f"plugins/{spec['name']}/",
            *(f"source/skills/{top}/" for top in sorted(tops)),
            *(f"{plugin_layout.SERVERS[key]['build']}/" for key in spec["servers"]))


def ranges(repo, specs, to, before=None, since=None):
    """[(plugin, start or None, release commit, version)] for each release scanned, oldest first."""
    if before:
        limit = [f"^{commit_of(repo, before)}"]
    else:
        try:
            limit = [f"^{commit_of(repo, since)}"]
        except ScanError:
            limit = [f"--since-as-filter={since}"]  # --since is a date, not a commit
    new = set(git(repo, "rev-list", *limit, to).split())
    out = []
    for order, plugin in enumerate(specs):
        found = releases(repo, plugin, to)
        for i, (commit, when, version) in enumerate(found):
            if commit in new:
                out.append((when, order, plugin, found[i - 1][0] if i else None, commit, version))
    return [r[2:] for r in sorted(out)]


# --- The scan -----------------------------------------------------------------------------

def changed_paths(repo, *args):
    return {p for p in git(repo, *args).split("\0") if p}


def named_commits(repo, start, end):
    """[(sha, refs)] for each non-merge commit in start..end whose message names an item."""
    parts = git(repo, "log", "--no-merges", "--format=%H%x00%B%x00", end,
                *([f"^{start}"] if start else [])).split("\0")
    out = []
    for sha, message in zip(parts[0:-1:2], parts[1::2]):
        refs, _bare = check_fix_commit.refs_in(message)
        if refs:
            out.append((sha.strip(), refs))
    return out


def plan(repo, to, before=None, since=None):
    """What the scan would set: {"releases": [(plugin, start, commit, version)],
    "set": [(id, item, release, commits, also)], "skipped": [(id, item, commits)]}."""
    to = commit_of(repo, to)
    specs = plugin_layout.plugins(repo)
    scanned = ranges(repo, specs, to, before, since)
    touched, named, won = {}, {}, {}
    for plugin, start, end, version in scanned:
        release = f"{plugin} {version}"
        roots = source_roots(specs[plugin])
        for sha, refs in named_commits(repo, start, end):
            for ref in refs:
                named.setdefault(ref, set()).add(sha[:12])
            if sha not in touched:
                touched[sha] = changed_paths(repo, "diff-tree", "-r", "--root", "--no-commit-id", "--name-only",
                                             "--no-renames", "-z", sha)
            if not any(path.startswith(roots) for path in touched[sha]):
                continue
            for ref in refs:
                entry = won.setdefault(ref, {"release": release, "commits": [], "also": []})
                if entry["release"] == release:
                    entry["commits"].append(sha[:12])
                elif release not in entry["also"]:
                    entry["also"].append(release)
    out = {"releases": scanned, "set": [], "skipped": []}
    for ref in sorted(named):
        if ref in won:
            e = won[ref]
            out["set"].append((*ref, e["release"], e["commits"], e["also"]))
        else:
            out["skipped"].append((*ref, sorted(named[ref])))
    return out


def post_status(body, endpoint=ENDPOINT):
    """POST one implemented write to suggestion-set-status. (HTTP status or None, reply dict)."""
    key = os.environ.get(KEY_ENV)
    if not key:
        return None, {"error": f"{KEY_ENV} is not set"}
    request = urllib.request.Request(endpoint,
                                     data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"apikey": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as res:
            return res.status, json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as err:
        try:
            reply = json.loads(err.read().decode("utf-8") or "{}")
        except ValueError:
            reply = {}
        return err.code, reply if isinstance(reply, dict) else {}
    except (urllib.error.URLError, OSError, ValueError) as err:
        return None, {"error": f"no reply: {type(err).__name__}"}


def name_of(sid, item):
    return f"Suggestion {sid} item {item}"


def scan(repo, to, before=None, since=None, post=post_status, dry_run=False, out=print):
    """Run the scan. Returns the exit code."""
    to = commit_of(repo, to)
    result = plan(repo, to, before, since)
    for plugin, start, end, version in result["releases"]:
        out(f"release {plugin} {version} at {end[:12]} (range from {start[:12] if start else 'the start'})")
    out(f"implemented_scan: {len(result['releases'])} release(s) up to {to[:12]}: "
        f"{len(result['set'])} item(s) to mark, {len(result['skipped'])} skipped")
    for sid, item, commits in result["skipped"]:
        out(f"skipped, reached no plugin, stays Approved: {name_of(sid, item)} (commit {', '.join(commits)})")
    failed = 0
    for sid, item, release, commits, also in result["set"]:
        note = f" (commit {', '.join(commits)}" + (f"; also reached {', '.join(also)}" if also else "") + ")"
        if dry_run:
            out(f"would mark: {name_of(sid, item)}: {release}{note}")
            continue
        status, reply = post({"suggestion_id": sid, "item": item, "status": "implemented",
                              "implemented_in": release})
        if status == 200:
            out(f"marked: {name_of(sid, item)}: {release}, badge {reply.get('badge')!r}{note}")
        elif status == 409:
            out(f"::warning::not saved, refused by the Suggestion Box: {name_of(sid, item)}: {release}: "
                f"{reply.get('error')}{note}")
        else:
            failed += 1
            out(f"::error::not saved: {name_of(sid, item)}: {release}: "
                f"{status if status is not None else 'no HTTP status'} {reply.get('error')}{note}")
    if failed:
        start = f"--before {before}" if before else f"--since {since}"
        out(f"::error::{failed} item(s) were not marked. Run again, from a checkout of probanda-dev with full "
            f"history and with {KEY_ENV} set in your own terminal: python3 scripts/implemented_scan.py scan "
            f"{start} --to {to}")
        return 1
    return 0


def main(argv):
    sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("scan")
    c.add_argument("--to", required=True)
    start = c.add_mutually_exclusive_group(required=True)
    start.add_argument("--before")
    start.add_argument("--since")
    c.add_argument("--repo", type=Path, default=REPO)
    c.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        return scan(args.repo, args.to, args.before, args.since, dry_run=args.dry_run)
    except (OSError, ScanError) as err:
        print(f"::error::implemented_scan: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
