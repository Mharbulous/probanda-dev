"""asm32 finishes in one harness call, with no subagent (review D1, D2, S1).

Every asm32 step's result is computed in-process, so `init "asm32"` chains
through locate, validate, transform, fill and the assemble-phase verify and
returns `done`. Verify only reports once the .docx exists: a template token
left standing makes `verify_passed` false, never a halt. A law-report year in
the body is not a template token.

Run: python -m pytest source/skills/publish/subskills/publish-bcsc-form/tests/test_asm32_auto_advance.py -q
"""

import importlib
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

FORM32 = "\n".join([
    "---",
    "proposed_hearing: [proposed hearing]",
    "hearing_place: 800 Smithe Street",
    "registry: Vancouver",
    "time_estimate: 45 minutes",
    "associate_judge: yes",
    'orders: [{"order": 1, "text": "costs", "against": ["Beta Company Ltd."]}]',
    "appendix_types: []",
    "---",
    "",
    "## Part 2",
    "",
    "1. A fact.",
    "",
    "## Part 3",
    "",
    "2. The rule in Bankes v. Jarvis, [1903] 1 K.B. 549 applies.",
    "",
    "## Part 4",
    "",
    "- A document",
    "",
])

CONTEXT = {
    "correction_required": [],
    "title": "Stay Application",
    "court_file_number": "S-123456",
    "registry": "Vancouver",
    "court_location": "800 Smithe Street",
    "plaintiff_caption": "ALPHA COMPANY LTD.",
    "plaintiff_role": "Plaintiff",
    "defendant_caption": "BETA COMPANY LTD.",
    "defendant_role": "Defendant",
    "applicant_names": "Alpha Company Ltd.",
    "to_affected_parties": "Beta Company Ltd.",
    "client_name": "Alpha Company Ltd.",
    "lawyer_name": "Alex Example",
}


class Asm32AutoAdvanceTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.matter = root / "L1234 Foo v Bar"
        (self.matter / "0. DRAFTS").mkdir(parents=True)
        self.case_data = root / "0. CASE DATA" / "L1234 Foo"
        substance = self.case_data / "bcsc-form-substance"
        substance.mkdir(parents=True)
        (self.matter / "coclerk.json").write_text(
            json.dumps({"case_data_dir": str(self.case_data)}), encoding="utf-8")
        (substance / "form-32.md").write_text(FORM32, encoding="utf-8")
        self.sidecar = substance / "form-32-publish.json"
        env = mock.patch.dict(os.environ, {"DRAFT_BCSC_SESSIONS_DIR": str(root / "sessions")})
        env.start()
        self.addCleanup(env.stop)
        import harness
        self.harness = importlib.reload(harness)
        self.harness.load_all_steps()

    def run_asm32(self, caption):
        # The emitter's publish sidecar: asm32 reads the caption from it, not a Generate context.json.
        self.sidecar.write_text(json.dumps({"caption": caption, "warnings": []}), encoding="utf-8")
        with mock.patch("steps.shared.render.render_to_pdf",
                        lambda out: (Path(out).with_suffix(".pdf"), 1)), \
                mock.patch("steps.shared.render.extract_form32_tail", lambda out: ""):
            return self.harness.cmd_init(
                "asm32", matter_path=str(self.matter),
                case_data_folder=str(self.case_data), writing_folder="NOA Stay")

    def test_init_returns_done_with_no_subagent(self):
        done = self.run_asm32(CONTEXT)
        self.assertEqual(done["action"], "done", done)
        self.assertTrue(Path(done["output_path"]).is_file())
        self.assertEqual(Path(done["output_path"]).suffix, ".docx")

    def test_law_report_year_and_proposed_hearing_are_not_residual_placeholders(self):
        done = self.run_asm32(CONTEXT)
        self.assertEqual(done["action"], "done", done)
        with zipfile.ZipFile(done["output_path"]) as docx:
            document = docx.read("word/document.xml").decode("utf-8")
        self.assertIn("[1903]", document)
        self.assertIn("[proposed hearing]", document)
        # The leave-blank is no residual placeholder, but Form 32's conformance check reports
        # the missing proposed hearing. Nothing else is reported.
        self.assertIs(done["verify_passed"], False, done)
        self.assertEqual(done["verify_warnings"], [
            "Form 32: no proposed hearing date, date range or assize is stated; "
            "fill [proposed hearing] in Word."])

    def test_an_unfilled_template_token_warns_and_does_not_halt(self):
        context = {k: v for k, v in CONTEXT.items() if k != "court_file_number"}
        done = self.run_asm32(context)
        self.assertEqual(done["action"], "done", done)
        self.assertTrue(Path(done["output_path"]).is_file())
        self.assertIs(done["verify_passed"], False, done)
        self.assertIn("residual placeholder '[COURT FILE NUMBER]'", done["verify_warnings"])

    def test_a_malformed_form32_halts_at_validate(self):
        (self.case_data / "bcsc-form-substance" / "form-32.md").write_text(
            "## Part 2\n\n1. A fact.\n", encoding="utf-8")
        halt = self.run_asm32(CONTEXT)
        self.assertEqual(halt, {"action": "halt", "reason": "step_failed",
                                "step_id": "asm32.validate",
                                "error": "form-32.md must start with --- frontmatter"})


if __name__ == "__main__":
    unittest.main()
