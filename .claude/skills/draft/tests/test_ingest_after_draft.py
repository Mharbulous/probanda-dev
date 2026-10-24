"""Un-ingested correspondence never delays a requested draft
(docs/Specs/2026-10-23_no-ingest-before-the-draft-spec.md)."""
import re
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS = SKILL_ROOT.parent
SKILL = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
LETTERS = (SKILL_ROOT / "references" / "letters.md").read_text(encoding="utf-8")
EMAIL = (SKILLS / "shared" / "email.md").read_text(encoding="utf-8")
WORK_PROCEDURE = (SKILLS / "work" / "references" / "procedure.md").read_text(encoding="utf-8")
JOB_SESSION = (SKILLS / "work" / "references" / "job-session.md").read_text(encoding="utf-8")


def atom(text, atom_id):
    match = re.search(rf"<!-- atom id={re.escape(atom_id)} [^>]*-->\n(.*?)(?=\n<!-- atom|\Z)", text, re.S)
    assert match, atom_id
    return match.group(1)


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n\n", start)
    return text[start:] if end == -1 else text[start:end]


class IngestAfterDraftTests(unittest.TestCase):
    def test_the_draft_skill_bans_an_ingest_before_the_draft(self):
        self.assertIn("An ingest is never run, and never offered, before a requested draft is shown",
                      atom(SKILL, "draft.no-block"))

    def test_no_check_runs_before_a_letter_is_written(self):
        check = paragraph(LETTERS, "**Ingestion check.**")
        self.assertIn("It comes after the draft, never before", check)
        self.assertNotIn("before the letter's first text", check)
        self.assertNotIn("drafting waits", check)

    def test_one_coverage_call_and_one_line(self):
        check = paragraph(LETTERS, "**Ingestion check.**")
        self.assertIn("One call in that turn, never a second", check)
        self.assertIn("Report the result in one line", check)
        self.assertIn("Shall I bring them in?", check)

    def test_the_email_fast_path_ends_with_the_check(self):
        fast = atom(SKILL, "draft.email-first")
        step_5 = fast[fast.index("5. "):]
        self.assertIn("`references/letters.md`, \"Ingestion check\"", step_5)
        self.assertLess(fast.index("4. `write_email`"), fast.index("5. "))
        self.assertIn("No ingest is run or offered before the `.eml` is shown", EMAIL)
        self.assertIn("then the one coverage check (section 1, \"Ingestion check\")",
                      paragraph(LETTERS, "**An email Writing.**"))

    def test_session_entry_holds_its_coverage_line_on_a_draft_request(self):
        step_3 = atom(WORK_PROCEDURE, "work.open.step-3")
        self.assertIn("except when the session was entered for a requested draft", step_3)

    def test_a_requested_job_is_assigned_before_its_input_check(self):
        check = atom(JOB_SESSION, "work.input-check")
        self.assertIn("**A requested draft goes first.**", check)
        self.assertIn("the job stays assigned", check)
        self.assertIn("every job in an unattended run, takes the check before the assigning write", check)
        self.assertIn("except a requested draft, which takes it after the draft is shown", atom(JOB_SESSION, "work.assign"))

    def test_a_counsel_change_rewrites_the_draft_without_setup(self):
        after = paragraph(LETTERS, "**After the ingest.**")
        self.assertIn("without re-running the drafting setup", after)
        self.assertIn("with the same arguments, which gives it the next \" vN\"", after)
        self.assertIn("mockup is rendered again", after)
        self.assertIn("Say in one line what changed", after)


if __name__ == "__main__":
    unittest.main()
