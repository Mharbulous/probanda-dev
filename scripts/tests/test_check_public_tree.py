#!/usr/bin/env python3
"""
check_public_tree: each kind of Trade Secret or Client Information planted in public/ is reported.

Run: python -m pytest -q scripts/tests/test_check_public_tree.py
"""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

import fake_repo

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_public_tree", os.path.join(SCRIPTS, "check_public_tree.py"))
public_tree = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(public_tree)

# Built from parts so this file holds no line the publish scan itself reports.
CREATE = "CREATE" + " TABLE"
MATTER_CODE = "L" + "8443"
LONG_PRIVATE_LINE = "The clerk counts back from the anchor and lands on the next open registry day."
MIT_LINE = "Permission is hereby granted, free of charge, to any person obtaining a copy"

PRIVATE = {
    "source/skills/data/references/schema.sql":
        f"{CREATE} evidence_links (\n  evidence_link_id INTEGER,\n  source_locator TEXT,\n  file_path TEXT\n);\n"
        f"-- a comment naming comment_only_name\n{CREATE} IF NOT EXISTS facts (description TEXT);\n",
    "source/skills/data/references/queries.sql": "SELECT description FROM main.facts;\n",
    "source/skills/data/SKILL.md": f"# Data\n\n{LONG_PRIVATE_LINE}\n\nShort line.\n",
    "source/skills/data/node_modules/lib/index.js": "const a_library_line_that_is_long_enough_to_be_counted_as_a_long_line = 1;\n",
    "source/lawyer/mcp/src/store.ts": f"db.exec(`{CREATE} practice_anchors (id)`);\nconst unrelated_name = 1;\n",
    "source/lawyer/mcp/src/practice/backend.ts":
        f"const SCHEMA_SQL = `\n{CREATE} IF NOT EXISTS practice_matters (\n"
        "  id TEXT PRIMARY KEY, regular_trust REAL CHECK (regular_trust <= 0),\n"
        "  -- a comment naming ddl_comment_name\n  last_trust_date TEXT\n);\n`.trim();\n"
        "const after_the_statement = 1;\n",
    "source/skills/data/notes.md": f"Send the {CREATE} helper_view (section whole.\n\nThen read prose_after_blank here.\n",
    "cloud/pool/schema.sql": "create table if not exists pool.pooled_statements (\n  statement_text text\n);\n",
    "source/lawyer/plugin.json": '{\n  "description": "A litigation practice plugin for British Columbia lawyers and their staff."\n}\n',
    "source/skills/data/references/generic.sql":
        f"{CREATE} notes (\n  created_at TEXT,\n  style_of_cause TEXT,\n  style_of_cause_or_title TEXT\n);\n"
        "SELECT group_concat(created_at) FROM notes;\n",
    "source/lawyer/mcp/LICENSE": f"MIT License\n\n{MIT_LINE}\n",
}


class TreeProblemsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name).resolve()
        fake_repo.write_assignment(self.repo, {"lawyer": {}})
        for rel, text in PRIVATE.items():
            path = self.repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(text.encode("utf-8"))

    def messages(self, files):
        files = {rel: data if isinstance(data, bytes) else data.encode("utf-8") for rel, data in files.items()}
        return [(rel, n, msg) for rel, n, msg in public_tree.problems_in(self.repo, files)]

    def assert_reports(self, files, expected):
        found = [msg for _, _, msg in self.messages(files)]
        self.assertTrue(any(expected in msg for msg in found), f"{expected!r} not in {found}")

    def test_clean_files_pass(self):
        self.assertEqual(self.messages({"README.md": "# Probanda\n\nThe facts are stored on your machine.\n",
                                        "LICENSE": "terms\n",
                                        "plugins/lawyer/hooks/guard.py": "path = tool_input['file_path']\n"}), [])

    def test_table_name_in_prose_is_reported(self):
        self.assertEqual(self.messages({"a.md": "x\nEach link is a row in evidence_links.\n"}),
                         [("a.md", 2, "names a private schema identifier: evidence_links")])

    def test_column_name_is_reported_whatever_its_case(self):
        self.assert_reports({"a.md": "Set Source_Locator to the page.\n"}, "source_locator")

    def test_table_named_in_ddl_outside_a_sql_file_is_reported(self):
        self.assert_reports({"a.md": "See practice_anchors.\n"}, "practice_anchors")

    def test_column_of_a_ddl_statement_spread_over_lines_outside_sql_is_reported(self):
        self.assert_reports({"a.md": "Read last_trust_date.\n"}, "last_trust_date")
        self.assert_reports({"a.md": "Top up regular_trust.\n"}, "regular_trust")
        self.assertEqual(self.messages({"a.md": "See after_the_statement and ddl_comment_name.\n"}), [])

    def test_a_blank_line_ends_a_ddl_statement_left_open(self):
        self.assert_reports({"a.md": "See helper_view.\n"}, "helper_view")
        self.assertEqual(self.messages({"a.md": "A prose_after_blank here.\n"}), [])

    def test_table_and_column_under_cloud_are_reported(self):
        self.assert_reports({"a.md": "See pooled_statements.\n"}, "pooled_statements")
        self.assert_reports({"a.md": "Read statement_text.\n"}, "statement_text")

    def test_identifier_on_a_non_ddl_line_outside_sql_is_not_a_fingerprint(self):
        self.assertEqual(self.messages({"a.md": "An unrelated_name here.\n"}), [])

    def test_identifier_in_a_sql_comment_is_not_a_fingerprint(self):
        self.assertEqual(self.messages({"a.md": "A comment_only_name here.\n"}), [])

    def test_one_word_table_counts_only_behind_its_database_qualifier(self):
        self.assertEqual(self.messages({"a.md": "The facts are yours. See self.facts too.\n"}), [])
        self.assert_reports({"a.md": "Read main.facts.\n"}, "main.facts")

    def test_rules_map_marker_is_reported(self):
        self.assert_reports({"a.md": '<!-- node id=draft title="x" -->\n'}, "rules-map marker")
        self.assert_reports({"a.md": "<!-- edge to=draft/enter weight=0 -->\n"}, "rules-map marker")

    def test_copy_of_a_private_file_is_reported(self):
        self.assert_reports({"skill.md": PRIVATE["source/skills/data/SKILL.md"]}, "copy of a private source file")

    def test_long_line_repeated_from_a_private_file_is_reported(self):
        self.assert_reports({"a.md": f"intro\n  {LONG_PRIVATE_LINE}\n"}, "repeats a line of a private source file")

    def test_short_shared_line_is_not_reported(self):
        self.assertEqual(self.messages({"a.md": "Short line.\n"}), [])

    def test_third_party_code_is_not_a_fingerprint(self):
        self.assertEqual(self.messages({"a.js": PRIVATE["source/skills/data/node_modules/lib/index.js"]}), [])

    def test_shared_manifest_lines_may_repeat(self):
        self.assertEqual(self.messages({"plugins/lawyer/.claude-plugin/plugin.json":
                                        '{\n  "name": "probanda",\n'
                                        '  "description": "A litigation practice plugin for British Columbia lawyers and their staff."\n}\n'}), [])

    def test_matter_code_is_reported(self):
        self.assert_reports({"a.md": f"As in {MATTER_CODE}.\n"}, "matter code")

    def test_file_type_off_the_allowlist_is_reported(self):
        self.assert_reports({"form.pdf": "x"}, "not on the public allowlist")
        self.assert_reports({"NOTICE": "x"}, "not on the public allowlist")

    def test_crlf_and_non_utf8_are_reported(self):
        self.assert_reports({"a.md": b"one\r\ntwo\r\n"}, "CRLF")
        self.assert_reports({"a.md": b"\xff\xfe\x00bad"}, "not UTF-8")

    def test_publish_scan_problems_are_reported(self):
        self.assert_reports({"a.md": f"{CREATE} t (id)\n"}, "schema DDL")
        self.assert_reports({"plugins/probanda/.claude-plugin/plugin.json": '{"name": "other"}'}, "pinned list")

    def test_plugin_folder_outside_the_public_plugins_is_reported(self):
        self.assert_reports({"plugins/developer/skills/x/SKILL.md": "x\n"}, "not a public plugin")

    def test_marketplace_entry_outside_the_public_plugins_is_reported(self):
        marketplace = json.dumps({"name": "Probanda_Legal", "plugins": [
            {"name": "lawyer", "source": "./plugins/lawyer"}, {"name": "developer", "source": "./plugins/developer"}]})
        self.assert_reports({".claude-plugin/marketplace.json": marketplace}, "lists a plugin that is not public: developer")

    def test_developer_skill_or_agent_under_a_public_plugin_is_reported(self):
        fake_repo.write_assignment(self.repo, {
            "lawyer": {"skills": ["other"]},
            "developer": {"skills": ["view-suggestions"], "agents": ["black-hat"]}})
        (self.repo / "source" / "developer").mkdir()
        self.assert_reports({"plugins/lawyer/skills/view-suggestions/SKILL.md": "x\n"}, "developer-only, never public")
        self.assert_reports({"plugins/lawyer/agents/black-hat.md": "x\n"}, "developer-only, never public")
        self.assertEqual(self.messages({"plugins/lawyer/skills/other/SKILL.md": "x\n"}), [])

    def write_assignment(self, plugins):
        fake_repo.write_assignment(self.repo, {name: {"skills": skills} for name, skills in plugins.items()})
        for name in plugins:
            (self.repo / "source" / name).mkdir(exist_ok=True)

    def test_public_skill_under_another_plugins_folder_is_reported_once(self):
        self.write_assignment({"lawyer": ["dyu"], "researcher": ["legal-citation"]})
        found = self.messages({"plugins/lawyer/skills/legal-citation/SKILL.md": "x\n",
                               "plugins/lawyer/skills/legal-citation/references/a.md": "x\n"})
        self.assertEqual(found, [("plugins/lawyer/skills/legal-citation", 1,
                                  "legal-citation is assigned to researcher, not lawyer")])

    def test_public_skill_in_no_plugin_is_reported(self):
        self.write_assignment({"lawyer": ["dyu"]})
        self.assert_reports({"plugins/lawyer/skills/stray/SKILL.md": "x\n"},
                            "stray is not in source/assignment.json")

    def test_public_skill_under_its_own_plugin_passes(self):
        self.write_assignment({"lawyer": ["dyu"], "researcher": ["legal-citation"]})
        self.assertEqual(self.messages({"plugins/lawyer/skills/dyu/SKILL.md": "x\n",
                                        "plugins/researcher/skills/legal-citation/SKILL.md": "x\n"}), [])

    def test_missing_private_folder_stops_the_check(self):
        (self.repo / "cloud" / "pool" / "schema.sql").unlink()
        (self.repo / "cloud" / "pool").rmdir()
        (self.repo / "cloud").rmdir()
        with self.assertRaises(SystemExit) as stopped:
            self.messages({"a.md": "x\n"})
        self.assertIn("cloud/ is missing", str(stopped.exception.code))

    def test_missing_assignment_file_stops_the_check(self):
        fake_repo.write_assignment(self.repo, omit=True)
        with self.assertRaises(SystemExit):
            self.messages({"a.md": "x\n"})

    def test_the_server_source_is_read_from_each_plugin_folder(self):
        fake_repo.write_assignment(self.repo, {"practice": {"servers": ["data"]}, "research": {}})
        (self.repo / "source" / "lawyer").rename(self.repo / "source" / "practice")
        with self.assertRaises(SystemExit) as stopped:
            self.messages({"a.md": "x\n"})
        self.assertIn("source/research/ is missing", str(stopped.exception.code))
        (self.repo / "source" / "research").mkdir()
        self.assert_reports({"a.md": "See practice_anchors.\n"}, "practice_anchors")
        self.assertEqual(self.messages({"plugins/lawyer/.claude-plugin/plugin.json":
                                        '{\n  "name": "practice",\n'
                                        '  "description": "A litigation practice plugin for British Columbia lawyers and their staff."\n}\n'}), [])

    def hook_messages(self, files):
        files = {rel: data if isinstance(data, bytes) else data.encode("utf-8") for rel, data in files.items()}
        return [msg for _, _, msg in public_tree.problems_in(self.repo, files, hook=True)]

    def test_generic_names_and_licence_pass_everywhere(self):
        cases = {"a.md": "Each record carries a created_at timestamp.\n",
                 "b.md": "Aggregate with group_concat. Read the style_of_cause field.\n",
                 "LICENSE": f"MIT License\n\n{MIT_LINE}\n"}
        for rel, data in cases.items():
            self.assertEqual(self.hook_messages({rel: data}), [], rel)
            self.assertEqual(self.messages({rel: data}), [], rel)

    def test_formats_pass_at_write_time_only(self):
        cases = {"c.md": b"one\r\ntwo\r\n",
                 "plugins/lawyer/hooks/run.sh": "#!/bin/sh\necho ok",
                 "plugins/lawyer/icon.svg": "<svg/>",
                 "CHANGELOG.md": "## Short"}
        for rel, data in cases.items():
            self.assertEqual(self.hook_messages({rel: data}), [], rel)
            self.assertNotEqual(self.messages({rel: data}), [], f"full-tree check must still report {rel}")

    def test_at_write_time_private_names_and_secrets_are_still_reported(self):
        for text, expected in [("Read style_of_cause_or_title.\n", "style_of_cause_or_title"),
                               ("Each link is a row in evidence_links.\n", "evidence_links"),
                               (f"intro\n  {LONG_PRIVATE_LINE}\n", "repeats a line"),
                               (f"As in {MATTER_CODE}.\n", "matter code"),
                               ('<!-- node id=draft title="x" -->\n', "rules-map marker"),
                               (f"{CREATE} t (id)\n", "schema DDL")]:
            found = self.hook_messages({"a.md": text})
            self.assertTrue(any(expected in msg for msg in found), f"{expected!r} not in {found}")
        self.assertTrue(any("copy of a private source file" in msg
                            for msg in self.hook_messages({"skill.md": PRIVATE["source/skills/data/SKILL.md"]})))

    def test_public_files_reads_only_public(self):
        (self.repo / "public" / "sub").mkdir(parents=True)
        (self.repo / "public" / "sub" / "a.md").write_text("x")
        self.assertEqual(sorted(public_tree.public_files(self.repo)), ["sub/a.md"])


