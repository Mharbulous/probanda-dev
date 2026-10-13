#!/usr/bin/env python3
"""
recital-rule-mirror, ported from CoClerk's plugin-packager tests/test_recital_rule_mirror.py.

The grammatical-voice rule in shared/authority-claim-verification.md §3 is copied
inline into every prompt that judges whose reasons a passage is, and each copy must
match the source block exactly. Each case builds a throwaway tree; the last reads
the real repo.

Run: python -m pytest -q scripts/tests/test_check_recital_rule.py
"""

import importlib.util
import os
import tempfile
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_plugin", os.path.join(SCRIPTS, "check_plugin.py"))
check_plugin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_plugin)

BLOCK = ("<!-- recital-rule: begin. Source: x. -->\n"
         "**Whose reasons are they?** Support comes only from the court's own reasons.\n"
         "<!-- recital-rule: end -->")


class RecitalRuleMirrorTest(unittest.TestCase):
    def violations(self, source, mirrors, newline="\n"):
        with tempfile.TemporaryDirectory() as tmp:
            for name, text in {"source.md": source, **mirrors}.items():
                with open(os.path.join(tmp, name), "w", encoding="utf-8", newline=newline) as f:
                    f.write(text)
            return check_plugin.recital_rule_mirror_violations(tmp, "source.md", tuple(mirrors))

    def test_identical_copies_pass(self):
        self.assertEqual(self.violations(f"# S\n\n{BLOCK}\n", {
            "a.md": f"# A\n\nlead-in\n\n{BLOCK}\n\ntail\n",
            "b.md": f"{BLOCK}\n",
        }), [])

    def test_crlf_copy_passes(self):
        self.assertEqual(self.violations(f"{BLOCK}\n", {"a.md": f"x\n{BLOCK}\n"}, newline="\r\n"), [])

    def test_one_copy_edited_alone_fails(self):
        hits = self.violations(f"{BLOCK}\n", {
            "a.md": f"{BLOCK}\n",
            "b.md": BLOCK.replace("own reasons", "own reasons, never a quoted authority") + "\n",
        })
        self.assertEqual(hits, ["b.md: block differs from source.md"])

    def test_copy_without_block_fails(self):
        hits = self.violations(f"{BLOCK}\n", {"a.md": "Support must come from the court's own reasons.\n"})
        self.assertEqual(hits, ["a.md: expected 1 recital-rule block, found 0"])

    def test_missing_mirror_file_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "source.md"), "w", encoding="utf-8") as f:
                f.write(BLOCK)
            hits = check_plugin.recital_rule_mirror_violations(tmp, "source.md", ("gone.md",))
        self.assertEqual(hits, ["gone.md: file missing"])

    def test_source_without_block_fails(self):
        hits = self.violations("no block\n", {"a.md": f"{BLOCK}\n"})
        self.assertEqual(hits, ["source.md: expected 1 recital-rule block, found 0"])

    AGENTS = ("verify-claim", "verify-edges", "extract-caselaw", "verify-caselaw")

    def test_the_single_plugin_checks_every_mirror_in_its_own_agent_sources(self):
        plugin = {"name": "probanda", "source": "source/probanda", "skills": None, "agents": None}
        mirrors = check_plugin.recital_rule_mirrors(plugin)
        self.assertEqual([m for m in mirrors if not m.startswith(".claude/")],
                         [f"source/probanda/agents/{n}.md" for n in self.AGENTS])
        self.assertEqual([m for m in mirrors if m.startswith(".claude/")],
                         [f".claude/skills/{rel}" for rel in check_plugin.RECITAL_RULE_SKILL_MIRRORS])

    def test_a_plugin_checks_only_the_mirrors_it_ships_and_always_the_shared_one(self):
        plugin = {"name": "research", "source": "source/research", "skills": ["verify-law"], "agents": ["verify-claim"]}
        self.assertEqual(check_plugin.recital_rule_mirrors(plugin),
                         (".claude/skills/shared/legal-audit-protocol.md",
                          ".claude/skills/verify-law/agents/verify-claim.md",
                          "source/research/agents/verify-claim.md"))

    def test_real_repo_copies_match(self):
        for plugin in check_plugin.built_plugins(check_plugin.REPO).values():
            with self.subTest(plugin=plugin["name"]):
                self.assertEqual(check_plugin.recital_rule_mirror_violations(
                    check_plugin.REPO, check_plugin.RECITAL_RULE_SOURCE, check_plugin.recital_rule_mirrors(plugin)), [])


if __name__ == "__main__":
    unittest.main()
