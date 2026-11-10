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
    """Loose-thread triage runs when the practitioner asks to rank or review the threads."""

    @classmethod
    def setUpClass(cls):
        cls.text = DISPATCH.read_text(encoding="utf-8")
        cls.procedure = PROCEDURE.read_text(encoding="utf-8")
        cls.triage = TRIAGE.read_text(encoding="utf-8")

    def test_opening_still_waits_with_no_invitation(self):
        opening = paragraph(self.text, "**Opening.**")
        self.assertIn("When nothing was dispatched, wait, with no line inviting a reply", opening)

    def test_references_table_names_the_triage_file(self):
        table = self.procedure[self.procedure.index("## 15. References"):]
        self.assertIn(
            "| The practitioner asks to rank, review or triage the loose threads "
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
            "until it is completed or shelved, unless it waits, directly or through "
            "other open jobs, on the Writing's `File and serve`, `Serve the application` "
            "or `Serve the response` job, which puts it after the gate and outside it.",
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
        self.assertIn('`action: "discard"` with `ids`', drop)
        self.assertIn("naming every id", drop)

    def test_jobs_run_deletes_no_loose_thread(self):
        drop = section(
            JOBS_RUN.read_text(encoding="utf-8"),
            "## 8. Loose-thread capture",
            "## 9. Complete",
        )
        self.assertNotIn("FROM seeds", drop)
        self.assertIn("deletes nothing", drop)

    def test_a_discard_is_confirmed_as_discarded(self):
        self.assertNotIn("the ids gone", self.triage)
        self.assertEqual(self.triage.count("The call's `updated` names the ids discarded."), 2)

    def test_step_1_reads_the_open_set_by_one_tool_call(self):
        step1 = section(self.triage, "**Step 1.", "**Step 2.")
        self.assertIn('One `loose_threads__read` with `db_path`, `mode: "triage"` and `kind: "idea"`', step1)
        self.assertNotIn("drafting_data__query", self.triage)
        self.assertNotIn("seeds", self.triage)
        self.assertNotIn("board_card", self.triage)
        self.assertIn("`loose_threads_path`", self.triage)
        self.assertNotIn("view_page_paths", self.triage)

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
