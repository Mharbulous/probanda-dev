"""Regression lock for the two-layer statements-of-law rule (2026-10-21).

Every session outside the research-agent carries one simple rule: no statement or
opinion of law unless framed explicitly as a hunch, otherwise an offer to invoke the
research-agent. The research-agent's own definition carries the full rule, read only
when it runs: the same hunch exception, and "show, don't tell" for any reliable
statement, meaning a summary of one sentence at most followed at once by the verbatim
text it rests on.
"""
import unittest
from pathlib import Path


SKILLS = Path(__file__).resolve().parents[2]
REPO = SKILLS.parents[1]
SIMPLE_RULE = (
    "Never make a statement or give an opinion about the law; instead, frame your "
    "statement explicitly as a hunch or offer to invoke the research-agent."
)


def flat(path):
    return " ".join(path.read_text(encoding="utf-8").split())


class StatementsOfLawRuleTests(unittest.TestCase):
    def test_doctrine_states_the_simple_rule(self):
        doctrine = flat(SKILLS / "shared" / "legal-research.md")
        self.assertIn(SIMPLE_RULE, doctrine)
        self.assertIn("A hunch is never cited, built into work product or used to settle a decision.", doctrine)

    def test_recommendation_exception_is_gone(self):
        doctrine = flat(SKILLS / "shared" / "legal-research.md")
        self.assertNotIn("labelled hunch or recommendation", doctrine)

    def test_research_agent_definition_holds_the_full_rule(self):
        agent = flat(REPO / "source" / "researcher" / "agents" / "research-agent.md")
        self.assertIn("## Statements of law", agent)
        self.assertIn("framed explicitly as a hunch", agent)
        self.assertIn("one sentence at most", agent)
        self.assertIn("verbatim", agent)

    def test_memo_body_shows_the_verbatim_text(self):
        protocol = flat(SKILLS / "shared" / "legal-audit-protocol.md")
        self.assertIn("followed at once by the verbatim passage at its pinpoint", protocol)


if __name__ == "__main__":
    unittest.main()
