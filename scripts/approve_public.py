#!/usr/bin/env python3
"""Approve the files under public/ for publication. Run by a person, never by an LLM.

Usage: python scripts/approve_public.py

Checks public/ with check_public_tree, prints every file that was added,
changed or removed since the last approval, and, once the person types
APPROVE, writes public-approved.json: each path under public/ with its
SHA-256. export_public.py publishes only files that match that list.

It refuses to run without a terminal, so a script or an agent cannot approve.

Exit codes: 0 approved or nothing to approve, 1 public/ has a problem, 2 not
approved. Standard library only.
"""
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("check_public_tree", Path(__file__).resolve().parent / "check_public_tree.py")
public_tree = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(public_tree)


def main():
    sys.stdout.reconfigure(errors="backslashreplace")
    files = public_tree.public_files(REPO)
    problems = public_tree.problems_in(REPO, files)
    if problems:
        public_tree.report(problems)
        print(f"\n{len(problems)} problem(s). Fix them before approving.")
        return 1
    current = public_tree.digests(files)
    diff = public_tree.approval_diff(current, public_tree.load_approved(REPO))
    if not diff:
        print(f"Nothing to approve: {len(current)} files already match {public_tree.APPROVED}.")
        return 0
    print(f"Changes to {public_tree.PUBLIC}/ since the last approval:")
    for line in diff:
        print(f"  {line}")
    if not sys.stdin.isatty():
        print("\nSTOP: approval needs a person at a terminal.", file=sys.stderr)
        return 2
    if input("\nRead each file above. Type APPROVE to approve them for publication: ").strip() != "APPROVE":
        print("Not approved. Nothing written.")
        return 2
    with open(REPO / public_tree.APPROVED, "w", encoding="utf-8", newline="\n") as f:
        json.dump(current, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"Approved {len(current)} files. Commit {public_tree.APPROVED}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
