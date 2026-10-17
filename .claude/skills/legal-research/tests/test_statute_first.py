"""Regression locks for the statute-first route (spec 2026-10-06, statute-first research route).

A statutory-text question runs duty 4 (legislation) before duty 3 (Westlaw), without
renumbering the duties. An instrument the fetcher files nothing for falls back to a
case-data copy. The audit protocol answers a negative statutory proposition only with a
whole-instrument search on record, and the audit agent holds the search tool.
"""
import re
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = SKILL_ROOT.parent
REPO_ROOT = SKILLS_ROOT.parents[1]
GATE = SKILLS_ROOT / "shared" / "legal-research.md"
SKILL = SKILL_ROOT / "SKILL.md"
PROTOCOL = SKILLS_ROOT / "shared" / "legal-audit-protocol.md"
CASE_DATA = SKILLS_ROOT / "case-data" / "SKILL.md"
SCHEMA_GEN = REPO_ROOT / "source" / "practice" / "mcp" / "src" / "schema-gen.ts"
AUDIT_AGENT = REPO_ROOT / "source" / "researcher" / "agents" / "research-agent.md"
TOOL = "research_filing__legislation_search"
ORDER_RULE = "**A statutory-text question runs duty 4 before duty 3.**"


def flat(path):
    return " ".join(path.read_text(encoding="utf-8").split())


class GateTests(unittest.TestCase):
    def setUp(self):
        self.raw = GATE.read_text(encoding="utf-8")
        self.text = flat(GATE)

    def test_order_rule_sits_above_the_duties_which_keep_their_numbers(self):
        rule = self.text.index(ORDER_RULE)
        self.assertLess(self.text.index("Four duties fall"), rule)
        self.assertLess(rule, self.text.index("1. **Tier 2"))
        self.assertRegex(self.raw, r"(?m)^3\. \*\*Tier 4, Westlaw")
        self.assertRegex(self.raw, r"(?m)^4\. \*\*Legislation text")
        section = self.text[rule:self.text.index("1. **Tier 2")]
        for phrase in (
            "names a statute, regulation or bylaw and asks what that instrument provides, requires, permits or lacks",
            "run duty 4 first",
            "telling `westlaw-query-optimizer` that the instrument's text is on file",
            "for each `legislation_skipped` title not yet on disk",
            "never yours to infer",
            "Every other question runs the duties in their numbered order.",
        ):
            self.assertIn(phrase, section)

    def test_duty_four_names_the_exception_and_the_case_data_fallback(self):
        duty = self.text[self.text.index("4. **Legislation text"):self.text.index("**Westlaw unreachable is a hard stop.**")]
        self.assertIn("After the Westlaw duty (before it, for a statutory-text question)", duty)
        fallback = duty[duty.index("**A case-data copy, when nothing was filed.**"):]
        for phrase in (
            "ask `/case-data` (query: which held authority carries this instrument's full text)",
            "its bundled page range",
            "`official: false`, whatever its source",
            "Only with no copy is the instrument unread.",
        ):
            self.assertIn(phrase, fallback)
        self.assertIn("or from the case-data copy used in its place", duty)

    def test_template_legislation_line_offers_the_case_data_form(self):
        line = next(l for l in self.raw.splitlines() if l.startswith("Legislation: <citation>"))
        self.assertTrue(
            line.endswith("/ on disk from case data <path>[, pp. <X–Y>], official: false, currency <value>")
        )

    def test_skill_step_three_carries_the_exception(self):
        text = flat(SKILL)
        step = text[text.index("3. Run Westlaw before the audit"):text.index("4. Spawn `research-agent`")]
        self.assertIn("ask `/case-data` for a held copy before marking it unread", step)
        self.assertIn("runs duty 4 first and Westlaw after it", step)

    def test_case_data_routes_the_lookup(self):
        self.assertIn("`@query_30_instrument_text_source`", flat(CASE_DATA))


class AuditTests(unittest.TestCase):
    def test_protocol_rule_precedes_step_three(self):
        text = flat(PROTOCOL)
        start = text.index("**A negative statutory proposition needs a search on record.**")
        self.assertLess(start, text.index("### Step 3"))
        rule = text[start:text.index("**`needs_download` — return at once.**")]
        for phrase in (
            f"`{TOOL}`",
            "under a `Searches` heading",
            "`search: <path> : terms <the terms, and the regex> : sections <first>–<last> (<count>)"
            "[; block <n> <first>–<last> (<count>)] : hits <sections, or none>`",
            "**unconfirmed negative**",
            "`full-text search of <instrument>, ss. <first>–<last>, for <terms>: no section`",
            "never searched or inferred here",
        ):
            self.assertIn(phrase, rule)

    def test_the_audit_agent_holds_the_tool_under_both_names(self):
        text = AUDIT_AGENT.read_text(encoding="utf-8")
        self.assertIn(f"  - mcp__plugin_practice_data__{TOOL}\n", text)
        self.assertIn(f"  - mcp__remote-devices__plugin_practice_data__{TOOL}\n", text)

    def test_runtime_defines_the_tool(self):
        self.assertRegex(SCHEMA_GEN.read_text(encoding="utf-8"), re.escape(f'name: "{TOOL}"'))


if __name__ == "__main__":
    unittest.main()
