import re
import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
NOTICE = "`practice_data__record_retainer_notice`"


class RetainerFollowUpTest(unittest.TestCase):
    """A sent replenishment request records a notice and offers a to-do whose date the practitioner gives."""

    @classmethod
    def setUpClass(cls):
        lines = (DRAFT / "references" / "letters.md").read_text(encoding="utf-8").splitlines()
        cls.follow_up = next(line for line in lines if line.startswith("**The follow-up to-do.**"))
        cls.act = next(line for line in lines if line.startswith("**When it goes out.**"))

    def test_the_sent_act_records_the_notice_after_the_entry_and_before_the_trash_offer(self):
        order = ["`matter_data__procedural_history_append`", "Once the entry is written", NOTICE, "`file_ops__trash`"]
        positions = [self.act.index(part) for part in order]
        self.assertEqual(positions, sorted(positions))

    def test_the_notice_carries_date_copy_and_amount(self):
        for part in ("that date as `sent_at`", "that copy, if any, as `source_path`", "an amount the letter states as `amount_requested`"):
            self.assertIn(part, self.act)

    def test_the_request_is_read_from_the_letter_or_the_practitioner(self):
        for text in (self.act, self.follow_up):
            self.assertIn("by its text or the practitioner's word", text)

    def test_the_offer_covers_any_recorded_send(self):
        self.assertIn("section 8's follow-up to-do applies", self.act)
        for part in ("by the Sent write or a client letter's sent act", "respond by a date it states", "requests a retainer replenishment"):
            self.assertIn(part, self.follow_up)
        self.assertIn("offer once", self.follow_up)
        self.assertIn("never offer it again for this letter", self.follow_up)

    def test_a_client_letters_to_do_names_the_file_with_no_filing_and_no_mockup(self):
        self.assertIn('on a client letter "Check for reply to <file name>"', self.follow_up)
        self.assertIn("never names the advice", self.follow_up)
        self.assertIn("A client letter's to-do has no `filing_ref`", self.follow_up)
        self.assertIn("on a Writing `filing_ref` `filing:<id>`", self.follow_up)
        self.assertIn("Once a Writing's to-do is added, render the mockup", self.follow_up)

    def test_the_practitioner_gives_the_date(self):
        self.assertIn("ask the practitioner for the to-do's BF date", self.follow_up)
        self.assertIn("Never compute, suggest or offset a date", self.follow_up)
        self.assertIn("never mention an agreement's day count as a date", self.follow_up)
        self.assertIn("with no deadline", self.follow_up)

    def test_no_text_states_or_computes_a_replenishment_deadline(self):
        pattern = r"\d+\s*(?:business |calendar )?days?\b|\bdue (?:by|on|date)\b|\bdeadline_date\b|\btoday \+"
        for text in (self.act, self.follow_up):
            self.assertEqual(re.findall(pattern, text, re.IGNORECASE), [])


if __name__ == "__main__":
    unittest.main()
