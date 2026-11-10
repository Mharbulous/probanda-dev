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
        cls.act = next(line for line in lines if line.startswith("**The retainer notice.**"))

    def test_the_notice_follows_the_sent_write_and_precedes_the_offer(self):
        order = ["When the Sent write records a letter to the client", NOTICE, "follow-up to-do below applies"]
        positions = [self.act.index(part) for part in order]
        self.assertEqual(positions, sorted(positions))

    def test_the_notice_carries_date_copy_and_amount(self):
        for part in ("the date it went as `sent_at`", "the copy as sent, if any, as `source_path`", "an amount the letter states as `amount_requested`"):
            self.assertIn(part, self.act)

    def test_the_request_is_read_from_the_letter_or_the_practitioner(self):
        for text in (self.act, self.follow_up):
            self.assertIn("by its text or the practitioner's word", text)

    def test_the_offer_covers_any_recorded_send(self):
        self.assertIn("the follow-up to-do below applies", self.act)
        for part in ("recorded by the Sent write", "respond by a date it states", "requests a retainer replenishment"):
            self.assertIn(part, self.follow_up)
        self.assertIn("offer once", self.follow_up)
        self.assertIn("never offer it again for this letter", self.follow_up)

    def test_every_to_do_names_its_writing(self):
        self.assertIn("`filing_ref` `filing:<id>` naming this letter", self.follow_up)
        self.assertIn("Once a Writing's to-do is added, render the mockup", self.follow_up)
        self.assertNotIn("client letter", self.follow_up)

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
