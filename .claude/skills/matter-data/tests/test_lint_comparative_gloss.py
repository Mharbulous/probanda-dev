import contextlib
import hashlib
import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
TEST_TMP = CASE_DATA_ROOT.parents[2] / ".test-tmp"
TEST_TMP.mkdir(exist_ok=True)
SCRIPTS = CASE_DATA_ROOT / "references" / "scripts"

sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location("lint_comparative_gloss", SCRIPTS / "lint_comparative_gloss.py")
lint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lint)

BSL = bytes([92])

# A Westlaw-style RTF: a bare field instruction whose URL carries a comparative,
# a \fldrslt case name, and \uN characters each followed by a \'3f fallback.
WESTLAW_RTF = (
    rb"{\rtf1\ansi\ansicpg1252\uc1{\fonttbl{\f0 Times;}}"
    rb"{\field{\*\fldinst HYPERLINK "
    rb'"https://nextcanada.westlaw.com/stricter?x=1" }'
    rb"{\fldrslt Smith v. Jones}} held " + BSL + b"u8220" + rb"\'3fsomewhat different"
    + BSL + b"u8221" + rb"\'3f.\par}"
)
MALFORMED_RTF = rb"{\rtf1\ansi{\fonttbl{\f0 Times;}} an unclosed group"


class ExtractRtfTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)
        self.dir = Path(self.tempdir.name)

    def tearDown(self):
        self.tempdir.cleanup()

    def write(self, name, data):
        path = self.dir / name
        path.write_bytes(data)
        return str(path)

    def test_westlaw_rtf_yields_the_judgment_text_only(self):
        text, status = lint.extract(self.write("judgment.doc", WESTLAW_RTF))
        self.assertIsNone(status)
        self.assertIn("Smith v. Jones", text)
        self.assertIn("“somewhat different”", text)
        for leak in ("HYPERLINK", "westlaw.com", "https://", "*", "?"):
            self.assertNotIn(leak, text)

    def test_comparative_inside_a_field_instruction_is_not_in_the_source(self):
        text, _ = lint.extract(self.write("judgment.doc", WESTLAW_RTF))
        tokens, _ = lint.norm_tokens(text)
        self.assertNotIn("stricter", tokens)

    def test_malformed_rtf_is_a_non_ok_status_not_a_traceback(self):
        text, status = lint.extract(self.write("broken.rtf", MALFORMED_RTF))
        self.assertIsNone(text)
        self.assertEqual(status, "SOURCE_UNREADABLE")

    def test_private_reader_is_gone(self):
        self.assertFalse(hasattr(lint, "rtf_to_text"))


class LintReportTests(unittest.TestCase):
    """main() end to end over a minimal law.sqlite, the pointer resolver stubbed."""

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)
        self.root = Path(self.tempdir.name)
        self.case_dir = self.root / "0. CASE DATA"
        self.case_dir.mkdir()

    def tearDown(self):
        self.tempdir.cleanup()

    def run_lint(self, sources):
        """sources: [(file name, bytes)], one authority and one edge per source."""
        con = sqlite3.connect(self.case_dir / "law.sqlite")
        con.execute("CREATE TABLE authorities (authority_id INTEGER PRIMARY KEY, title TEXT, "
                    "file_path TEXT, file_hash TEXT)")
        con.execute("CREATE TABLE concept_authorities (concept_id INTEGER, authority_id INTEGER, "
                    "proposition TEXT, finding TEXT, verified INTEGER)")
        for aid, (name, data) in enumerate(sources, start=1):
            (self.root / name).write_bytes(data)
            con.execute("INSERT INTO authorities VALUES (?, ?, ?, ?)",
                        (aid, name, name, hashlib.sha256(data).hexdigest()))
            con.execute("INSERT INTO concept_authorities VALUES (1, ?, ?, NULL, 0)",
                        (aid, "The court applied the stricter standard."))
        con.commit()
        con.close()
        out = io.StringIO()
        with mock.patch.object(lint, "resolve_pointer", return_value={"case_data_dir": str(self.case_dir)}), \
             mock.patch.object(sys, "argv", ["lint", str(self.root), "--json"]), \
             contextlib.redirect_stdout(out):
            lint.main()
        return json.loads(out.getvalue())

    def test_comparative_only_in_a_field_instruction_is_flagged(self):
        report = self.run_lint([("judgment.doc", WESTLAW_RTF)])
        self.assertEqual([f["term"] for f in report["findings"]], ["stricter"])

    def test_unreadable_rtf_is_counted_and_its_edges_are_not_examined(self):
        report = self.run_lint([("judgment.doc", WESTLAW_RTF), ("broken.rtf", MALFORMED_RTF)])
        self.assertEqual(report["authorities"]["2"]["status"], "SOURCE_UNREADABLE")
        self.assertEqual(report["summary"]["sources_unreadable"], 1)
        self.assertEqual([f["authority_id"] for f in report["findings"]], [1])


if __name__ == "__main__":
    unittest.main()
