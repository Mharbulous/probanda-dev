import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "hooks" / "html-pages-gate.py"
DRAFT = r"<matter>\0. DRAFT"

# A remote-device-only host may stage these (ADR 0033, 2026-10-05 amendments), and no other page.
STAGEABLE_NAMES = ["Job Board 1.html", "Job Board - proceeding 2.html", "JOB BOARD 1.HTML",
                   "Litigation Strategy.html", "To Do List.html"]
UNSTAGEABLE_NAMES = ["Job Board.html", "Job Board - SUB Opening.html", "Job Board 1-1.html",
                     "Job Board-1.html", "Job Board .html", "Job Board 1 (2).html"]

PAGE_PATHS = [
    DRAFT + r"\Job Board.html",
    DRAFT + r"\Job Board 1.html",
    DRAFT + r"\Job Board - proceeding 3.html",
    DRAFT + r"\JOB BOARD 1.HTML",
    DRAFT + r"\Job Board - SUB Opening.html",
    DRAFT + r"\Job Board 1-1.html",
    DRAFT + r"\Job Board-1.html",
    DRAFT + r"\job board-1.HTML",
    DRAFT + r"\Litigation Strategy.html",
    DRAFT + r"\Litigation Strategy-2.html",
    DRAFT + r"\To Do List.html",
    DRAFT + r"\To Do List-2.html",
    DRAFT + r"\SUB <filing title>\Work Board.html",
    DRAFT + r"\Matter Board.html",
    r"<case data>\mockups\Filing 1\archive\Work_board @rev3 2026-09-01-10-00.html",
    DRAFT + r"\workboard-status.js",
    "/mnt/<matter>/0. DRAFT/Litigation Strategy.html",
    "/mnt/<matter>/0. DRAFT/To Do List.html",
]
OTHER_PATHS = [
    DRAFT + r"\approval.html",
    DRAFT + r"\index.html",
    DRAFT + r"\SUB <filing title>\Evidence Index.md",
    DRAFT + r"\SUB <filing title>\Work Board.md",
    DRAFT + r"\Job Board notes.txt",
]


def run(payload, dev=False):
    env = {k: v for k, v in os.environ.items() if k != "COCLERK_HTML_DEV"}
    if dev:
        env["COCLERK_HTML_DEV"] = "1"
    stdin = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run([sys.executable, str(SCRIPT)], input=stdin, capture_output=True,
                          text=True, encoding="utf-8", env=env)


def call(tool, tool_input, cwd=None, dev=False):
    return run({"tool_name": tool, "tool_input": tool_input, "cwd": cwd or os.getcwd()}, dev)


