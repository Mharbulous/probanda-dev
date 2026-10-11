"""Regression lock for the persist rule's coverage and filename (#1440).

The gate can dispatch a superseding audit agent in place of research-agent. Its
return must be persisted under the same file stem, or the tier-3 prior-lead rule and
the locate-authority filter, which match the filename, miss it. No litigation file
may name the commons agent, so the rule names no agent in the filename.
"""
import unittest
from pathlib import Path


SHARED = Path(__file__).resolve().parents[2] / "shared"
ANY_AGENT = "the `research-agent` agent, or whichever law-audit agent the gate dispatched"
ANSWER = "`<File stem>.md`"
PRELIMINARY = "`<File stem> (preliminary).md`"
PRIOR_LEAD_NAMES = ("`* ML re *`", "`research-lawyer answer`", "`research-lawyer preliminary`")


def persist_rule():
    text = (SHARED / "legal-research.md").read_text(encoding="utf-8")
    start = text.index("**After the answer, the caller persists it.**")
    return " ".join(text[start:text.index("**Statute currency.**", start)].split())


def tier_three_rule():
    text = (SHARED / "legal-audit-protocol.md").read_text(encoding="utf-8")
    start = text.index("c. **Tier 3")
    return " ".join(text[start:text.index("d. **Tier 4", start)].split())


class PersistRuleTests(unittest.TestCase):
    def test_rule_covers_whichever_audit_agent_the_gate_dispatched(self):
        rule = persist_rule()
        self.assertIn(ANY_AGENT, rule)
        self.assertNotIn("Any research-lawyer return", rule)

    def test_rule_names_the_answer_and_preliminary_files_by_file_stem(self):
        rule = persist_rule()
        self.assertIn(ANSWER, rule)
        self.assertIn(PRELIMINARY, rule)

    def test_memo_and_legacy_answer_files_stay_prior_leads(self):
        rule = tier_three_rule()
        for name in PRIOR_LEAD_NAMES:
            self.assertIn(name, rule)


if __name__ == "__main__":
    unittest.main()
