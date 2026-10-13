#!/usr/bin/env python3
"""
check_layering: an upward reference is found, a downward one is not, and a ruling settles it.

Run: python -m pytest -q scripts/tests/test_check_layering.py
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_layering", os.path.join(SCRIPTS, "check_layering.py"))
check_layering = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_layering)

PLUGINS = {
    "practice": {"requires": [], "skills": ["show-me"], "agents": ["docket-clerk"], "hooks": {}, "servers": ["data"]},
    "research": {"requires": ["practice"], "skills": ["legal-research"], "agents": [], "hooks": {},
                 "servers": ["commons"]},
    "litigator": {"requires": ["practice", "research"], "skills": ["case-data", "draft"], "agents": [],
                  "hooks": {}, "servers": []},
}


def make_repo(root, skills, agents=None, hooks=None):
    plugins = json.loads(json.dumps(PLUGINS))
    for plugin, mapping in (hooks or {}).items():
        plugins[plugin]["hooks"] = mapping
    (root / "source" / "probanda" / "agents").mkdir(parents=True)
    (root / "source" / "assignment.json").write_text(json.dumps({"plugins": plugins}), encoding="utf-8")
    for name, text in skills.items():
        path = root / ".claude" / "skills" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    for name, text in (agents or {}).items():
        (root / "source" / "probanda" / "agents" / f"{name}.md").write_text(text, encoding="utf-8")
    return plugins


class ScanTest(unittest.TestCase):
    def pairs(self, skills, **kwargs):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugins = make_repo(root, skills, **kwargs)
            return sorted({(f["file"], f["target"]) for f in check_layering.scan(root, plugins)
                           if f["plugin"] != "shared"})

    def test_upward_reference_is_found(self):
        self.assertEqual(self.pairs({"show-me/SKILL.md": "Ask `/case-data` first.\n"}),
                         [(".claude/skills/show-me/SKILL.md", "case-data")])

    def test_downward_reference_is_not(self):
        self.assertEqual(self.pairs({"draft/SKILL.md": "Present it with /show-me, after /legal-research.\n"}), [])

    def test_one_word_name_needs_a_mark(self):
        self.assertEqual(self.pairs({"show-me/SKILL.md": "Show the draft in full. The key `draft:2026` is not it.\n"}), [])
        self.assertEqual(self.pairs({"show-me/SKILL.md": "As `/draft` does.\n"}),
                         [(".claude/skills/show-me/SKILL.md", "draft")])

    def test_folder_named_for_a_skill_is_not_the_skill(self):
        self.assertEqual(self.pairs({"show-me/SKILL.md": "Save it in the case-data folder.\n"}), [])

    def test_tool_of_a_higher_plugin(self):
        self.assertEqual(
            self.pairs({"show-me/SKILL.md": "x\n"},
                       agents={"docket-clerk": "- mcp__plugin_probanda_data__case_data__query\n"
                                               "- mcp__plugin_probanda_commons__legal_commons__browse\n"
                                               "- mcp__plugin_probanda_data__skill_rules__applicable\n"}),
            [("source/probanda/agents/docket-clerk.md", "case_data__*"),
             ("source/probanda/agents/docket-clerk.md", "commons server")])

    def test_tests_folder_is_not_scanned(self):
        self.assertEqual(self.pairs({"show-me/tests/test_x.py": "# /case-data\n"}), [])

    def test_shared_is_reported_apart(self):
        self.assertEqual(self.pairs({"shared/x.md": "Ask `/case-data`.\n", "show-me/SKILL.md": "x\n"}), [])

    def test_hook_script_in_another_plugins_folder(self):
        found = self.pairs({"draft/hooks/gate.py": "pass\n", "show-me/SKILL.md": "x\n"},
                           hooks={"practice": {"gate": ".claude/skills/draft/hooks/gate.py"}})
        self.assertEqual(found, [(".claude/skills/draft/hooks/gate.py", "folder draft")])


class RulingTest(unittest.TestCase):
    def run_main(self, rulings, strict):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, {"show-me/SKILL.md": "Ask `/case-data` first.\n"})
            (root / "source" / "layering.json").write_text(json.dumps(rulings), encoding="utf-8")
            argv = ["check_layering.py", "--repo", str(root)] + ([] if strict else ["--report"])
            old, sys.argv = sys.argv, argv
            try:
                return check_layering.main()
            finally:
                sys.argv = old

    PAIR = {"file": ".claude/skills/show-me/SKILL.md", "target": "case-data"}

    def test_no_ruling_fails_both_modes(self):
        empty = {"allowed": [], "todo": []}
        self.assertEqual(self.run_main(empty, strict=True), 1)
        self.assertEqual(self.run_main(empty, strict=False), 1)

    def test_todo_passes_the_report_and_fails_strict(self):
        rulings = {"allowed": [], "todo": [self.PAIR]}
        self.assertEqual(self.run_main(rulings, strict=False), 0)
        self.assertEqual(self.run_main(rulings, strict=True), 1)

    def test_allowed_passes_strict(self):
        self.assertEqual(self.run_main({"allowed": [self.PAIR], "todo": []}, strict=True), 0)

    def test_stale_ruling_fails(self):
        stale = {"file": ".claude/skills/show-me/SKILL.md", "target": "draft"}
        self.assertEqual(self.run_main({"allowed": [self.PAIR, stale], "todo": []}, strict=True), 1)


if __name__ == "__main__":
    unittest.main()
