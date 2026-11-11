"""Screenshot readings are saved and looked up: /timecamping Step 5 and /triage-billing-dates Phase 2 skip a capture already read."""
import re
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]


def text(skill):
    return (SKILLS / skill / "SKILL.md").read_text(encoding="utf-8")


def step5():
    body = text("timecamping")
    start = body.index("### Step 5")
    return body[start:body.index("### Step 6", start)]


class CaptureReadingWiring(unittest.TestCase):
    def test_step5_names_the_lookup_before_the_reader(self):
        step = step5()
        self.assertIn("time_pipeline__get", step, "Step 5 does not look up a saved reading")
        self.assertIn("capture_reading:<capture id>", step)
        self.assertLess(step.index("time_pipeline__get"), step.index("time_pipeline__set"), "lookup must come before the save")
        self.assertRegex(step, r"skip it", "Step 5 does not skip a capture already read")

    def test_step5_names_the_save_and_the_append(self):
        step = step5()
        self.assertIn("time_pipeline__set", step)
        self.assertIn("expect_absent: true", step, "the first save does not use expect_absent")
        self.assertIn("expect_sha256", step, "an appended answer does not use expect_sha256")
        self.assertIn("stale_write", step, "Step 5 does not handle a reading another run saved first")

    def test_triage_phase2_points_at_step5(self):
        phase2 = text("triage-billing-dates")
        self.assertRegex(phase2, r"capture_reading", "triage Phase 2 does not name the saved reading")
        self.assertIn("time_pipeline__set", phase2)
        self.assertIn("expect_absent", phase2)

    def test_time_pipeline_data_lists_the_kind(self):
        body = text("time-pipeline-data")
        self.assertRegex(body, r"`capture_reading`", "time-pipeline-data does not list the kind")
        self.assertTrue(re.search(r"capture_reading:<capture id>", body), "the key shape is not stated")

    def test_the_reader_report_keeps_the_shape_the_record_holds(self):
        reader = (SKILLS.parent / "billing" / "agents" / "screenshot-reader.md").read_text(encoding="utf-8")
        for field in ("ON SCREEN:", "IDENTIFIERS:", "UNCHANGED:", "UNREADABLE:"):
            self.assertIn(field, reader)


if __name__ == "__main__":
    unittest.main()
