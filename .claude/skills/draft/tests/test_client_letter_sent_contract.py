import re
import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
SKILLS = DRAFT.parent
APPEND = "`matter_data__procedural_history_append`"


def read(path):
    return path.read_text(encoding="utf-8")


def section(text, heading):
    start = text.index(heading)
    end = text.find("\n## ", start + len(heading))
    return text[start:end if end != -1 else None]


class ClientLetterSentTest(unittest.TestCase):
    """A client letter's sent act writes the history file, and no database but a replenishment request's notice."""

    @classmethod
    def setUpClass(cls):
        client_letters = section(read(DRAFT / "references" / "letters.md"), "## 10. Client letters")
        cls.act = next(line for line in client_letters.splitlines() if line.startswith("**When it goes out.**"))
        cls.client_letters = client_letters

    def test_the_check_comes_before_the_record(self):
        self.assertLess(self.act.index("`references/delivery-check.md`"), self.act.index(APPEND))

    def test_it_records_date_and_copy_path_by_title(self):
        for part in ("`date` the date it went", "`line` `Sent <file name without its extension> to client`", "`source_path` the copy"):
            self.assertIn(part, self.act)
        self.assertIn("never the draft `.eml`", self.act)
        self.assertIn("`duplicate_entry`", self.act)

    def test_no_database_write(self):
        for write in ("drafting_data__", "/drafting-data", "board_attachments"):
            self.assertNotIn(write, self.act)
        self.assertEqual(re.findall(r"practice_data__\w+", self.act), ["practice_data__record_retainer_notice"])
        self.assertIn("never write its title, its status or any of its text there", self.client_letters)
        self.assertIn("no Sent write", self.client_letters)

    def test_trash_offer_reuses_the_file_manager_stop_and_covers_the_board_card(self):
        self.assertIn("offer once", self.act)
        self.assertIn("`file_ops__trash`", self.act)
        self.assertIn("do as the paragraph above says", self.act)
        self.assertIn("detach the letter from its board", self.act)
        self.assertIn("Never fall back to a shell `mv` or `rm`", self.client_letters)

    def test_ban_19_is_not_limited_to_writings(self):
        ban = next(line for line in read(DRAFT / "SKILL.md").splitlines() if line.startswith("19. "))
        self.assertIn("whether a letter was sent, delivered or received", ban)
        self.assertNotIn("Writing", ban)

    def test_bindings_cover_it(self):
        for text in (read(DRAFT / "SKILL.md"), read(SKILLS / "shared" / "procedural-history.md")):
            self.assertIn("or a client letter is recorded as sent", text)

    def test_the_check_only_reports_for_a_client_letter(self):
        check = read(DRAFT / "references" / "delivery-check.md")
        step = next(line for line in check.splitlines() if line.startswith("3. **No draft"))
        self.assertIn("a client letter", step)
        self.assertIn("Stop here", step)
        self.assertLess(check.index(step), check.index("**Record the letter as sent**"))


class BillSentTest(unittest.TestCase):
    """A bill's sent record is checked first, then written, then logged, all in /issue-invoice."""

    @classmethod
    def setUpClass(cls):
        cls.went_out = section(read(SKILLS / "issue-invoice" / "SKILL.md"), "## When it went out")

    def test_order(self):
        order = ["`lawyer:delivery-checker`", "`practice_data__record_invoice_sent`", APPEND]
        positions = [self.went_out.index(name) for name in order]
        self.assertEqual(positions, sorted(positions))

    def test_it_never_points_up_to_draft(self):
        self.assertNotIn("delivery-check.md", self.went_out)
        self.assertNotIn("/draft", self.went_out)

    def test_it_writes_no_status(self):
        self.assertNotIn("import_invoices", self.went_out)

    def test_its_own_entry(self):
        self.assertIn("`line` `Sent invoice <number> to client`", self.went_out)


if __name__ == "__main__":
    unittest.main()
