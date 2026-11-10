"""The orchestrator's loaded text stays within its budget (ingest orchestrator spec 1.5).

SKILL.md plus the routing reference, which the skill reads once per run, is at most
80,000 characters (est.), about 20k tokens, so the main thread's per-turn input keeps
room for its document lines and Path B under the 100k ceiling.

Run: python .claude/skills/ingest-orchestrator/tests/test_loaded_budget.py
"""

from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1]
BUDGET = 80_000


class LoadedBudgetTests(unittest.TestCase):
    def test_skill_and_routing_reference_fit_the_budget(self):
        loaded = sum(len((SKILL / name).read_text(encoding="utf-8"))
                     for name in ("SKILL.md", "references/routing.md"))
        self.assertLessEqual(loaded, BUDGET)


if __name__ == "__main__":
    unittest.main()
