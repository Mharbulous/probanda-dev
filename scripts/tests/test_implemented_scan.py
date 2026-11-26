#!/usr/bin/env python3
"""
implemented_scan: a plugin release marks implemented exactly the approved items
whose fix commits changed a path under one of that plugin's source roots, and a backfill gives each
item the release that first shipped it.

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

LAWYER_SKILL = "plugins/lawyer/skills/dyu/SKILL.md"
RESEARCHER_SKILL = "plugins/researcher/skills/legal-citation/SKILL.md"
SOURCE_SKILL = "source/skills/draft/SKILL.md"  # a skill tree no plugin ships
ASSIGNMENT = json.dumps({"status": "cutover", "plugins": {
    "lawyer": {"requires": [], "servers": [], "skills": ["dyu", "common"], "agents": []},
    "researcher": {"requires": [], "servers": [], "skills": ["legal-citation", "common"], "agents": []},
    # timecamp's build folder is source/lawyer/mcp, outside source/billing/.
    "billing": {"requires": [], "servers": ["timecamp"], "skills": [], "agents": []}}})


def manifest(name, version):
    return {f"plugins/{name}/.claude-plugin/plugin.json": json.dumps({"name": name, "version": version}) + "\n"}


class Repo:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.tick = 1_800_000_000

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
        self.tick += 60  # distinct, increasing commit dates
        stamp = f"@{self.tick} +0000"
        with mock.patch.dict(os.environ, {"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp}):
            self.git("commit", "-q", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD")


def fix(subject, sid, item):
    return f"{subject}\n\nWhat changed, in the maintainer's words.\n\nSuggestion {sid} item {item}\n"


def build(root):
    """The repository and its marks: {"base", "first", "pushed_from", "head"}."""
    repo = Repo(root)
    marks = {}
    repo.commit("base", {"source/assignment.json": ASSIGNMENT, **manifest("lawyer", "0.0.1"),
                         **manifest("researcher", "0.0.1"), LAWYER_SKILL: "dyu v1\n",
                         RESEARCHER_SKILL: "citation v1\n", SOURCE_SKILL: "draft v1\n"})
    marks["base"] = repo.git("rev-parse", "HEAD")
    # First release window: B item 2 reaches lawyer here and reaches researcher only later.
    repo.commit(fix("Fix both", B, 2), {LAWYER_SKILL: "dyu v2\n"})
    marks["first"] = repo.commit("Lawyer 0.0.2", manifest("lawyer", "0.0.2"))
    marks["pushed_from"] = marks["first"]
    # The push being scanned: a worktree branch merged into main, then the release.
    repo.commit(fix("Fix the dyu prompt", A, 1), {LAWYER_SKILL: "dyu v3\n"})
    repo.commit(fix("Fix the draft source only", A, 2), {SOURCE_SKILL: "draft v2\n"})
    repo.git("checkout", "-q", "-b", "worktree-fix")
    repo.commit(fix("Fix citation", B, 1), {RESEARCHER_SKILL: "citation v2\n"})
    repo.commit(fix("Fix both, researcher side", B, 2), {RESEARCHER_SKILL: "citation v3\n"})
    repo.git("checkout", "-q", "main")
    repo.commit("unrelated work on main", {"docs/note.md": "note\n"})
    repo.git("merge", "-q", "--no-ff", "-m", "Merge worktree-fix", "worktree-fix")
    # Under plugins/lawyer/, even though it is changed back before the release.
    repo.commit(fix("Add a temporary file", C, 1), {"plugins/lawyer/skills/dyu/temp.md": "temp\n"})
    repo.commit("Take the temporary file out", remove=["plugins/lawyer/skills/dyu/temp.md"])
    # Outside plugins/: reaches no plugin.
    repo.commit(fix("Reword a note", D, 1), {"docs/note.md": "note v2\n"})
    # A plugin.json edit that keeps the version is not a release.
    repo.commit("Describe researcher", {"plugins/researcher/.claude-plugin/plugin.json":
                                        json.dumps({"name": "researcher", "version": "0.0.1",
                                                    "description": "x"}) + "\n"})
    marks["head"] = repo.commit("Lawyer 0.0.3, Researcher 0.1.0", {**manifest("lawyer", "0.0.3"),
                                                                   **manifest("researcher", "0.1.0")})
    return repo, marks


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


def call(sid, item, release):
    return {"suggestion_id": sid, "item": item, "status": "implemented", "implemented_in": release}


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo, self.marks = build(Path(self.tmp.name) / "dev")

    def tearDown(self):
        self.tmp.cleanup()

    def run_scan(self, answers=None, dry_run=False, **start):
        start = start or {"before": self.marks["pushed_from"]}
        stub = Stub(answers)
        lines = []
        try:
            with mock.patch.dict(os.environ, ENV):
                code = scan_mod.scan(self.repo.root, self.marks["head"], **start,
                                     post=functools.partial(scan_mod.post_status, endpoint=stub.url),
                                     dry_run=dry_run, out=lines.append)
        finally:
            stub.close()
        return code, stub, "\n".join(lines)

    def test_push_marks_each_item_whose_fix_reached_the_plugin_with_its_new_version(self):
        code, stub, out = self.run_scan()
        self.assertEqual(code, 0, out)
        self.assertEqual(stub.calls, [
            call(C, 1, "lawyer 0.0.3"),
            call(A, 1, "lawyer 0.0.3"),
            call(B, 1, "researcher 0.1.0"),
            call(B, 2, "researcher 0.1.0"),
        ])
        self.assertEqual(stub.keys, [KEY] * 4)

    def test_a_fix_that_reached_no_plugin_is_skipped_with_no_call(self):
        code, stub, out = self.run_scan()
        called = {(c["suggestion_id"], c["item"]) for c in stub.calls}
        for skipped in [(A, 2), (D, 1)]:
            self.assertNotIn(skipped, called)
            self.assertIn(f"stays Approved: Suggestion {skipped[0]} item {skipped[1]}", out)

    def test_a_plugin_whose_version_did_not_change_is_not_scanned(self):
        self.repo.commit(fix("Fix citation again", E, 1), {RESEARCHER_SKILL: "citation v4\n"})
        lawyer_only = self.repo.commit("Lawyer 0.0.4", manifest("lawyer", "0.0.4"))
        result = scan_mod.plan(self.repo.root, lawyer_only, before=self.marks["head"])
        self.assertEqual([(r[0], r[3]) for r in result["releases"]], [("lawyer", "0.0.4")])
        self.assertEqual(result["set"], [])
        self.assertEqual([(s[0], s[1]) for s in result["skipped"]], [(E, 1)])

    def test_backfill_gives_each_item_the_earliest_release_that_shipped_it(self):
        code, stub, out = self.run_scan(since=self.marks["base"])
        self.assertEqual(code, 0, out)
        self.assertEqual(stub.calls, [
            call(C, 1, "lawyer 0.0.3"),
            call(A, 1, "lawyer 0.0.3"),
            call(B, 1, "researcher 0.1.0"),
            call(B, 2, "lawyer 0.0.2"),
        ])
        self.assertIn("also reached researcher 0.1.0", out)

    def test_a_skill_source_change_reaches_every_plugin_that_ships_the_skill(self):
        self.repo.commit(fix("Fix the common skill", E, 1), {"source/skills/common/SKILL.md": "common v2\n"})
        self.repo.commit(fix("Fix dyu in source", E, 2), {"source/skills/dyu/SKILL.md": "dyu source v2\n"})
        self.repo.commit("Lawyer 0.0.4", manifest("lawyer", "0.0.4"))
        to = self.repo.commit("Researcher 0.1.1", manifest("researcher", "0.1.1"))
        result = scan_mod.plan(self.repo.root, to, before=self.marks["head"])
        self.assertEqual([s[:3] + s[4:] for s in result["set"]], [
            (E, 1, "lawyer 0.0.4", ["researcher 0.1.1"]),
            (E, 2, "lawyer 0.0.4", []),
        ])

    def test_a_server_build_folder_change_reaches_the_plugin_that_ships_the_server(self):
        before = self.repo.commit("Billing 0.0.1", manifest("billing", "0.0.1"))
        self.repo.commit(fix("Fix the timecamp server", E, 1), {"source/lawyer/mcp/src/timecamp.ts": "v2\n"})
        to = self.repo.commit("Researcher 0.1.1, Billing 0.0.2", {**manifest("researcher", "0.1.1"),
                                                                    **manifest("billing", "0.0.2")})
        result = scan_mod.plan(self.repo.root, to, before=before)
        self.assertEqual([s[:3] + s[4:] for s in result["set"]], [(E, 1, "billing 0.0.2", [])])

    def test_backfill_takes_a_date(self):
        _code, stub, _out = self.run_scan(since="2000-01-01")
        self.assertIn(call(B, 2, "lawyer 0.0.2"), stub.calls)

    def test_a_refused_item_is_reported_not_forced(self):
        refusal = (409, {"error": "Not saved. Was this item approved before its fix shipped, and in which release?"})
        code, stub, out = self.run_scan({(B, 1): refusal})
        self.assertEqual(code, 0)
        self.assertEqual(len(stub.calls), 4)
        self.assertIn(f"::warning::not saved, refused by the Suggestion Box: Suggestion {B} item 1", out)

    def test_a_failed_call_fails_loudly_with_the_command_to_run_again_and_never_the_key(self):
        code, _stub, out = self.run_scan({(A, 1): (502, {"error": "the status was not saved"})})
        self.assertEqual(code, 1)
        self.assertIn(f"::error::not saved: Suggestion {A} item 1", out)
        self.assertIn(f"implemented_scan.py scan --before {self.marks['pushed_from']} --to {self.marks['head']}",
                      out)
        self.assertNotIn(KEY, out)

    def test_dry_run_calls_nothing(self):
        code, stub, out = self.run_scan(dry_run=True)
        self.assertEqual((code, stub.calls), (0, []))
        self.assertIn(f"would mark: Suggestion {A} item 1: lawyer 0.0.3", out)

    def test_without_the_key_nothing_is_saved_and_the_run_fails(self):
        lines = []
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(scan_mod.KEY_ENV, None)
            code = scan_mod.scan(self.repo.root, self.marks["head"], before=self.marks["pushed_from"],
                                 out=lines.append)
        self.assertEqual(code, 1)
        self.assertIn(f"{scan_mod.KEY_ENV} is not set", "\n".join(lines))


if __name__ == "__main__":
    unittest.main()
