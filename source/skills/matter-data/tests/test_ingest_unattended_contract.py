"""ingest-unattended (operations/ingest-unattended.md) is skill prose over the
existing ingest machinery. These checks pin the text that other files must agree
with: the pending markers' exact wording, the stop reasons, and the failure
classes the review log accepts."""

import re
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
OPERATIONS = CASE_DATA_ROOT / "operations"
CONVENTIONS = (CASE_DATA_ROOT / "shared" / "conventions.md").read_text(encoding="utf-8")
UNATTENDED = (OPERATIONS / "ingest-unattended.md").read_text(encoding="utf-8")

ORDER_EFFECTS = "ORDER-EFFECTS-PENDING: order-effects pass not yet run"
LINKAGE = "LINKAGE-PENDING: proceeding linkage check not yet run"
DATE_ANCHOR = "DATE-ANCHOR-PENDING: date not yet recorded as an anchor"


class IngestUnattendedContractTests(unittest.TestCase):
    def test_the_pending_markers_are_worded_once_and_used_verbatim(self):
        section = CONVENTIONS.split("## 11. Pending markers", 1)[1]
        for marker, users in ((ORDER_EFFECTS, ("ingest-unattended.md", "order-effects.md")),
                              (LINKAGE, ("ingest-unattended.md", "proceedings-profile.md")),
                              (DATE_ANCHOR, ("ingest-unattended.md", "../SKILL.md"))):
            self.assertIn(f"`{marker}`", section)
            for name in users:
                with self.subTest(marker=marker, file=name):
                    self.assertIn(marker, (OPERATIONS / name).read_text(encoding="utf-8"))
        probe = (OPERATIONS / "ingest-status.md").read_text(encoding="utf-8")
        self.assertIn("'ORDER-EFFECTS-PENDING:'", probe)
        self.assertIn("'LINKAGE-PENDING:'", probe)
        self.assertIn("'DATE-ANCHOR-PENDING:'", probe)
        self.assertIn("'[SECOND-COPY:'", probe)
        self.assertIn("'[TREATMENT-PENDING:'", probe)

    def test_path_d_owns_the_second_copy_write(self):
        extract = (OPERATIONS / "ingest-extract.md").read_text(encoding="utf-8")
        path_d = extract.split("## Path D", 1)[1].split("\n## ", 1)[0]
        self.assertIn("[SECOND-COPY:<hash>]", path_d)
        self.assertIn("conventions §11", path_d)
        scan = (OPERATIONS / "extract-facts.md").read_text(encoding="utf-8")
        text = scan.split("\n## 4.", 1)[1].split("\n## ", 1)[0]
        self.assertIn("Path D's second-copy rule", text)
        self.assertNotIn("append `[SECOND-COPY:", text)
        self.assertIn("Path D", CONVENTIONS.split("## 11. Pending markers", 1)[1].split("| Marker", 1)[0])

    def test_an_authority_matched_by_citation_is_recorded_by_the_tool(self):
        rule = UNATTENDED.split("3. **An authority matched by citation.**", 1)[1].split("\n## ", 1)[0]
        self.assertIn("`second_copy_of`", rule)
        self.assertIn("`ingested_by_reference`", rule)
        self.assertNotIn("append `[SECOND-COPY:", rule)

    def test_each_question_becomes_a_named_stop(self):
        for reason in ("target_pleading", "classification", "authority_kind", "other"):
            self.assertIn(f"`stop_reason` `{reason}`", UNATTENDED)
        self.assertNotIn("AskUserQuestion", UNATTENDED)

    def test_the_failure_classes_match_the_review_log(self):
        log = (OPERATIONS / "housekeeping-log.md").read_text(encoding="utf-8")
        schema = (CASE_DATA_ROOT / "references" / "schema.sql").read_text(encoding="utf-8")
        self.assertIn("failure_class IN ('deterministic','extractor')", schema)
        for failure_class in ("deterministic", "extractor"):
            self.assertIn(f"| `{failure_class}` |", UNATTENDED)
            self.assertIn(f"`{failure_class}`", log)
        self.assertIn("housekeeping-log.md", UNATTENDED)

    def test_the_gate_refuses_the_kinds_unattended_ingest_refuses(self):
        gate = (OPERATIONS / "ingest.md").read_text(encoding="utf-8")
        self.assertIn("a kind ingest cannot read", gate)
        step_2 = gate.split("## Step 2", 1)[1].split("## Step 3", 1)[0]
        for kind in (".pdf", ".docx", ".eml", ".msg", r"{\rtf"):
            with self.subTest(kind=kind):
                self.assertIn(kind, step_2)
        unattended_step_2 = UNATTENDED.split("## Step 2", 1)[1].split("## Step 3", 1)[0]
        self.assertIn("a kind ingest cannot read", unattended_step_2)

    def test_reads_run_ten_at_a_time_and_writes_one_at_a_time(self):
        self.assertIn("at most 10 at a time", UNATTENDED)
        self.assertIn("one at a time", UNATTENDED)
        self.assertIn("registered `partial`", UNATTENDED)

    def test_the_run_is_the_orchestrators_and_the_session_stays_out_of_each_write(self):
        self.assertIn("`orchestrator: true`", UNATTENDED)
        self.assertIn("ingest-orchestrator", UNATTENDED)
        self.assertIn("routing.md", UNATTENDED)
        self.assertNotIn("sql_script", UNATTENDED)

    def test_what_the_run_cannot_read_unattended_is_held_with_nothing_written(self):
        held = UNATTENDED.split("| `held` |", 1)[1].split("\n", 1)[0]
        self.assertIn("nothing was written", held.lower())
        self.assertIn("no review-log row", held)
        for reason in ("compound book", "book-of-authorities cascade", "continuation"):
            with self.subTest(reason=reason):
                self.assertIn(reason, UNATTENDED)

    def test_housekeeping_never_files_a_held_row_as_read(self):
        skills = CASE_DATA_ROOT.parent / "housekeeping" / "references"
        self.assertIn("`held`", (skills / "work-list-and-reading.md").read_text(encoding="utf-8"))
        rows = (skills / "compose-and-rows.md").read_text(encoding="utf-8")
        rule = next(line for line in rows.splitlines() if line.startswith("- **Held"))
        self.assertIn("`stuck`", rule)
        self.assertIn("never `file_no_ingest`", rule.lower())


if __name__ == "__main__":
    unittest.main()
