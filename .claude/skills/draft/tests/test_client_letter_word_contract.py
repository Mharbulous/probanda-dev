"""A client letter to sign comes out once, as a held letterhead Word document (docs/Specs/2026-11-03_client-letter-word-on-letterhead-spec.md)."""
import re
import unittest
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS = SKILL_ROOT.parent
LETTERS = (SKILL_ROOT / "references" / "letters.md").read_text(encoding="utf-8")
SKILL = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
EMAIL = (SKILLS / "shared" / "email.md").read_text(encoding="utf-8")
SECTION = LETTERS[LETTERS.index("## 10. Client letters"):]


class ClientLetterWordTests(unittest.TestCase):
    def test_the_word_document_is_the_review_draft_and_is_no_longer_forbidden(self):
        self.assertIn("A request for a letter, or for anything to sign, gets a letterhead Word document", SECTION)
        self.assertIn("step `client_letter_fill`", SECTION)
        self.assertIn(".docx`", SECTION)
        self.assertNotIn("gets no Word document", SECTION)
        self.assertNotIn("never build or approximate the letterhead for one", SECTION)

    def test_a_letter_to_sign_writes_no_empty_eml(self):
        atom = re.search(r"<!-- atom id=draft\.email-first [^>]*-->\n(.*?)\n1\. ", SKILL, re.S).group(1)
        self.assertIn("A client letter to sign is no email request: this rule does not fire and no `.eml` is written", atom)
        self.assertIn("A client letter to sign is no email request", EMAIL)

    def test_an_email_with_nothing_to_sign_keeps_its_markdown_draft_and_eml_on_approval(self):
        self.assertIn("A request for an email to the client with nothing to sign gets a Markdown review draft and an `.eml` on approval", SECTION)
        self.assertIn("`YYYY-MM-DD ET Client re {subject}.md`", SECTION)

    def test_the_hold_blocks_any_sendable_copy_and_only_a_roster_lawyer_lifts_it(self):
        self.assertIn("write no sendable copy of the letter anywhere", SECTION)
        self.assertIn("`attachment_on_hold`", SECTION)
        self.assertIn("Only an active roster lawyer", SECTION)
        self.assertIn("step lifts the hold", SECTION)
        self.assertIn("`not_a_roster_lawyer`", SECTION)

    def test_the_fill_follows_the_source_trace_review(self):
        word = next(line for line in SECTION.splitlines() if line.startswith("- **A Word letter**"))
        self.assertLess(word.index("source-trace review"), word.index("`client_letter_fill`"))

    def test_the_scrivener_still_writes_the_body_verbatim(self):
        self.assertIn("the scrivener's paragraphs verbatim", SECTION)
        self.assertIn("`prior_draft`", SECTION)

    def test_a_revision_reads_the_file_as_it_stands_and_never_overwrites(self):
        self.assertIn("read it as it stands with `research_filing__matter_folder`", SECTION)
        self.assertIn("Nothing is overwritten", SECTION)

    def test_no_letter_text_reaches_any_database(self):
        self.assertIn("never write its title, its status or any of its text there", SECTION)
        self.assertIn("A Word letter's first line is its first paragraph, and one with no hold line reads approved", SECTION)


if __name__ == "__main__":
    unittest.main()