class ApprovalDiffTest(unittest.TestCase):
    def test_reports_added_changed_and_removed(self):
        self.assertEqual(public_tree.approval_diff({"a": "1", "b": "2", "c": "3"}, {"a": "1", "b": "9", "d": "4"}),
                         ["added: c", "changed: b", "removed: d"])

    def test_matching_lists_have_no_diff(self):
        self.assertEqual(public_tree.approval_diff({"a": "1"}, {"a": "1"}), [])


class PendingFileTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name).resolve()
        (self.repo / "public").mkdir()
        (self.repo / "public" / "a.md").write_bytes(b"one two one\n")

    def pending(self, tool_input, tool_name="Edit"):
        return public_tree.pending_file(self.repo, {"tool_name": tool_name, "tool_input": tool_input, "cwd": str(self.repo)})

    def test_write_gives_the_new_content(self):
        self.assertEqual(self.pending({"file_path": str(self.repo / "public" / "new.md"), "content": "x\n"}, "Write"),
                         ("new.md", b"x\n"))

    def test_edit_gives_the_file_after_the_replacement(self):
        path = str(self.repo / "public" / "a.md")
        self.assertEqual(self.pending({"file_path": path, "old_string": "one", "new_string": "1"}), ("a.md", b"1 two one\n"))
        self.assertEqual(self.pending({"file_path": path, "old_string": "one", "new_string": "1", "replace_all": True}),
                         ("a.md", b"1 two 1\n"))

    def test_several_edits_apply_in_order(self):
        edits = [{"old_string": "one", "new_string": "two"}, {"old_string": "two two", "new_string": "x"}]
        self.assertEqual(self.pending({"file_path": str(self.repo / "public" / "a.md"), "edits": edits}), ("a.md", b"x one\n"))

    def test_relative_path_resolves_against_the_working_directory(self):
        self.assertEqual(self.pending({"file_path": "public/b.md", "content": "y"}, "Write"), ("b.md", b"y"))

    def test_file_outside_public_is_ignored(self):
        self.assertIsNone(self.pending({"file_path": str(self.repo / "scripts" / "a.py"), "content": "x"}, "Write"))
        self.assertIsNone(self.pending({"file_path": str(self.repo / "public-notes.md"), "content": "x"}, "Write"))

    def test_change_it_cannot_work_out_is_an_error(self):
        with self.assertRaises(ValueError):
            self.pending({"notebook_path": str(self.repo / "public" / "n.ipynb"), "new_source": "x"}, "NotebookEdit")


if __name__ == "__main__":
    unittest.main()
