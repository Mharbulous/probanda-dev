"""Pins a research job to one question: the gate's step 2a is a single-question scope check with
no plan spawn and no issue forms; the doctrine rewords a question holding more than one, never
splits it; a new question the practitioner raises gets exactly one two-option question; and the
end of the job invites no further memo.

Run: python -m pytest .claude/skills/legal-research/tests/test_one_question_scope.py -q
"""

import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
REPO = SKILLS.parents[1]


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def step_2a():
    text = read("legal-research", "SKILL.md")
    start = text.index("2a. Scope, before any search.")
    return flat(text[start:text.index("\n3. ", start)])


TWO_OPTIONS = ('"Do you want this investigated as an additional issue (a new research job), or are you '
               'changing the scope of this job?"')


class OneQuestionScopeTest(unittest.TestCase):
    def test_step_2a_is_a_scope_check(self):
        step = step_2a()
        self.assertIn('Check the question by the doctrine\'s "A research question holds one question".', step)
        self.assertIn("here or at any later step", step)
        self.assertIn("A held job's recorded question is already approved: ask nothing else.", step)
        for gone in ("mode: plan", "Yes, research it", "any other issues", "any more issues", "scope: new"):
            self.assertNotIn(gone, step)

    def test_no_plan_mode_or_issue_approval_anywhere(self):
        paths = [SKILLS / "legal-research" / "SKILL.md", SKILLS / "legal-research" / "references" / "research-board.md",
                 REPO / "source" / "researcher" / "agents" / "research-agent.md"]
        paths += [SKILLS / "shared" / name for name in ("legal-research.md", "legal-audit-scoped.md", "job-planning.md")]
        for path in paths:
            text = path.read_text(encoding="utf-8")
            for gone in ("mode: plan", "scope: new", "Approved plan issues", "further memo", "invitation line"):
                self.assertNotIn(gone, text, path.name)

    def test_a_question_is_reworded_never_split(self):
        rule = flat(read("shared", "legal-research.md"))
        rule = rule[rule.index("**A research question holds one question.**"):rule.index("**A new question is")]
        self.assertIn("A question that fails is never split or researched as it stands", rule)
        self.assertIn("propose one rewording narrowed to a single question", rule)
        self.assertIn('(`/drafting-data` §3m, "Rewording a held job")', rule)
        self.assertIn('a part that depends on the one before it ("If so, ...") stays with it', rule)
        self.assertIn("An unattended run reports and stops.", rule)

    def test_a_new_question_gets_one_two_option_question(self):
        text = flat(read("shared", "legal-research.md"))
        self.assertEqual(text.count(TWO_OPTIONS), 1)
        rule = text[text.index("**A new question is a new job or a new scope.**"):]
        rule = rule[:rule.index("**Before spawning")]
        self.assertIn("ask exactly one question: " + TWO_OPTIONS, rule)
        self.assertIn("write it as a research job by `/drafting-data` §3l", rule)
        self.assertIn("Offer no third path.", rule)

    def test_the_end_invites_nothing(self):
        text = flat(read("shared", "legal-research.md"))
        self.assertIn("Captured offers are not relayed and invite nothing.", text)
        self.assertNotIn("Each captured offer, word for word", text)
        self.assertNotIn("offers captured as loose threads", text)
        self.assertNotIn("out-of-scope questions", flat(read("legal-research", "SKILL.md")))


if __name__ == "__main__":
    unittest.main()
