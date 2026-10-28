import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILL = SKILL_ROOT / "SKILL.md"
REFERENCE = SKILL_ROOT / "references" / "overstatement.md"
LETTERS = SKILL_ROOT / "references" / "letters.md"
JOBS_STOCK = SKILL_ROOT.parent / "drafting-data" / "references" / "jobs-stock.md"
# Sections 12 and 13 of SKILL.md, and the section 14 announcements, live in these reference files.
SKILL_PARTS = (
    SKILL,
    SKILL_ROOT / "references" / "procedure.md",
    SKILL_ROOT / "references" / "substance-and-revise.md",
    SKILL_ROOT / "references" / "assemble-then-gate.md",
    SKILL_ROOT / "references" / "opening-announcements.md",
)

# Findings go to the Milestone as fixed-text jobs, never a report file (letter-passes spec §12).
FINDING_FIELDS = (
    "the assertion, the source and pinpoint, what the source says, the verdict",
    "a rewrite at the source's strength",
)

PASS_FINDING_TITLES = (
    "`Check a date or quotation against its source`",
    "`Decide a position our own correspondence contradicts`",
    "`Decide an overstatement finding`",
)

RETIRED_REPORT = (
    "overstatement review.md",
    "| Assertion | Source and pinpoint |",
)

VERDICTS = (
    "supported",
    "overstated",
    "understated",
    "unsupported",
    "stale",
    "misattributed",
    "not located",
)

# One synthetic case per failure shape the ticket names (#1001).
SYNTHETIC_CASES = (
    "Conditional deadline stated as fixed",
    "Adjournments described as repeated failures",
    "Provision scope widened",
    "Misattribution",
    "Stale absolute",
    # two-way strength review
    "Client's account softened",
    "Completeness claim wider than the source",
)

REFERENCE_RULES = (
    # every assertion class in scope
    "a document",
    "an order",
    "a court",
    "a date or deadline",
    "the other side",
    "a quoted statute, rule or regulation",
    # source discipline
    "A summary, a note or an earlier draft is not a source.",
    "checked against that Writing's own source",
    # a mailbox-only email is cited resolvably, not read as a source (#1298)
    "not located until ingested: cite sender, date and Message-ID",
    # provision wording only; legal effect goes to the gate
    "compare the draft's words with the provision's words only",
    "`/legal-research`",
    # never edits, practitioner decides
    "The review never edits substance.",
    "ask for it",
    # both directions; an understated rewrite stops at the source
    "in both directions",
    "Check omission on the same point",
    "completeness claims included",
    "up to the source's own words and no further",
)

SKILL_RULES = (
    # section 13 (assemble-then-gate.md), section 12 (substance-and-revise.md), section 14 announcement, section 15 table
    "noting-up sweep, the overstatement review",
    "decision form per new flagged finding",
    "noting-up sweep, overstatement review and evidence-concerns pass",
    "| `references/overstatement.md` |",
)


class OverstatementReviewContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = REFERENCE.read_text(encoding="utf-8")
        cls.skill = "\n".join(p.read_text(encoding="utf-8") for p in SKILL_PARTS)

    def test_reference_carries_finding_fields(self):
        for token in FINDING_FIELDS:
            with self.subTest(token=token):
                self.assertIn(token, self.reference)

    def test_findings_go_to_the_board_not_a_report(self):
        self.assertIn("It writes no report", self.reference)
        self.assertIn("`/drafting-data` §3g", self.reference)
        for token in RETIRED_REPORT:
            with self.subTest(token=token):
                self.assertNotIn(token, self.reference)

    def test_each_pass_has_a_fixed_title(self):
        stock = JOBS_STOCK.read_text(encoding="utf-8")
        self.assertIn("## 3g. Pass finding jobs", stock)
        for title in PASS_FINDING_TITLES:
            with self.subTest(title=title):
                self.assertIn(title, stock)

    def test_letters_emit_to_the_board(self):
        letters = LETTERS.read_text(encoding="utf-8")
        self.assertIn("**Findings go to the Milestone, never into the letter or beside it.**", letters)
        self.assertIn("`position-conflict`", letters)
        self.assertNotIn("Pass 5's table", letters)

    def test_reference_names_every_verdict(self):
        for verdict in VERDICTS:
            with self.subTest(verdict=verdict):
                self.assertIn(f"**{verdict}**", self.reference)

    def test_reference_carries_synthetic_cases(self):
        for case in SYNTHETIC_CASES:
            with self.subTest(case=case):
                self.assertIn(case, self.reference)

    def test_reference_carries_rules(self):
        for token in REFERENCE_RULES:
            with self.subTest(token=token):
                self.assertIn(token, self.reference)

    def test_skill_wires_the_review(self):
        for token in SKILL_RULES:
            with self.subTest(token=token):
                self.assertIn(token, self.skill)


if __name__ == "__main__":
    unittest.main()
