import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
WORK = DRAFT.parent / "work"
DISPATCH = WORK / "references" / "dispatch.md"
PROCEDURE = WORK / "references" / "procedure.md"
TRIAGE = WORK / "references" / "loose-thread-triage.md"
JOB_SESSION = WORK / "references" / "job-session.md"
JOBS_RUN = DRAFT.parent / "drafting-data" / "references" / "jobs-run.md"


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n", start)
    return text[start:end if end != -1 else None]


def section(text, opening, closing):
    start = text.index(opening)
    return text[start:text.index(closing, start)]


class LooseThreadTriageTest(unittest.TestCase):
    """Dispatch with no job offers loose-thread triage on a large backlog."""

    @classmethod
    def setUpClass(cls):
        cls.text = DISPATCH.read_text(encoding="utf-8")
        cls.procedure = PROCEDURE.read_text(encoding="utf-8")
        cls.triage = TRIAGE.read_text(encoding="utf-8")

    def test_dispatch_offers_triage_at_twenty_or_more(self):
        choose = paragraph(self.text, "1. **Choose.**")
        self.assertIn(
            "When the `live` lane's `## Loose Threads (n)` count is 20 or more, "
            "add one line offering to rank them on the Loose Threads page "
            "(`references/loose-thread-triage.md`); "
            "otherwise wait with no prompt.",
            choose,
        )

    def test_opening_still_waits_with_no_invitation(self):
        opening = paragraph(self.text, "**Opening.**")
        self.assertIn("When nothing was dispatched, wait, with no line inviting a reply", opening)

    def test_references_table_names_the_triage_file(self):
        table = self.procedure[self.procedure.index("## 15. References"):]
        self.assertIn(
            "| Dispatch found no job and the Loose Threads count is 20 or more, "
            "or the practitioner asks to rank or triage the loose threads (section 14, Dispatch) "
            "| `references/loose-thread-triage.md` |",
            table,
        )

    def test_branch_b_three_way_choice_is_unchanged(self):
        captured = paragraph(JOB_SESSION.read_text(encoding="utf-8"), "- Captured ideas:")
        self.assertIn(
            "offer a three-way choice, outline it now, leave it, or drop it, "
            "with no recommendation among the three.",
            captured,
        )

    def test_reference_carries_steps_one_to_five(self):
        for n in range(1, 6):
            self.assertIn(f"**Step {n}.", self.triage)

    def test_reference_carries_the_rules(self):
        self.assertIn(
            "Ranking orders, it never removes: however weak a thread, "
            "the session never drops it on its own judgment.",
            self.triage,
        )
        self.assertIn("Never infer a discard from a low rank.", self.triage)
        self.assertIn("only on their yes", self.triage)
        self.assertIn(
            "A queued job counts as open work against the Writing's `gate` criterion "
            "until it is completed or shelved.",
            self.triage,
        )

    def test_reference_holds_nothing_untested(self):
        lowered = self.triage.lower()
        for phrase in (
            "merge",
            "bulk",
            "before it is filed",
            "rule change",
            "housekeeping job",
            "closing multi-select",
        ):
            self.assertNotIn(phrase, lowered)

    def test_jobs_run_carries_the_batch_drop(self):
        drop = section(
            JOBS_RUN.read_text(encoding="utf-8"),
            "## 8. Loose-thread capture",
            "## 9. Complete",
        )
        self.assertIn(
            "UPDATE seeds SET discarded_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') "
            "WHERE id IN (3, 7, 12) AND discarded_at IS NULL;",
            drop,
        )
        self.assertIn("never `NOT IN`", drop)

    def test_jobs_run_deletes_no_loose_thread(self):
        drop = section(
            JOBS_RUN.read_text(encoding="utf-8"),
            "## 8. Loose-thread capture",
            "## 9. Complete",
        )
        self.assertNotIn("DELETE FROM seeds", drop)
        self.assertIn("never delete the row instead", drop)

    def test_a_discard_is_confirmed_as_discarded(self):
        self.assertNotIn("the ids gone", self.triage)
        self.assertEqual(self.triage.count("confirm-read the lane (the ids discarded, the count)"), 2)

    def test_tooling_threads_are_reported_as_observations_never_posted(self):
        box = paragraph(self.triage, "**Tooling threads are reported to Probanda.**")
        self.assertIn("run `references/suggestion-box.md` over every open `tooling` thread that is not deferred", box)
        self.assertIn("an observation holding only Probanda's own output, never the thread's words", box)
        self.assertIn("No thread is posted as a suggestion, and none is discarded without the practitioner's answer", box)
        self.assertNotIn("evaluator", self.triage)
        reference = (WORK / "references" / "suggestion-box.md").read_text(encoding="utf-8")
        self.assertIn("suggestion_observation__record", reference)
        self.assertNotIn("suggestion-evaluator", reference)
        self.assertNotIn("suggestion_card__build", reference)


if __name__ == "__main__":
    unittest.main()
