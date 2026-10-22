"""Pins that a research job's memo always answers its question: on a job the audit has no closed
gate and no "More research is needed" sentence, its Conclusion answers from the sources held, the
pool and the citator get gap lines, and the job question gets no offers; the caller adds a step to
the held job for each tier a return names as not run, stamps a step only after its work ran, and
relays-and-stops only outside a held job; and a job plan's Westlaw step has no approval point.

Spec: docs/Specs/2026-10-21_research-job-memo-always-answers-spec.md

Run: python -m pytest .claude/skills/legal-research/tests/test_job_memo_answers.py -q
"""

import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


class AuditProtocolTest(unittest.TestCase):
    def setUp(self):
        self.protocol = flat(read("shared", "legal-audit-protocol.md"))

    def test_a_job_memo_always_answers(self):
        step_four = between(self.protocol, "### Step 4", "### Step 5")
        self.assertIn("**On a job, the memo always answers.**", step_four)
        self.assertIn("Step 4 has no closed gate and no mandated sentence", step_four)
        self.assertIn("`No authority located in <the tiers searched>.`", step_four)
        self.assertIn("The Conclusion never defers to further research, offers research or names a tier not run.", step_four)

    def test_pool_and_citator_get_gap_lines(self):
        step_four = between(self.protocol, "### Step 4", "### Step 5")
        self.assertIn("`Commons: NOT AUDITED: <state>`", step_four)
        self.assertIn("`Note-up: <citation> NOT NOTED UP`", step_four)

    def test_no_offer_on_the_job_question(self):
        step_five = between(self.protocol, "### Step 5", "### Step 6")
        self.assertIn("On a job, write no offer for work on the job question: each such gap is its `gap:` line.", step_five)

    def test_mixed_coverage_sentence_only_without_a_job(self):
        step_six = between(self.protocol, "### Step 6", "## Fallback ladder")
        self.assertIn("Mixed coverage with `Job question: none`: the first `## Conclusion` opens with Step 4's mandated sentence", step_six)


class MemoTemplateTest(unittest.TestCase):
    def test_job_memo_conclusion_answers(self):
        job_memo = flat(read("shared", "research-memo-template.md").split("**A job's memo.**")[1])
        self.assertIn("Each `Conclusion` answers its part from the sources held and never defers to further research", job_memo)
        self.assertIn("`shared/legal-audit-protocol.md` Step 4", job_memo)


class GateDoctrineTest(unittest.TestCase):
    def setUp(self):
        self.doctrine = flat(read("shared", "legal-research.md"))

    def test_open_tiers_become_steps_on_the_job(self):
        rule = between(self.doctrine, "**On a held job, an open tier is not an answer.**", "Persist in this order.")
        self.assertIn("add one step to the held job for each tier it names, by `/drafting-data`'s partial replace", rule)
        self.assertIn("in the practitioner's name", rule)
        self.assertIn("A step is stamped done only once its work has run", rule)
        self.assertIn("A caller holding no job keeps the single loop above.", rule)

    def test_closed_gate_rule_excepts_a_held_job(self):
        rule = between(self.doctrine, "**When the gate closes, closed is the answer.**", "**After the answer")
        self.assertIn("A caller holding a `/draft` job takes the held-job rule below instead", rule)

    def test_skill_step_five_points_a_held_job_to_the_doctrine(self):
        step_five = between(flat(read("legal-research", "SKILL.md")), "5. A return carrying", "If step 1's read fails")
        self.assertIn("A caller holding a `/draft` job never relays and stops on gaps", step_five)
        self.assertIn("\"On a held job, an open tier is not an answer\"", step_five)


class JobPlanningTest(unittest.TestCase):
    def setUp(self):
        plan = read("shared", "job-planning.md")
        self.section = flat(plan[plan.index("## 2. A research job"):plan.index("## 3.")])

    def test_westlaw_has_no_approval_point(self):
        self.assertNotIn("approval point", self.section)
        self.assertIn("the Westlaw query, run without asking unless the practitioner declined it", self.section)

    def test_completion_test_needs_an_answer_and_a_step_per_open_tier(self):
        self.assertIn("the memo's Conclusion answers every sub-issue", self.section)
        self.assertIn("each tier a research return names as not run is a step on the job", self.section)
        self.assertIn("stamped done only once its work has run", self.section)

    def test_partial_replace_adds_open_tier_steps(self):
        jobs_run = flat(read("drafting-data", "references", "jobs-run.md"))
        self.assertIn("It is also the write that adds a step for each tier a held research job's return names as not run", jobs_run)


class StepStatusTextTest(unittest.TestCase):
    """Pins for the step statuses (schema v78): a blocked step is ↻, never stamped done; a held
    job's Westlaw step waits as ⏳ in 5-minute checks with one paralegal out; and the wake-up minute
    is never a deadline."""

    def test_a_blocked_step_is_retry_never_done(self):
        six = between(flat(read("drafting-data", "references", "jobs-run.md")), "## 6. Step progress", "## 6a.")
        self.assertIn("A step blocked by a missing credential or an unreachable source is set to ↻ with `drafting_data__set_step` (§6b), never stamped ☑.", six)

    def test_the_westlaw_wait_is_a_five_minute_check(self):
        tier_four = between(flat(read("shared", "legal-research.md")), "**On a held job, the Westlaw wait is a ⏳ step.**", "Where tiers 1–3")
        self.assertIn("set that step ⏳ for 5 minutes", tier_four)
        self.assertIn("When the time has passed, check whether the paralegal has returned and its memo is filed", tier_four)
        self.assertIn("If not, set the step ⏳ for 5 minutes again.", tier_four)
        self.assertIn("Never dispatch a second `research-paralegal` while one is out.", tier_four)
        self.assertIn("A `status: blocked (...)` return sets the step ↻ (`status: retry`), never done.", tier_four)
        step_three = between(flat(read("legal-research", "SKILL.md")), "3. Run Westlaw before the audit", "Then run the doctrine's duty 4")
        self.assertIn("after launching the query set its step ⏳ for 5 minutes", step_three)
        self.assertIn("check whether the run has finished and can be downloaded", step_three)
        self.assertIn("If not, set the step ⏳ for 5 minutes again.", step_three)
        self.assertIn("Never dispatch a second `research-paralegal` while one is out.", step_three)

    def test_the_wait_is_never_a_deadline(self):
        isolation = flat(read("shared", "deadline-isolation.md"))
        rule = between(isolation, "**A step's wait is a time to check a process, not a deadline.**", "**Hearing dates on the Job Board page**")
        self.assertIn("never as time remaining or a countdown", rule)
        self.assertIn("It is never a deadline, and it never goes into a handover or a captured idea.", rule)


if __name__ == "__main__":
    unittest.main()
