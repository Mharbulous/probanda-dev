"""Regression lock for the legislation-currency `repealed` rule (#1631).

CanLII returns `repealed: "NO"` and `endDate: ""` for an instrument in force. The
playbook's step 5 once read both as repeal, so an in-force regulation came back
`repealed`. The rule is prose that research-paralegal applies, so this test reads
the rule's parts out of the playbook, builds the predicate they state, and runs
CanLII's values through it. Rewording the rule fails here until the test is
re-pinned to the new wording.
"""
import re
import unittest
from pathlib import Path


PLAYBOOK = Path(__file__).resolve().parents[2] / "shared" / "research-paralegal" / "legislation-currency.md"
RULE = re.compile(
    r'the metadata\'s `repealed` field is present, non-empty and not "(?P<token>[^"]+)" '
    r"\((?P<ci>case-insensitive)\), or its `endDate` is present(?P<end_non_empty> and non-empty)?\."
)


def repealed_bullet():
    text = " ".join(PLAYBOOK.read_text(encoding="utf-8").split())
    start = text.index("- `repealed` —")
    return text[start:text.index("- `archived` —", start)]


def rule_as_written():
    """The `repealed` predicate the playbook states, built from its own wording."""
    m = RULE.search(repealed_bullet())
    if m is None:
        raise AssertionError("the `repealed` rule no longer has the pinned shape: " + repealed_bullet())
    token, case_insensitive, end_non_empty = m["token"], bool(m["ci"]), bool(m["end_non_empty"])

    def repealed(meta):
        value, end = meta.get("repealed"), meta.get("endDate")
        same = (lambda a, b: a.lower() == b.lower()) if case_insensitive else (lambda a, b: a == b)
        by_field = value is not None and value != "" and not same(value, token)
        by_end = end is not None and (end != "" or not end_non_empty)
        return by_field or by_end

    return repealed


class RepealedRuleTests(unittest.TestCase):
    def test_canlii_no_is_not_repealed(self):
        repealed = rule_as_written()
        for value in ("NO", "No", "no"):
            with self.subTest(repealed=value):
                self.assertFalse(repealed({"repealed": value, "endDate": None}))

    def test_canlii_empty_end_date_is_not_repealed(self):
        repealed = rule_as_written()
        self.assertFalse(repealed({"repealed": None, "endDate": ""}))
        # The in-force record CanLII actually returned carries both values at once.
        self.assertFalse(repealed({"repealed": "NO", "endDate": ""}))

    def test_a_real_repeal_still_fires(self):
        repealed = rule_as_written()
        self.assertTrue(repealed({"repealed": "YES", "endDate": ""}))
        self.assertTrue(repealed({"repealed": "NO", "endDate": "2024-01-01"}))


if __name__ == "__main__":
    unittest.main()
