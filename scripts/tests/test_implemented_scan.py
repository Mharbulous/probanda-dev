#!/usr/bin/env python3
"""
implemented_scan: a publication marks implemented exactly the approved items
whose fix commits reached a public plugin, and the scan starts at the newest
commit whose public/ files are the public repository's.

Run: python -m pytest -q scripts/tests/test_implemented_scan.py

The commits, files and suggestion ids below are invented for this test. Each
test builds a throwaway git repository under the system's temporary folder.
"""

import functools
import importlib.util
import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("implemented_scan", SCRIPTS / "implemented_scan.py")
scan_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scan_mod)

A = "3b6f1c2a-9d4e-4f7a-8b1c-2d3e4f5a6b7c"
B = "7c6b5a4f-3e2d-4c1b-8a9f-0e1d2c3b4a59"
C = "11111111-2222-4333-8444-555555555555"
D = "66666666-7777-4888-9999-aaaaaaaaaaaa"
E = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
KEY = "sb_secret_test_only_value"

LAWYER_SKILL = "public/plugins/lawyer/skills/dyu/SKILL.md"
RESEARCHER_SKILL = "public/plugins/researcher/skills/legal-citation/SKILL.md"
DEV_SKILL = "source/skills/draft/SKILL.md"


def plugin_json(name, version):
    return json.dumps({"name": name, "version": version}, indent=2) + "\n"


