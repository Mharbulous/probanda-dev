"""Pins that a research memo always answers its question: the audit has no closed gate, its
Conclusion answers from the sources held and ends with the open-issues paragraph only where the
scope test leaves research required, the pool and the citator get gap lines, and required research
gets no offer; the caller adds a step to the held job for each `required` item memo-reviewer names,
and stamps a step only after its work ran;
and a job plan's Westlaw step has no approval point.

Spec: docs/Specs/2026-10-21_research-job-memo-always-answers-spec.md

Run: python -m pytest source/skills/legal-research/tests/test_job_memo_answers.py -q
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
        self.assertIn("**The memo always answers.** Write the memo whatever the coverage.", step_four)
        self.assertIn("`No authority located in <the tiers searched>.`", step_four)
        self.assertIn("Nothing else in the memo defers to further research, offers research or names a tier not run.", step_four)
        self.assertNotIn("More research is needed before I can give", self.protocol)

    def test_pool_and_citator_get_gap_lines(self):
        step_four = between(self.protocol, "### Step 4", "### Step 5")
        self.assertIn("`Commons: NOT AUDITED: <state>`", step_four)
        self.assertIn("`Note-up: <citation> NOT NOTED UP`", step_four)

    def test_no_offer_on_the_job_question(self):
        step_five = between(self.protocol, "### Step 5", "### Step 6")
        self.assertIn("Required research gets no offer: it is its `gap:` line.", step_five)

    def test_open_issues_paragraph_ends_the_conclusion(self):
        step_four = between(self.protocol, "### Step 4", "### Step 5")
        self.assertIn("end the Conclusion with one paragraph opening `More research is needed on the following issues:`", step_four)
        self.assertIn("begin the return's `Audit:` line `INCOMPLETE:`", step_four)
        step_six = between(self.protocol, "### Step 6", "## Fallback ladder")
        self.assertIn("The Conclusion answers as Step 4 says, its open-issues paragraph last.", step_six)
        self.assertNotIn("Mixed coverage", self.protocol)


class MemoTemplateTest(unittest.TestCase):
    def test_conclusion_ends_with_open_issues_only_where_research_is_required(self):
        template = flat(read("shared", "research-memo-template.md"))
        self.assertIn("followed, only where research is required (`shared/legal-audit-protocol.md` Step 4), "
                      "by the open-issues paragraph, after the last Conclusion.", template)


class GateDoctrineTest(unittest.TestCase):
    def setUp(self):
        self.doctrine = flat(read("shared", "legal-research.md"))

    def test_open_tiers_become_steps_on_the_job(self):
        rule = between(self.doctrine, "**On a held job, an open tier is not an answer.**", "Persist in this order.")
        self.assertIn("add one step to the held job for each tier they name, by `/drafting-data`'s partial replace", rule)
        self.assertIn("in the practitioner's name", rule)
        self.assertIn("A step is stamped done only once its work has run", rule)
        self.assertNotIn("A caller holding no job", rule)

    def test_an_incomplete_memo_is_no_licence(self):
        rule = between(self.doctrine, "**An incomplete memo is never a licence.**", "**After the answer")
        self.assertIn("is never a licence to answer the question yourself", rule)
        self.assertNotIn("**When the gate closes", self.doctrine)

    def test_skill_step_five_points_a_held_job_to_the_doctrine(self):
        step_five = between(flat(read("legal-research", "SKILL.md")), "5. A return carrying", "If step 1's read fails")
        self.assertIn("each piece of research becomes a step on the held job", step_five)
        self.assertIn("\"On a held job, an open tier is not an answer\"", step_five)


class JobPlanningTest(unittest.TestCase):
    def setUp(self):
        plan = read("shared", "job-planning.md")
        self.section = flat(plan[plan.index("## 2. A research job"):plan.index("## 3.")])

    def test_westlaw_has_no_approval_point(self):
        self.assertNotIn("approval point", self.section)
        self.assertIn("the Westlaw query, run without asking unless the practitioner declined it", self.section)

    def test_completion_test_needs_an_answer_and_a_step_per_open_tier(self):
        self.assertIn("the memo's Conclusion answers the Issue with pinpoint citations", self.section)
        self.assertIn("each tier memo-reviewer finds required is a step on the job", self.section)
        self.assertIn("stamped done only once its work has run", self.section)

    def test_partial_replace_adds_open_tier_steps(self):
        jobs_run = flat(read("drafting-data", "references", "jobs-run.md"))
        self.assertIn("It is also the write that adds a step for each `required` item memo-reviewer names on a held research job", jobs_run)


class StepStatusTextTest(unittest.TestCase):
    """Pins for the step statuses (schema v78): a blocked step is ↻, never stamped done; a held
    job's Westlaw step waits as ⏳ on law-getter's return, with the practitioner told how long a run takes and
    one Chrome-mode law-getter out; and the wake-up minute is never a deadline."""

    def test_a_blocked_step_is_retry_never_done(self):
        six = between(flat(read("drafting-data", "references", "jobs-run.md")), "## 6. Step progress", "## 6a.")
        self.assertIn("A step blocked by a missing credential or an unreachable source is set to ↻ with `drafting_data__set_step` (§6b), never stamped ☑.", six)

    def test_the_westlaw_wait_tells_the_practitioner_and_waits_on_the_return(self):
        tier_four = between(flat(read("shared", "legal-research.md")), "**On a held job, the Westlaw wait is a ⏳ step.**", "Where tiers 1–3")
        self.assertIn("set that step ⏳ for 25 minutes", tier_four)
        self.assertIn("`wait_minutes: 25`", tier_four)
        self.assertIn("a Deep Research run often takes 10 to 25 minutes and that nothing shows until it returns", tier_four)
        self.assertIn("Its return wakes the session.", tier_four)
        self.assertIn("Never dispatch a second Chrome-mode `law-getter` while one is out.", tier_four)
        self.assertIn("A `status: blocked (...)` return sets the step ↻ (`status: retry`), never done.", tier_four)
        self.assertNotIn("5 minutes again", tier_four)
        step_three = between(flat(read("legal-research", "SKILL.md")), "3. Run Westlaw before the audit", "Then run the doctrine's duty 4")
        self.assertIn("tell the practitioner how long a run takes, and stamp the step from law-getter's return", step_three)
        self.assertIn("Never dispatch a second Chrome-mode `law-getter` while one is out.", step_three)
        self.assertNotIn("5 minutes again", step_three)

    def test_the_wait_is_never_a_deadline(self):
        isolation = flat(read("shared", "deadline-isolation.md"))
        rule = between(isolation, "**A step's wait is a time to check a process, not a deadline.**", "**Hearing dates on the Work Board page**")
        self.assertIn("never as time remaining or a countdown", rule)
        self.assertIn("It is never a deadline, and it never goes into a handover or a captured idea.", rule)


if __name__ == "__main__":
    unittest.main()
