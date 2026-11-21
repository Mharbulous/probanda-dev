"""Pins the gate's per-authority review: in the same batch as memo-reviewer, the gate groups the
memo's numbered items by `Citation:` and spawns one authority-checker per cited case, folds each
checker item not `ok` into memo-reviewer's `findings`, and counts the batch as one of the three
reviews. An inferred item has its own `Citation:`, so it joins its case's group. The synthetic memo
below is written in the template's item shape and grouped by the doctrine's rule.

Spec: docs/Specs/2026-11-20_memo-gate-per-authority-review-spec.md

Run: python source/skills/legal-research/tests/test_authority_review_round.py
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
SKILLS = REPO / "source" / "skills"

# SYNTHETIC TEST FIXTURE: two cases (one cited three times, once by an inferred item) and a statute.
MEMO = """## Rule
1. A promise is binding when given for value.
   Authority: Alpha v. Beta
   Citation: 2001 ZZSC 1
   Kind: case, primary
   Pinpoint: para 4
   > [4] Whole paragraph four.
2. A promise is binding when made under seal.
   Authority: Gamma v. Delta
   Citation: 2002 ZZCA 2
   Kind: case, primary
   Pinpoint: para 9
   > [9] Whole paragraph nine.
3. A promise must be in writing.
   Authority: Promises Act
   Citation: RSZZ 1999, c 1, s 3
   Kind: statute, primary
   Pinpoint: s 3
   > 3 Whole section three.
4. inferred: Value need not be adequate.
   Authority: Alpha v. Beta
   Citation: 2001 ZZSC 1
   Kind: case, primary
   Pinpoint: para 12
   > [12] Whole paragraph twelve.
## Application
5. fact: The promisee paid one coin.
   Authority: Alpha v. Beta
   Citation: 2001 ZZSC 1
   Kind: case, primary
   Pinpoint: para 11
   > [11] Whole paragraph eleven.
"""


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


def checker_dispatches(memo):
    """The doctrine's rule: group the numbered items by `Citation:`, one checker per citation of `Kind: case`."""
    groups = {}
    for number, body in re.findall(r"^(\d+)\. (.*?)(?=^\d+\. |^## |\Z)", memo, re.M | re.S):
        citation = re.search(r"^\s*Citation: (.+)$", body, re.M).group(1)
        if re.search(r"^\s*Kind: case,", body, re.M):
            groups.setdefault(citation, []).append(f"¶{number}")
    return groups


class GroupingTest(unittest.TestCase):
    def test_one_dispatch_per_distinct_case(self):
        groups = checker_dispatches(MEMO)
        self.assertEqual(list(groups), ["2001 ZZSC 1", "2002 ZZCA 2"])

    def test_items_citing_the_same_case_go_to_one_checker_with_the_inferred_item(self):
        groups = checker_dispatches(MEMO)
        self.assertEqual(groups["2001 ZZSC 1"], ["¶1", "¶4", "¶5"])
        self.assertNotIn("RSZZ 1999, c 1, s 3", groups)

    def test_every_template_item_carries_the_lines_grouping_reads(self):
        shape = between(read("shared", "research-memo-template.md"), "<n>. <one sentence", "```")
        self.assertIn("Citation: <citation>", shape)
        self.assertIn("Kind: <case / statute / regulation / rule / doctrine>", shape)
        self.assertNotIn("From:", read("shared", "research-memo-template.md"))


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


class DoctrineTest(unittest.TestCase):
    def setUp(self):
        self.text = read("shared", "legal-research.md")
        self.rule = flat(between(self.text, "**memo-reviewer checks every memo before it is saved.**",
                                 "Persist in this order."))

    def test_dispatch_and_grouping(self):
        self.assertIn("In the same parallel batch, read the memo's numbered items, group them by `Citation:`, and "
                      "spawn one `researcher:authority-checker` per citation of `Kind: case`", self.rule)
        self.assertIn("`Items:` each item citing it (`¶<n>`, section, sentence with its tag, pinpoint, excerpt)",
                      self.rule)
        self.assertNotIn("From:", self.rule)

    def test_missing_or_unreadable_decision_is_a_download(self):
        self.assertIn("A decision not on disk, or a checker's `unreadable`, is a `needs_download` run by the rule "
                      "above.", self.rule)

    def test_the_batch_is_one_of_three_reviews(self):
        self.assertIn("The batch is one review. It reviews one question at most three times.", self.rule)
        self.assertIn("Run the review again on each new return.", self.rule)
        self.assertIn("When the third review accepts nothing, re-invoke the agent once with it to write the memo "
                      "`INCOMPLETE`", self.rule)

    def test_union_send_back(self):
        self.assertIn("Add each checker item not `ok` to the reviewer's `findings` as `¶<n>: <why>`, with `file it as "
                      "<belongs_in>` or `restate it from the court's words at <pinpoint>` where given, and make the "
                      "reviewer's `verdict` `send_back` if any checker's is.", self.rule)
        self.assertIn("rewrite each as one proposition or finding, or cut the item", self.rule)
        self.assertIn("`rules unavailable` included, saves nothing: stop", self.rule)

    def test_relay_is_one_line_per_review(self):
        self.assertIn("Of the checkers the practitioner hears only `<n> authorities checked, <m> sent back`, once per "
                      "review.", self.rule)

    def test_no_held_job_step_for_the_checkers(self):
        held = between(self.text, "**On a held job, an open tier is not an answer.**",
                       "**memo-reviewer checks every memo before it is saved.**")
        self.assertNotIn("authority-checker", held)
        self.assertEqual(self.text.count("authority-checker"), 1)

    def test_front_door_points_and_restates_nothing(self):
        step_five = flat(between(read("legal-research", "SKILL.md"), "5. A return carrying", "If step 1's read fails"))
        self.assertIn("Then have `researcher:memo-reviewer` and one `researcher:authority-checker` per cited case "
                      "check the memo", step_five)
        self.assertIn('"memo-reviewer checks every memo before it is saved"', step_five)
        for detail in ("Citation:", "Kind: case", "findings", "unreadable", "authorities checked"):
            self.assertNotIn(detail, step_five)


if __name__ == "__main__":
    unittest.main()
