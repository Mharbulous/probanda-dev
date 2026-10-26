#!/usr/bin/env python3
"""
local_implementer_guard: refuse to run the local implementer anywhere but its own clone.

  python scripts/local_implementer_guard.py [--dir <path>]

The local implementer (`/implement-suggestions local`, started each day by
Brahm's scheduled task, scripts/local-implementer/) pulls, builds, commits and
pushes to `main`. It must never do that in the checkout Brahm and his other
sessions share, or in a worktree of it, where it would sweep up their
uncommitted work. So it runs only in a dedicated clone, made for it alone.

The dedicated clone is `<base>/probanda-local-implementer/probanda-dev`, where
<base> is %LOCALAPPDATA% when it is set (Windows), else `~/.local/share`.

The rule: the directory (default: the current one) passes only when all hold:
- it is the dedicated clone's path, after resolving links and case;
- it is the top of its git working tree, not a folder inside one;
- it is a clone's main working tree, not a linked worktree (`git worktree add`),
  whatever repository the worktree belongs to;
- its `origin` is Mharbulous/probanda-dev.

Exit 0 with one line naming the clone when it passes. Exit 1 with a plain
message naming the failed condition otherwise.
"""

import os
import re
import subprocess
import sys

REPO = "Mharbulous/probanda-dev"
ORIGIN = re.compile(r"^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)"
                    r"Mharbulous/probanda-dev(?:\.git)?/?$", re.IGNORECASE)


def clone_path():
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "probanda-local-implementer", "probanda-dev")


def norm(path):
    return os.path.normcase(os.path.realpath(path))


def git(directory, *args):
    out = subprocess.run(["git", "-C", directory, *args], capture_output=True, text=True)
    return out.stdout.strip() if out.returncode == 0 else None


def check(directory):
    """None when the directory is the dedicated clone, else why it is refused."""
    expected = clone_path()
    if norm(directory) != norm(expected):
        return (f"{directory} is not the local implementer's own clone ({expected}). It never runs in "
                f"the shared checkout or a worktree of it.")
    top = git(directory, "rev-parse", "--show-toplevel")
    if top is None:
        return f"{directory} is not a git working tree"
    if norm(top) != norm(directory):
        return f"{directory} is inside the working tree {top}, not the top of its own clone"
    git_dir = git(directory, "rev-parse", "--path-format=absolute", "--git-dir")
    common = git(directory, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if git_dir is None or common is None or norm(git_dir) != norm(common):
        return f"{directory} is a linked worktree of {common}, not a clone of its own"
    origin = git(directory, "remote", "get-url", "origin")
    if origin is None or not ORIGIN.match(origin):
        return f"{directory}'s origin is {origin or 'not set'}, not {REPO}"
    return None


def main(argv):
    directory = os.getcwd()
    if argv[:1] == ["--dir"] and len(argv) == 2:
        directory = argv[1]
    elif argv:
        print("local_implementer_guard: usage: local_implementer_guard.py [--dir <path>]", file=sys.stderr)
        return 1
    why = check(directory)
    if why:
        print(f"local_implementer_guard: refused: {why}", file=sys.stderr)
        return 1
    print(f"local_implementer_guard: ok: {directory} is the local implementer's own clone")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
