"""Regression lock for the legislation-currency citation match (#1632).

CanLII lists the Supreme Court Civil Rules as "BC Reg 168/2009" while callers
store "B.C. Reg. 168/2009". The playbook's step 3 once compared citations so
that the two did not match, and an in-force regulation came back `not-found`.
The rule is prose that research-paralegal applies, so this test reads what the
match ignores out of the playbook, builds the predicate it states, and runs
citations through it. Rewording the rule fails here until the test is re-pinned
to the new wording.
"""
import re
import unittest
from pathlib import Path


PLAYBOOK = Path(__file__).resolve().parents[2] / "shared" / "research-paralegal" / "legislation-currency.md"
RULE = re.compile(
    r"An item \*\*matches\*\* when its `citation` equals the caller's `citation`, "
    r"ignoring only (?P<ignored>[^,]+), with runs of whitespace collapsed\."
)


def match_rule_as_written():
    """The citation-match predicate the playbook states, built from its own wording."""
    text = " ".join(PLAYBOOK.read_text(encoding="utf-8").split())
    m = RULE.search(text)
    if m is None:
        raise AssertionError("the citation-match rule no longer has the pinned shape")
    ignored = m["ignored"]
    strip_periods, fold_case = "periods" in ignored, "case" in ignored

    def normalise(citation):
        if strip_periods:
            citation = citation.replace(".", "")
        if fold_case:
            citation = citation.casefold()
        return " ".join(citation.split())

    def matches(item_citation, caller_citation):
        return normalise(item_citation) == normalise(caller_citation)

    return matches


class CitationMatchTests(unittest.TestCase):
    def test_periods_do_not_block_a_match(self):
        matches = match_rule_as_written()
        self.assertTrue(matches("BC Reg 168/2009", "B.C. Reg. 168/2009"))
        self.assertTrue(matches("B.C. Reg. 168/2009", "BC Reg 168/2009"))

    def test_a_different_number_does_not_match(self):
        matches = match_rule_as_written()
        self.assertFalse(matches("BC Reg 168/2009", "B.C. Reg. 68/2009"))

    def test_case_and_whitespace_do_not_block_a_match(self):
        matches = match_rule_as_written()
        self.assertTrue(matches("BC Reg 168/2009", "b.c. reg.  168/2009"))


if __name__ == "__main__":
    unittest.main()
