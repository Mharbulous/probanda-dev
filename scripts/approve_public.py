#!/usr/bin/env python3
"""Approve the files under public/ for publication.

Usage:
  python scripts/approve_public.py             show what changed, then ask for APPROVE at a terminal
  python scripts/approve_public.py --approve   show what changed and approve without asking

Checks public/ with check_public_tree, then prints what was added, changed or
removed since the last approval: a changed file as a diff against its approved
text, found in git history by its SHA-256, and an added file in full. Once
approved, writes public-approved.json: each path under public/ with its
SHA-256. export_public.py publishes only files that match that list.

A person approves by typing APPROVE at a terminal. An LLM passes --approve,
and only when a human expressly instructs that approval in the current
conversation (COMMANDMENTS.md); a session hook makes the app ask the person
before the command runs. Without a terminal and without --approve, the changes
are shown and nothing is written.

Exit codes: 0 approved or nothing to approve, 1 public/ has a problem, 2 not
approved. Standard library only.
"""
import argparse
import difflib
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("check_public_tree", Path(__file__).resolve().parent / "check_public_tree.py")
public_tree = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(public_tree)


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


def approved_text(repo, rel, digest):
    """The text of public/<rel> that has this SHA-256, from git history, or None."""
    path = f"{public_tree.PUBLIC}/{rel}"
    for commit in git(repo, "log", "--format=%H", "--", path).decode().split():
        shown = subprocess.run(["git", "-C", str(repo), "show", f"{commit}:{path}"], capture_output=True)
        if shown.returncode == 0 and hashlib.sha256(shown.stdout).hexdigest() == digest:
            return shown.stdout.decode("utf-8")
    return None


def show_changes(repo, files, approved):
    """Print each added or changed file's content change, and each removed file's name."""
    current = public_tree.digests(files)
    for rel in sorted(set(current) | set(approved)):
        if current.get(rel) == approved.get(rel):
            continue
        if rel not in current:
            print(f"\nremoved: {rel}")
            continue
        old = approved_text(repo, rel, approved[rel]) if rel in approved else None
        if rel not in approved:
            print(f"\nadded: {rel}")
        elif old is None:
            print(f"\nchanged: {rel} (its approved text is not in git history, so the whole file is shown)")
        else:
            print(f"\nchanged: {rel}")
        diff = difflib.unified_diff((old or "").splitlines(), files[rel].decode("utf-8").splitlines(),
                                    "approved", "now", lineterm="")
        for line in diff:
            print(f"  {line}")


def approve(repo, confirm):
    """Show the changes and, if confirm() says yes, write the approved list. Returns the exit code."""
    files = public_tree.public_files(repo)
    problems = public_tree.problems_in(repo, files)
    if problems:
        public_tree.report(problems)
        print(f"\n{len(problems)} problem(s). Fix them before approving.")
        return 1
    current = public_tree.digests(files)
    approved = public_tree.load_approved(repo)
    if current == approved:
        print(f"Nothing to approve: {len(current)} files already match {public_tree.APPROVED}.")
        return 0
    print(f"Changes to {public_tree.PUBLIC}/ since the last approval:")
    show_changes(repo, files, approved)
    if not confirm():
        print("Not approved. Nothing written.")
        return 2
    with open(repo / public_tree.APPROVED, "w", encoding="utf-8", newline="\n") as f:
        json.dump(current, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"Approved {len(current)} files. Commit {public_tree.APPROVED}.")
    return 0


def ask():
    if not sys.stdin.isatty():
        print("\nNo terminal to ask at, and --approve was not given.")
        return False
    return input("\nRead the changes above. Type APPROVE to approve them for publication: ").strip() == "APPROVE"


def main():
    sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--approve", action="store_true", help="approve without asking at a terminal")
    args = parser.parse_args()
    return approve(REPO, (lambda: True) if args.approve else ask)


if __name__ == "__main__":
    sys.exit(main())