class Repo:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True,
                              text=True).stdout.strip()

    def commit(self, message, write=None, remove=()):
        for rel, text in (write or {}).items():
            path = self.root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            self.git("add", rel)
        for rel in remove:
            self.git("rm", "-q", rel)
        self.git("commit", "-q", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD")


def fix(subject, sid, item):
    return f"{subject}\n\nWhat changed, in the maintainer's words.\n\nSuggestion {sid} item {item}\n"


def build_range(root):
    """(repo, previous published sha, sha being published)."""
    repo = Repo(root)
    repo.commit("base", {
        "public/plugins/lawyer/.claude-plugin/plugin.json": plugin_json("lawyer", "0.0.1"),
        "public/plugins/researcher/.claude-plugin/plugin.json": plugin_json("researcher", "0.0.1"),
        LAWYER_SKILL: "dyu v1\n",
        RESEARCHER_SKILL: "citation v1\n",
        "public/README.md": "readme v1\n",
        DEV_SKILL: "draft v1\n",
    })
    # Published before the range: never called again.
    repo.commit(fix("Earlier fix", E, 1), {LAWYER_SKILL: "dyu v1.1\n"})
    previous = repo.git("rev-parse", "HEAD")
    # Reaches lawyer.
    repo.commit(fix("Fix the dyu prompt", A, 1), {LAWYER_SKILL: "dyu v2\n"})
    # A skill not yet under public/: stays Approved.
    repo.commit(fix("Fix the draft skill", A, 2), {DEV_SKILL: "draft v2\n"})
    # A worktree branch merged into main: its commits are reached only through the merge.
    repo.git("checkout", "-q", "-b", "worktree-fix")
    repo.commit(fix("Fix citation", B, 1), {RESEARCHER_SKILL: "citation v2\n"})
    repo.commit(fix("Fix both", B, 2), {LAWYER_SKILL: "dyu v3\n", RESEARCHER_SKILL: "citation v3\n"})
    repo.git("checkout", "-q", "main")
    repo.commit("unrelated work on main", {"docs/note.md": "note\n"})
    repo.git("merge", "-q", "--no-ff", "-m", "Merge worktree-fix", "worktree-fix")
    # Changed and changed back inside the range: nothing of it is published.
    repo.commit(fix("Add a temporary file", C, 1), {"public/plugins/lawyer/skills/dyu/temp.md": "temp\n"})
    repo.commit("Take the temporary file out", remove=["public/plugins/lawyer/skills/dyu/temp.md"])
    # Outside public/plugins/: reaches no plugin.
    repo.commit(fix("Reword the readme", D, 1), {"public/README.md": "readme v2\n"})
    # The release commit names no item.
    repo.commit("Release", {
        "public/plugins/lawyer/.claude-plugin/plugin.json": plugin_json("lawyer", "0.0.2"),
        "public/plugins/researcher/.claude-plugin/plugin.json": plugin_json("researcher", "0.1.0"),
    })
    return repo, previous, repo.git("rev-parse", "HEAD")


class Stub:
    """A local suggestion-set-status: records each call and answers from `answers`."""

    def __init__(self, answers=None):
        self.calls, self.keys, self.answers = [], [], answers or {}
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                stub.calls.append(body)
                stub.keys.append(self.headers.get("apikey"))
                code, reply = stub.answers.get((body["suggestion_id"], body["item"]),
                                               (200, {"suggestion_id": body["suggestion_id"], "item": body["item"],
                                                      "status": "implemented",
                                                      "badge": f"Implemented in {body['implemented_in']}"}))
                data = json.dumps(reply).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/suggestion-set-status"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


ENV = {scan_mod.KEY_ENV: KEY, "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo, self.prev, self.cur = build_range(Path(self.tmp.name) / "dev")

    def tearDown(self):
        self.tmp.cleanup()

    def run_scan(self, answers=None, dry_run=False):
        stub = Stub(answers)
        lines = []
        try:
            with mock.patch.dict(os.environ, ENV):
                code = scan_mod.scan(self.repo.root, self.prev, self.cur,
                                     post=functools.partial(scan_mod.post_status, endpoint=stub.url),
                                     dry_run=dry_run, out=lines.append)
        finally:
            stub.close()
        return code, stub, "\n".join(lines)

    def test_sets_exactly_the_items_that_reached_a_public_plugin(self):
        code, stub, out = self.run_scan()
        self.assertEqual(code, 0, out)
        self.assertEqual(stub.calls, [
            {"suggestion_id": A, "item": 1, "status": "implemented", "implemented_in": "lawyer 0.0.2"},
            {"suggestion_id": B, "item": 1, "status": "implemented", "implemented_in": "researcher 0.1.0"},
            {"suggestion_id": B, "item": 2, "status": "implemented", "implemented_in": "lawyer 0.0.2"},
        ])
        self.assertEqual(stub.keys, [KEY] * 3)
        self.assertIn("also reached researcher", out)

    def test_fixes_that_reached_no_public_plugin_are_skipped_with_no_call(self):
        code, stub, out = self.run_scan()
        called = {(c["suggestion_id"], c["item"]) for c in stub.calls}
        for skipped in [(A, 2), (C, 1), (D, 1)]:
            self.assertNotIn(skipped, called)
            self.assertIn(f"stays Approved: Suggestion {skipped[0]} item {skipped[1]}", out)
        self.assertNotIn((E, 1), called)
        self.assertNotIn(E, out)

    def test_a_refused_item_is_reported_not_forced(self):
        refusal = (409, {"error": "Not saved. Was this item approved before its fix shipped, and in which release?"})
        code, stub, out = self.run_scan({(B, 1): refusal})
        self.assertEqual(code, 0)
        self.assertEqual(len(stub.calls), 3)
        self.assertIn(f"::warning::not saved, refused by the Suggestion Box: Suggestion {B} item 1", out)

    def test_a_failed_call_fails_loudly_with_the_command_to_run_again_and_never_the_key(self):
        code, _stub, out = self.run_scan({(A, 1): (502, {"error": "the status was not saved"})})
        self.assertEqual(code, 1)
        self.assertIn(f"::error::not saved: Suggestion {A} item 1", out)
        self.assertIn(f"implemented_scan.py scan --from {self.prev} --to {self.cur}", out)
        self.assertNotIn(KEY, out)

    def test_running_again_over_the_same_range_makes_the_same_calls(self):
        _c, first, _o = self.run_scan()
        _c, second, _o = self.run_scan()
        self.assertEqual(first.calls, second.calls)

    def test_dry_run_calls_nothing(self):
        code, stub, out = self.run_scan(dry_run=True)
        self.assertEqual((code, stub.calls), (0, []))
        self.assertIn(f"would mark: Suggestion {A} item 1: lawyer 0.0.2", out)

    def test_without_the_key_nothing_is_saved_and_the_run_fails(self):
        lines = []
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(scan_mod.KEY_ENV, None)
            code = scan_mod.scan(self.repo.root, self.prev, self.cur, out=lines.append)
        self.assertEqual(code, 1)
        self.assertIn(f"{scan_mod.KEY_ENV} is not set", "\n".join(lines))

    def test_a_range_whose_start_is_not_an_ancestor_is_refused(self):
        with self.assertRaises(scan_mod.ScanError):
            scan_mod.plan(self.repo.root, self.cur, self.prev)


APPROVED_ENTRY = "Better prompts for dyu\n\n- dyu restates the request more briefly."


def mirror(repo, public, commit):
    """Write public/ at `commit` into a fresh public checkout and commit it, as an export does."""
    for path in repo.git("ls-tree", "-r", "--name-only", commit, "public/").splitlines():
        dest = public.root / path[len("public/"):]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(subprocess.run(["git", "-C", str(repo.root), "show", f"{commit}:{path}"],
                                        check=True, capture_output=True).stdout)
    public.git("add", "-A")
    return public.commit(APPROVED_ENTRY + "\n")


class PreviousTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo, self.prev, self.cur = build_range(Path(self.tmp.name) / "dev")
        self.public = Repo(Path(self.tmp.name) / "public")

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_commit_whose_public_files_match_is_found(self):
        target = self.repo.git("rev-parse", "HEAD~1")  # the readme reworded, before the release commit
        mirror(self.repo, self.public, target)
        self.assertEqual(scan_mod.previous(self.public.root, self.repo.root, self.cur), target)

    def test_the_public_commit_message_is_only_the_approved_entry(self):
        mirror(self.repo, self.public, self.cur)
        self.assertEqual(self.public.git("log", "-1", "--format=%B"), APPROVED_ENTRY)
        self.assertFalse(hasattr(scan_mod, "stamp"))

    def test_with_no_matching_commit_it_fails(self):
        self.public.commit("Not from this repository", {"README.md": "something else\n"})
        with self.assertRaises(scan_mod.ScanError):
            scan_mod.previous(self.public.root, self.repo.root, self.cur)

    def test_with_an_empty_public_repository_it_fails(self):
        with self.assertRaises(scan_mod.ScanError):
            scan_mod.previous(self.public.root, self.repo.root, self.cur)

    def test_an_item_named_while_public_was_unchanged_after_the_publication_gets_no_call(self):
        published = self.cur
        mirror(self.repo, self.public, published)
        # After the real publication: several commits that leave public/ as it was, one naming an item.
        self.repo.commit("Notes", {"docs/after.md": "after\n"})
        self.repo.commit(fix("Fix the draft skill again", E, 2), {DEV_SKILL: "draft v3\n"})
        self.repo.commit("More notes", {"docs/after.md": "after, again\n"})
        newest_unchanged = self.repo.git("rev-parse", "HEAD")
        # Then a fix that does reach lawyer, and its release.
        self.repo.commit(fix("Fix dyu again", A, 3), {LAWYER_SKILL: "dyu v4\n"})
        self.repo.commit("Release", {
            "public/plugins/lawyer/.claude-plugin/plugin.json": plugin_json("lawyer", "0.0.3")})
        head = self.repo.git("rev-parse", "HEAD")
        start = scan_mod.previous(self.public.root, self.repo.root, head)
        self.assertEqual(start, newest_unchanged)
        stub = Stub()
        lines = []
        try:
            with mock.patch.dict(os.environ, ENV):
                code = scan_mod.scan(self.repo.root, start, head,
                                     post=functools.partial(scan_mod.post_status, endpoint=stub.url),
                                     out=lines.append)
        finally:
            stub.close()
        self.assertEqual(code, 0, lines)
        self.assertEqual(stub.calls, [{"suggestion_id": A, "item": 3, "status": "implemented",
                                       "implemented_in": "lawyer 0.0.3"}])
        # Started from the real publication point instead, that item still reaches nothing.
        self.assertEqual([(s[0], s[1]) for s in scan_mod.plan(self.repo.root, published, head)["skipped"]],
                         [(E, 2)])


if __name__ == "__main__":
    unittest.main()