class GateTest(unittest.TestCase):
    def assertDenied(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        out = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertIn("HTML pages principle", out["permissionDecisionReason"])
        self.assertIn("board_summary", out["permissionDecisionReason"])
        return out["permissionDecisionReason"]

    def assertAllowed(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "")

    def test_file_tools_refuse_every_page_name(self):
        for tool, key in [("Read", "file_path"), ("Write", "file_path"), ("Edit", "file_path"),
                          ("MultiEdit", "file_path"), ("NotebookRead", "notebook_path"),
                          ("NotebookEdit", "notebook_path")]:
            for path in PAGE_PATHS:
                with self.subTest(tool=tool, path=path):
                    self.assertDenied(call(tool, {key: path}))

    def test_refusal_states_the_presenting_rule(self):
        reason = self.assertDenied(call("Read", {"file_path": PAGE_PATHS[0]}))
        self.assertIn("may present the html to a human user", reason)
        self.assertIn("on the user's own initiative", reason)

    def test_file_tools_allow_other_files(self):
        for path in OTHER_PATHS:
            with self.subTest(path=path):
                self.assertAllowed(call("Read", {"file_path": path}))

    def test_grep_at_a_page_is_refused(self):
        self.assertDenied(call("Grep", {"pattern": "WORKBOARD", "path": PAGE_PATHS[0]}))

    def test_grep_whose_glob_takes_in_a_page_is_refused_only_where_a_page_sits(self):
        with tempfile.TemporaryDirectory() as matter:
            draft = Path(matter, "0. DRAFT")
            draft.mkdir()
            (draft / "Job Board.html").write_text("<html></html>", encoding="utf-8")
            for glob in ["Job Board*.html", "*.html", "*.HTML"]:
                with self.subTest(glob=glob):
                    self.assertDenied(call("Grep", {"pattern": "x", "path": str(draft), "glob": glob}))
            self.assertDenied(call("Grep", {"pattern": "x", "path": matter, "glob": "*.html"}))
            self.assertDenied(call("Grep", {"pattern": "x", "path": str(draft), "type": "html"}))
            self.assertDenied(call("Grep", {"pattern": "x", "glob": "*.html"}, cwd=str(draft)))
            self.assertAllowed(call("Grep", {"pattern": "x", "path": str(draft), "glob": "*.md"}))
        with tempfile.TemporaryDirectory() as plain:
            Path(plain, "index.html").write_text("<html></html>", encoding="utf-8")
            self.assertAllowed(call("Grep", {"pattern": "x", "path": plain, "glob": "*.html"}))

    def test_grep_whose_glob_names_a_page_is_refused_even_where_the_hook_sees_no_folder(self):
        unseen = "/mnt/<matter>/0. DRAFT"
        for glob in ["Job Board*.html", "litigation strategy.html", "to do list.html", "**/Work_board @rev*.html"]:
            with self.subTest(glob=glob):
                self.assertDenied(call("Grep", {"pattern": "x", "path": unseen, "glob": glob}))
        self.assertAllowed(call("Grep", {"pattern": "x", "path": unseen, "glob": "*.md"}))

    def test_glob_is_never_refused(self):
        self.assertAllowed(call("Glob", {"pattern": "**/Job Board*.html"}))

    def test_shell_tools_refuse_a_command_naming_a_page(self):
        for tool in ["Bash", "PowerShell", "mcp__remote-devices__device_bash", "mcp__cowork__workspace__bash",
                     "mcp__workspace__bash"]:
            with self.subTest(tool=tool):
                reason = self.assertDenied(call(tool, {"command": f'cat "{DRAFT}\\Litigation Strategy.html"'}))
                self.assertIn("command text", reason)
        self.assertDenied(call("Bash", {"command": "grep -o 'window.WORKBOARD' '/mnt/x/0. DRAFT/Job Board.html'"}))
        self.assertDenied(call("PowerShell", {"command": 'Get-Content "$d\\workboard-status.js"'}))

    def test_shell_tools_allow_other_html(self):
        self.assertAllowed(call("Bash", {"command": f'cat "{DRAFT}\\notes.html"'}))
        self.assertAllowed(call("mcp__remote-devices__device_bash", {"command": "ls"}))

    def test_device_tools_refuse_any_string_naming_a_page(self):
        self.assertDenied(call("mcp__device_read_file", {"request": {"path": DRAFT + r"\Litigation Strategy.html"}}))
        for tool in ["mcp__remote-devices__device_commit_files", "mcp__remote-devices__device_read_file",
                     "mcp__remote-devices__device_list_dir", "mcp__remote-devices__device_stage_files_extra"]:
            with self.subTest(tool=tool):
                self.assertDenied(call(tool, {"paths": ["/mnt/<matter>/0. DRAFT/Job Board.html"]}))
        self.assertAllowed(call("mcp__remote-devices__device_stage_files",
                                {"paths": ["/mnt/<matter>/0. DRAFT/SUB <filing title>/Evidence Index.md"]}))

    def test_staging_the_current_pages_is_allowed(self):
        for tool in ["mcp__remote-devices__device_stage_files", "mcp__device_stage_files"]:
            for name in STAGEABLE_NAMES:
                for path in ["/mnt/<matter>/0. DRAFT/" + name, DRAFT + "\\" + name]:
                    with self.subTest(tool=tool, path=path):
                        self.assertAllowed(call(tool, {"paths": [path]}))
            for paths in [["/mnt/<matter>/0. DRAFT/Litigation Strategy.html", "/mnt/<matter>/0. DRAFT/Job Board 1.html"],
                          [DRAFT + r"\Litigation Strategy.html", DRAFT + r"\Job Board - proceeding 2.html"]]:
                with self.subTest(tool=tool, paths=paths):
                    self.assertAllowed(call(tool, {"paths": paths}))

    def test_reading_a_stageable_or_unstageable_page_is_refused(self):
        for name in STAGEABLE_NAMES + UNSTAGEABLE_NAMES:
            with self.subTest(name=name):
                self.assertDenied(call("Read", {"file_path": DRAFT + "\\" + name}))
                self.assertDenied(call("mcp__remote-devices__device_read_file", {"path": "/mnt/<matter>/0. DRAFT/" + name}))

    def test_staging_any_other_page_name_is_refused(self):
        for name in UNSTAGEABLE_NAMES + ["Litigation Strategy-2.html", "To Do List-2.html", "Work Board.html", "Matter Board.html",
                                         "Work_board @rev3 2026-01-01-00-00.html", "workboard-status.js"]:
            with self.subTest(name=name):
                self.assertDenied(call("mcp__remote-devices__device_stage_files",
                                       {"paths": ["/mnt/<matter>/0. DRAFT/" + name]}))
        self.assertDenied(call("mcp__remote-devices__device_stage_files",
                               {"paths": ["/mnt/<matter>/0. DRAFT/Job Board 1.html",
                                          "/mnt/<matter>/0. DRAFT/Job Board-1.html"]}))

    def test_a_staged_copy_is_still_a_page(self):
        for staged in ["/mnt/user-data/uploads/Job Board.html", "/mnt/user-data/uploads/Job Board 1.html",
                       "/mnt/user-data/uploads/Litigation Strategy.html", "/mnt/user-data/uploads/To Do List.html"]:
            with self.subTest(staged=staged):
                self.assertDenied(call("Read", {"file_path": staged}))
                self.assertDenied(call("Grep", {"pattern": "x", "path": staged}))
                for tool in ["Bash", "mcp__cowork__workspace__bash"]:
                    self.assertDenied(call(tool, {"command": f"cat '{staged}'"}))
                    self.assertDenied(call(tool, {"command": f"grep -o 'window.WORKBOARD' '{staged}'"}))
        self.assertDenied(call("Grep", {"pattern": "x", "path": "/mnt/user-data/uploads", "glob": "Job Board*.html"}))

    def test_other_tools_are_not_examined(self):
        self.assertAllowed(call("mcp__cowork__present_files", {"files": [PAGE_PATHS[0]]}))
        self.assertAllowed(call("WebFetch", {"url": "https://example.com/Job Board.html"}))

    def test_the_exemption_allows_every_refused_case(self):
        self.assertAllowed(call("Read", {"file_path": PAGE_PATHS[0]}, dev=True))
        self.assertAllowed(call("Bash", {"command": f'cat "{DRAFT}\\Job Board.html"'}, dev=True))
        self.assertAllowed(call("mcp__remote-devices__device_stage_files", {"paths": [PAGE_PATHS[2]]}, dev=True))
        self.assertAllowed(call("Grep", {"pattern": "x", "path": PAGE_PATHS[0]}, dev=True))

    def test_only_the_value_1_exempts(self):
        env_payload = json.dumps({"tool_name": "Read", "tool_input": {"file_path": PAGE_PATHS[0]}})
        env = {k: v for k, v in os.environ.items() if k != "COCLERK_HTML_DEV"}
        env["COCLERK_HTML_DEV"] = "0"
        result = subprocess.run([sys.executable, str(SCRIPT)], input=env_payload, capture_output=True,
                                text=True, encoding="utf-8", env=env)
        self.assertDenied(result)

    def test_malformed_input_fails_open_loudly(self):
        result = run("not json")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")
        self.assertIn("html-pages-gate hook error", result.stderr)


if __name__ == "__main__":
    unittest.main()
