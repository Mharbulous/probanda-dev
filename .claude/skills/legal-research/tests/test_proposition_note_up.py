"""Regression lock: a proposition-level note-up is asked for by paragraph number and is tracked work.

Spec 2026-10-31 case-level note-up and DRAFT memo status, §12 criterion 4: "Note up the
propositions in paragraphs N and M" writes one job naming exactly those paragraphs through
/drafting-data §3k, one step per paragraph keyed to its stored item, and an authority the memo
relies on produces no `kind: note-up` offer.
"""
import unittest
from pathlib import Path


SKILLS = Path(__file__).resolve().parents[2]


def read(path):
    return (SKILLS / path).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


class PropositionNoteUpTests(unittest.TestCase):
    def test_front_door_routes_the_request_to_the_gate_section(self):
        self.assertIn('follow `shared/legal-research.md`, "Proposition-level note-up"',
                      flat(read("legal-research/SKILL.md")))

    def test_gate_section_names_the_paragraphs_and_hands_the_job_to_3k(self):
        section = between(flat(read("shared/legal-research.md")), "**Proposition-level note-up.**",
                          "**Statute currency.**")
        self.assertIn("name exactly those paragraphs", section)
        self.assertIn('§3k, "A research memo\'s paragraphs"', section)
        self.assertIn("without it, run the steps here and say no job was written", section)
        self.assertIn("only once every item citing it has a proposition-level note-up", section)
        self.assertIn("Note up paragraphs: <the saved memo's path>: <n>[, <n>] / none",
                      read("shared/legal-research.md"))

    def test_3k_writes_one_step_per_paragraph_keyed_to_its_item(self):
        note_up = read("drafting-data/references/jobs-create.md").split("## 3k. The note-up job", 1)[1]
        rule = flat(between(note_up, "**A research memo's paragraphs.**", "**Working and closing it.**"))
        self.assertIn("`Note up the propositions in paragraphs <n>, <m>`", rule)
        self.assertIn("One step per paragraph, `Note up at proposition level: paragraph <n>, <citation>`", rule)
        self.assertIn("`('statements_of_law', <the id its line ends with>)`", rule)
        self.assertIn("No `ticket_proposals` row.", rule)

    def test_a_relied_on_authority_gets_no_note_up_offer(self):
        step_five = flat(between(read("shared/legal-audit-protocol.md"), "### Step 5", "### Step 6"))
        self.assertIn("An authority the memo relies on gets no note-up offer", step_five)
        self.assertIn("noting up an authority the memo does not rely on", step_five)
        self.assertNotIn("only through a citator's list of citing cases", step_five)

    def test_the_agent_updates_the_named_paragraphs_in_place(self):
        step_two = flat(between(read("shared/legal-audit-protocol.md"), "For every authority you intend to rely on",
                                "### Step 3"))
        self.assertIn("each paragraph the spawn prompt's `Note up paragraphs:` names", step_two)
        self.assertIn("keep its items and their numbers", step_two)
        self.assertIn("update Validity, Confidence, the CanLII segment and Status", step_two)


if __name__ == "__main__":
    unittest.main()
