#!/usr/bin/env python3
"""
implemented_scan: mark each suggestion item a publication shipped as implemented.

  python scripts/implemented_scan.py previous --public <public checkout> [--repo <path>] [--to <sha>]
  python scripts/implemented_scan.py scan --from <sha> --to <sha> [--repo <path>] [--dry-run]

An item becomes Implemented when the public publication that includes the fix
commit naming it is published (design decision 17; lifecycle plan Phase 9 and
open decision 3 (a)). publish-public (.github/workflows/publish-public.yml)
runs both commands.

Where the scan starts. Nothing about this repository is written into the public
repository: its commit message stays exactly the approved top entry of
public/CHANGELOG.md, and no identifier of this private repository enters public
history (COMMANDMENTS.md, Commandments 2 and 4). `previous`, run on a clone of
the public repository before the new commit, prints the newest commit on --to's
first-parent line whose public/ files are, path for path and byte for byte, the
public repository's files (file modes are ignored: the export writes plain
files). That is the state last published. It may be later than the commit the
publication actually ran from, but every commit between the two left public/
as it was, so under the rule below none of them reaches a public plugin, and
starting from the newest match drops no fix. It fails when no commit matches,
and names the command to run by hand.

The scan, over the range --from..--to (--from the previous publication's commit,
--to the one just published):
- Commits: every non-merge commit reachable from --to and not from --from, on
  any parent. Fix commits are built on worktree branches that are merged into
  main, so the commit naming an item is often reached only through a merge's
  second parent: a first-parent walk would see the merge and miss it. A merge
  is skipped, as scripts/check_fix_commit.py skips it: it names no item, and its
  diff repeats its branch's commits.
- Each `Suggestion <id> item <n>` line in a commit's message names an item
  (the form scripts/check_fix_commit.py requires of a fix commit).
- What this publication publishes for plugin P is the set of paths under
  public/plugins/P/ whose content at --to differs from --from (added, changed or
  removed; renames count as a removal and an addition). public/ is exported file
  for file (scripts/export_public.py), so nothing else reaches P.
- A commit reaches P when a path it changed (against its first parent) is in
  that set. A commit that changed only a path the range left as it was (changed
  and changed back), or only paths outside public/plugins/, reaches nothing.
- An item is implemented in P when a commit in the range naming it reaches P.
  When its commits reach more than one plugin, P is the first of them in the
  order lawyer, researcher, litigator, solicitor, and the others are reported.
  Its release is `P <version>`, the version in
  public/plugins/P/.claude-plugin/plugin.json at --to.
- An item named only by commits that reached no public plugin is skipped and
  left Approved: its fix has not reached practitioners (open decision 3's note).
  No call is made for it.
- Each other item is set once, through suggestion-set-status's implemented form
  (cloud/legal-commons/supabase/functions/suggestion-set-status/), with the
  project secret key from the environment variable SUPABASE_SUGGESTIONS_SECRET_KEY. The
  function refuses an item that is not approved (declined, undecided, or
  already implemented in another release) with a 409; that is reported and not
  retried. The same item with the same release is saved again, so the scan can
  be run again over the same range.

Nothing printed holds the key or any suggestion text: only commit ids, item ids
and numbers, releases, badges and the function's fixed replies. `--dry-run`
prints what would be set and calls nothing.

Exit 0: every call was saved or refused by the function (each refusal is
reported). Exit 1: a call failed some other way, or no previous publication was
found. Exit 2: the arguments or git could not be read. On exit 1 it prints the
command that runs it again.
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
import export_public  # noqa: E402

_spec = importlib.util.spec_from_file_location("check_fix_commit", HERE / "check_fix_commit.py")
check_fix_commit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_fix_commit)

PUBLIC_PLUGINS = export_public.PUBLIC_PLUGINS
VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
ENDPOINT = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/suggestion-set-status"
KEY_ENV = "SUPABASE_SUGGESTIONS_SECRET_KEY"


class ScanError(Exception):
    """The arguments, git or the repositories could not be read."""


def git(repo, *args, stdin=None):
    out = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, input=stdin)
    if out.returncode != 0:
        raise ScanError(f"git {' '.join(args)} failed: {out.stderr.decode('utf-8', 'replace').strip()}")
    return out.stdout.decode("utf-8")


def commit_of(repo, rev):
    if not rev:
        raise ScanError("a commit is missing")
    return git(repo, "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}").strip()


def is_ancestor(repo, older, newer):
    return subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor", older, newer],
                          capture_output=True).returncode == 0


# --- Where the scan starts ----------------------------------------------------------------

def has_commits(public):
    return subprocess.run(["git", "-C", str(public), "rev-parse", "--verify", "--quiet", "HEAD"],
                          capture_output=True).returncode == 0


def files_at(repo, tree):
    """{path: blob id} of every file in a tree (modes ignored: the export writes plain files)."""
    out = {}
    for entry in git(repo, "ls-tree", "-r", "-z", tree).split("\0"):
        if not entry:
            continue
        meta, path = entry.split("\t", 1)
        _mode, kind, blob = meta.split()
        if kind == "blob":
            out[path] = blob
    return out


def previous(public, repo, to):
    """The newest commit on `to`'s first-parent line whose public/ files are the public repository's."""
    to = commit_of(repo, to)
    if not has_commits(public):
        raise ScanError(f"{public} has no commits, so no earlier publication")
    published = files_at(public, "HEAD")
    commits = git(repo, "rev-list", "--first-parent", to).split()
    lookup = "".join(f"{c}:{export_public.public_tree.PUBLIC}\n" for c in commits).encode()
    seen = {}
    for commit, line in zip(commits, git(repo, "cat-file", "--batch-check", stdin=lookup).splitlines()):
        parts = line.split()
        if len(parts) != 3 or parts[1] != "tree":
            continue
        tree = parts[0]
        if tree not in seen:
            seen[tree] = files_at(repo, tree) == published
        if seen[tree]:
            return commit
    raise ScanError("no commit on the first-parent line holds the public repository's files under public/")


# --- The scan -----------------------------------------------------------------------------

def changed_paths(repo, *args):
    return {p for p in git(repo, *args).split("\0") if p}


def published_paths(repo, frm, to):
    """{plugin: paths under public/plugins/<plugin>/ whose content differs between frm and to}."""
    out = {}
    for path in changed_paths(repo, "diff", "--name-only", "--no-renames", "-z", frm, to, "--", "public/plugins/"):
        parts = path.split("/")
        if len(parts) > 3 and parts[2] in PUBLIC_PLUGINS:
            out.setdefault(parts[2], set()).add(path)
    return out


def version_at(repo, to, plugin):
    path = f"public/plugins/{plugin}/.claude-plugin/plugin.json"
    try:
        version = json.loads(git(repo, "show", f"{to}:{path}")).get("version")
    except (ScanError, ValueError, AttributeError) as err:
        raise ScanError(f"{path} at {to[:12]} could not be read: {err}")
    if not isinstance(version, str) or not VERSION.match(version):
        raise ScanError(f"{path} at {to[:12]} has no x.y.z version")
    return version


def plan(repo, frm, to):
    """What the scan would set: {"set": [(id, item, release, commits, also)], "skipped": [(id, item, commits)]}."""
    frm, to = commit_of(repo, frm), commit_of(repo, to)
    if not is_ancestor(repo, frm, to):
        raise ScanError(f"{frm} is not an ancestor of {to}")
    published = published_paths(repo, frm, to)
    reached, named = {}, {}
    for sha in git(repo, "rev-list", "--no-merges", "--reverse", f"{frm}..{to}").split():
        refs, _bare = check_fix_commit.refs_in(git(repo, "log", "-1", "--format=%B", sha))
        if not refs:
            continue
        changed = changed_paths(repo, "diff-tree", "-r", "--root", "--no-commit-id", "--name-only",
                                "--no-renames", "-z", sha)
        plugins = [p for p in PUBLIC_PLUGINS if changed & published.get(p, set())]
        for ref in refs:
            named.setdefault(ref, []).append(sha[:12])
            reached.setdefault(ref, [])
            reached[ref] += [p for p in plugins if p not in reached[ref]]
    versions = {}
    out = {"set": [], "skipped": []}
    for ref in sorted(named):
        plugins = sorted(reached[ref], key=PUBLIC_PLUGINS.index)
        if not plugins:
            out["skipped"].append((*ref, named[ref]))
            continue
        plugin = plugins[0]
        if plugin not in versions:
            versions[plugin] = version_at(repo, to, plugin)
        out["set"].append((*ref, f"{plugin} {versions[plugin]}", named[ref], plugins[1:]))
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


def scan(repo, frm, to, post=post_status, dry_run=False, out=print):
    """Run the scan. Returns the exit code."""
    frm, to = commit_of(repo, frm), commit_of(repo, to)
    result = plan(repo, frm, to)
    out(f"implemented_scan: {frm[:12]}..{to[:12]}: {len(result['set'])} item(s) to mark, "
        f"{len(result['skipped'])} skipped")
    for sid, item, commits in result["skipped"]:
        out(f"skipped, reached no public plugin, stays Approved: {name_of(sid, item)} "
            f"(commit {', '.join(commits)})")
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
        out(f"::error::{failed} item(s) were not marked. Run again, from a checkout of probanda-dev with full "
            f"history and with {KEY_ENV} set in your own terminal: python3 scripts/implemented_scan.py scan "
            f"--from {frm} --to {to}")
        return 1
    return 0


def main(argv):
    sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("previous")
    p.add_argument("--public", type=Path, required=True)
    p.add_argument("--repo", type=Path, default=REPO)
    p.add_argument("--to", default="HEAD")
    c = sub.add_parser("scan")
    c.add_argument("--from", dest="frm", default="")
    c.add_argument("--to", required=True)
    c.add_argument("--repo", type=Path, default=REPO)
    c.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "previous":
            try:
                sha = previous(args.public, args.repo, args.to)
            except ScanError as err:
                print(f"::error::implemented_scan previous: {err}. The publication goes ahead; mark its items "
                      "by hand with: python3 scripts/implemented_scan.py scan --from <the commit last published> "
                      "--to <the commit published now>", file=sys.stderr)
                return 1
            print(f"implemented_scan previous: {sha} (the newest commit whose public/ matches the public "
                  "repository)", file=sys.stderr)
            print(sha)
        else:
            if not args.frm:
                print("::error::implemented_scan: the commit last published is unknown (see the step that finds "
                      "it), so nothing was marked. Run by hand: python3 scripts/implemented_scan.py scan "
                      f"--from <the commit last published> --to {args.to}")
                return 1
            return scan(args.repo, args.frm, args.to, dry_run=args.dry_run)
    except (OSError, ScanError) as err:
        print(f"::error::implemented_scan: {err}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
