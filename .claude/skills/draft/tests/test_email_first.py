"""An email request writes the .eml first (docs/Specs/2026-10-23_bare-email-request-fast-path-spec.md)."""
import re
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS = SKILL_ROOT.parent
SKILL = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
LETTERS = (SKILL_ROOT / "references" / "letters.md").read_text(encoding="utf-8")
PROCEDURE = (SKILL_ROOT / "references" / "procedure.md").read_text(encoding="utf-8")
EMAIL = (SKILLS / "shared" / "email.md").read_text(encoding="utf-8")
WORK_PROCEDURE = (SKILLS / "work" / "references" / "procedure.md").read_text(encoding="utf-8")

RULES_CALLS = ("skill_rules__applicable", "rules__at", "rules__move", "rules__branch")


def atom(text, atom_id):
    match = re.search(rf"<!-- atom id={re.escape(atom_id)} [^>]*-->\n(.*?)(?=\n<!-- atom|\Z)", text, re.S)
    assert match, atom_id
    return match.group(1)


class EmailFirstTests(unittest.TestCase):
    def test_no_text_holds_an_email_back_for_its_purpose(self):
        purpose = atom(SKILL, "draft.purpose")
        ask = next(s for s in purpose.split(". ") if "ask one plain-text question" in s)
        self.assertNotIn("email", ask)
        self.assertIn("An email is never held back for its purpose", purpose)
        self.assertIn("An email is never held back for its purpose", LETTERS)
        self.assertNotIn("purpose question", WORK_PROCEDURE)

    def test_the_ban_on_inferring_a_purpose_stays(self):
        self.assertIn("never inferred from the file", atom(SKILL, "draft.purpose"))
        self.assertIn("never inferred from the file", EMAIL)

    def test_never_in_chat_and_eml_before_the_save(self):
        for name, text in (("SKILL.md", SKILL), ("letters.md", LETTERS), ("email.md", EMAIL)):
            with self.subTest(file=name):
                self.assertIn("An email is never drafted in chat", text)
        self.assertIn("written and shown first, before the email is saved as a Writing", LETTERS)
        self.assertIn("in the same turn", LETTERS)
        self.assertIn("written and shown before the email is saved as a Writing, and the save follows in the same turn", EMAIL)
        self.assertIn("The one exception to \"first\" is an email request", PROCEDURE)

    def test_no_rules_call_before_write_email(self):
        fast = atom(SKILL, "draft.email-first")
        before = fast[: fast.index("4. `write_email`")]
        for call in RULES_CALLS:
            with self.subTest(call=call):
                self.assertNotIn(call, before)
        self.assertIn("every rules call wait until the `.eml` is shown", before)

    def test_the_fast_path_calls_in_order(self):
        fast = atom(SKILL, "draft.email-first")
        fast = fast[fast.index("1. "):]
        order = ["ToolSearch", "`shared/email.md`", "`drafting_forms__open_session`", "`write_email`", "`to_service_list: true`"]
        positions = [fast.index(item) for item in order]
        self.assertEqual(positions, sorted(positions))

    def test_the_one_toolsearch_loads_write_email(self):
        each_step = atom(SKILL, "draft.each-step")
        self.assertIn("`drafting_forms__draft_harness`", each_step)

    def test_an_email_with_a_body_is_reviewed_first(self):
        fast = atom(SKILL, "draft.email-first")
        review = fast.index("`references/source-trace.md`")
        self.assertLess(review, fast.index("4. `write_email`"))
        self.assertIn("An empty body needs none", fast)


if __name__ == "__main__":
    unittest.main()
