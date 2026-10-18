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

    def test_path_d_owns_the_second_copy_write(self):
        extract = (OPERATIONS / "ingest-extract.md").read_text(encoding="utf-8")
        path_d = extract.split("## Path D", 1)[1].split("\n## ", 1)[0]
        self.assertIn("[SECOND-COPY:<hash>]", path_d)
        self.assertIn("conventions §11", path_d)
        scan = (OPERATIONS / "extract-facts.md").read_text(encoding="utf-8")
        callers = {
            "ingest-unattended.md": UNATTENDED.split("3. **An authority matched by citation.**", 1)[1]
                                              .split("\n## ", 1)[0],
            "extract-facts.md": scan.split("\n## 4.", 1)[1].split("\n## ", 1)[0],
        }
        for name, text in callers.items():
            with self.subTest(file=name):
                self.assertIn("Path D's second-copy rule", text)
                self.assertNotIn("append `[SECOND-COPY:", text)
        self.assertIn("Path D", CONVENTIONS.split("## 11. Pending markers", 1)[1].split("| Marker", 1)[0])

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

    def test_a_malformed_naming_evidence_block_is_a_defect_not_a_failure(self):
        self.assertIn("`reader returned an unusable report`", UNATTENDED)
        extract = (OPERATIONS / "ingest-extract.md").read_text(encoding="utf-8")
        self.assertIn("never aborts a document's transaction", extract)

    def test_only_the_unattended_path_asks_extractors_for_naming_evidence(self):
        for name in ("extract-facts", "extract-affidavit", "extract-caselaw", "extract-provision"):
            with self.subTest(agent=name):
                agent = (CASE_DATA_ROOT / "agents" / (name + ".md")).read_text(encoding="utf-8")
                self.assertIn("`{{OUTPUT}}`: `full` or `ingest`. Absent means `full`.", agent)
                self.assertIn("required unless `OUTPUT` is `ingest`", agent)
        self.assertIn("`OUTPUT: full`", UNATTENDED)
        for name in ("ingest-extract.md", "extract-facts.md"):
            with self.subTest(file=name):
                self.assertIn("`OUTPUT: ingest`", (OPERATIONS / name).read_text(encoding="utf-8"))

    def test_the_gate_refuses_the_kinds_unattended_ingest_refuses(self):
        gate = (OPERATIONS / "ingest.md").read_text(encoding="utf-8")
        self.assertIn("a kind ingest cannot read", gate)
        step_2 = gate.split("## Step 2", 1)[1].split("## Step 3", 1)[0]
        for kind in (".pdf", ".docx", ".eml", ".msg", r"{\rtf"):
            with self.subTest(kind=kind):
                self.assertIn(kind, step_2)
        unattended_step_2 = UNATTENDED.split("## Step 2", 1)[1].split("## Step 3", 1)[0]
        self.assertIn("a kind ingest cannot read", unattended_step_2)

    def test_reads_batch_by_ten_and_writes_follow_list_order(self):
        self.assertRegex(UNATTENDED, r"batches of up to 10")
        self.assertIn("in list order", UNATTENDED)
        self.assertIn("registered `partial`", UNATTENDED)


if __name__ == "__main__":
    unittest.main()
