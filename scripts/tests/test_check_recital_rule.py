#!/usr/bin/env python3
"""
recital-rule-mirror, ported from CoClerk's plugin-packager tests/test_recital_rule_mirror.py.

The grammatical-voice rule in shared/authority-claim-verification.md §3 is copied
inline into every prompt that judges whose reasons a passage is, and each copy must
match the source block exactly. Each case builds a throwaway tree; the last reads
the real repo.

Run: python -m pytest -q scripts/tests/test_check_recital_rule.py
"""

import os
import sys
import tempfile
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import check_plugin_agents  # noqa: E402
import plugin_layout  # noqa: E402

BLOCK = ("<!-- recital-rule: begin. Source: x. -->\n"
         "**Whose reasons are they?** Support comes only from the court's own reasons.\n"
         "<!-- recital-rule: end -->")


class RecitalRuleMirrorTest(unittest.TestCase):
    def violations(self, source, mirrors, newline="\n"):
        with tempfile.TemporaryDirectory() as tmp:
            for name, text in {"source.md": source, **mirrors}.items():
                with open(os.path.join(tmp, name), "w", encoding="utf-8", newline=newline) as f:
                    f.write(text)
            return check_plugin_agents.recital_rule_mirror_violations(tmp, "source.md", tuple(mirrors))

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
            hits = check_plugin_agents.recital_rule_mirror_violations(tmp, "source.md", ("gone.md",))
        self.assertEqual(hits, ["gone.md: file missing"])

    def test_source_without_block_fails(self):
        hits = self.violations("no block\n", {"a.md": f"{BLOCK}\n"})
        self.assertEqual(hits, ["source.md: expected 1 recital-rule block, found 0"])

    AGENTS = ("verify-claim", "verify-edges", "extract-caselaw", "verify-caselaw")

    def test_a_plugin_that_ships_every_mirror_checks_each_in_its_own_agent_sources(self):
        skills = sorted({rel.split("/")[0] for rel in check_plugin_agents.RECITAL_RULE_SKILL_MIRRORS} - {"shared"})
        plugin = {"name": "litigator", "source": "source/litigator", "skills": skills, "agents": list(self.AGENTS)}
        mirrors = check_plugin_agents.recital_rule_mirrors(plugin)
        self.assertEqual([m for m in mirrors if not m.startswith("source/skills/")],
                         [f"source/litigator/agents/{n}.md" for n in self.AGENTS])
        self.assertEqual([m for m in mirrors if m.startswith("source/skills/")],
                         [f"source/skills/{rel}" for rel in check_plugin_agents.RECITAL_RULE_SKILL_MIRRORS])

    def test_a_plugin_checks_only_the_mirrors_it_ships_and_always_the_shared_one(self):
        plugin = {"name": "research", "source": "source/research", "skills": ["verify-law"], "agents": ["verify-claim"]}
        self.assertEqual(check_plugin_agents.recital_rule_mirrors(plugin),
                         ("source/skills/shared/legal-audit-protocol.md",
                          "source/skills/verify-law/agents/verify-claim.md",
                          "source/research/agents/verify-claim.md"))

    def test_real_repo_copies_match(self):
        for plugin in plugin_layout.plugins(plugin_layout.REPO).values():
            with self.subTest(plugin=plugin["name"]):
                self.assertEqual(check_plugin_agents.recital_rule_mirror_violations(
                    plugin_layout.REPO, check_plugin_agents.RECITAL_RULE_SOURCE, check_plugin_agents.recital_rule_mirrors(plugin)), [])


if __name__ == "__main__":
    unittest.main()
