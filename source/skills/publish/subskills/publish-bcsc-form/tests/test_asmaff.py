"""Strict Form 109 fill from the emitted affidavit file (#1488).

drafting_forms__emit_affidavit (#1487) writes affidavit-<document_id>.md; the
asmaff operation parses it strictly and fills affidavit.dotx from it, so the
filed .docx carries the mockup's paragraphs, bold exhibit letters and
affidavit number, and the ordinal is never asked a second time.

Run: python -m pytest source/skills/publish/subskills/publish-bcsc-form/tests/test_asmaff.py -q
"""

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from lxml import etree

SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import harness  # noqa: E402
from fill_ooxml import WN, _para_text  # noqa: E402
from fill_plain import fill  # noqa: E402
from steps.asmaff import locate  # noqa: E402
from steps.asmaff.common import ordinal, parse_affidavit  # noqa: E402
from steps.gen import scalars as gen_scalars  # noqa: E402

# The emitter's golden, inlined so the test runs from a packaged copy too.
# test_matches_the_emitter_golden keeps the two in step in the repository.
EMITTED = """---
deponent: R. Deponent
affidavit_number: 1
exhibits: [{"letter":"A","label":"Invoice 1001","file_path":null},{"letter":"B","label":"First Amending Agreement","file_path":null}]
---

1. I am the bookkeeper of the plaintiff.
2. Attached hereto and marked as **Exhibit "A"** is a true copy of Invoice 1001, issued under the agreement attached as **Exhibit "B"**.
"""
GOLDEN = SKILL_ROOT.parents[4] / "source" / "practice" / "mcp" / "test" / "fixtures" / "affidavit-emitted.md"

CONTEXT = {
    "court_file_number": "S-123456",
    "registry": "Vancouver",
    "plaintiff_caption": "Alpha Ltd.",
    "plaintiff_role": "PLAINTIFF",
    "defendant_caption": "Beta Inc.",
    "defendant_role": "DEFENDANT",
    "deponent_address": "123 Main Street, Vancouver, BC",
    "deponent_occupation": "bookkeeper",
    "swear_or_affirm": "swear",
    "sworn_or_affirmed": "SWORN",
    "affidavit_date": "October 3, 2026",
    "commissioner_city": "Vancouver",
    "commissioner_name": "",
    "interpreter_required": "no",
}


def _write(folder: Path, text: str, document_id: int = 7) -> Path:
    substance = folder / "bcsc-form-substance"
    substance.mkdir(parents=True, exist_ok=True)
    path = substance / f"affidavit-{document_id}.md"
    path.write_text(text, encoding="utf-8")
    return path


class ParseTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def parse(self, text):
        return parse_affidavit(_write(self.dir, text))

    @unittest.skipUnless(GOLDEN.is_file(), "emitter golden is only in the repository")
    def test_matches_the_emitter_golden(self):
        self.assertEqual(GOLDEN.read_text(encoding="utf-8"), EMITTED)

    def test_parses_the_emitted_file(self):
        parsed = self.parse(EMITTED)
        self.assertEqual(parsed["deponent"], "R. Deponent")
        self.assertEqual(parsed["affidavit_number"], 1)
        self.assertEqual([e["letter"] for e in parsed["exhibits"]], ["A", "B"])
        self.assertEqual(parsed["paragraphs"], [
            "I am the bookkeeper of the plaintiff.",
            'Attached hereto and marked as **Exhibit "A"** is a true copy of '
            'Invoice 1001, issued under the agreement attached as **Exhibit "B"**.',
        ])

    def test_rejects(self):
        cases = {
            "missing key": EMITTED.replace("affidavit_number: 1\n", ""),
            "unknown key": EMITTED.replace("deponent:", "role: x\ndeponent:"),
            "number not a positive integer": EMITTED.replace("affidavit_number: 1", "affidavit_number: 0"),
            "empty deponent": EMITTED.replace("deponent: R. Deponent", "deponent: "),
            "numbering gap": EMITTED.replace("2. Attached", "3. Attached"),
            "no paragraphs": EMITTED.split("\n1. ")[0] + "\n",
            "stray bold": EMITTED.replace("the bookkeeper", "**the** bookkeeper"),
            "letter not listed": EMITTED.replace('**Exhibit "B"**', '**Exhibit "C"**'),
            "listed letter never placed": EMITTED.replace(', issued under the agreement attached as **Exhibit "B"**', ""),
            "letters out of order": EMITTED.replace('"letter":"A"', '"letter":"X"'),
            "no closing fence": EMITTED.replace("---\n\n1.", "\n1."),
        }
        for name, text in cases.items():
            with self.subTest(name), self.assertRaises(ValueError):
                self.parse(text)

    def test_ordinal(self):
        for n, want in ((1, "1st"), (2, "2nd"), (3, "3rd"), (4, "4th"), (11, "11th"),
                        (12, "12th"), (13, "13th"), (21, "21st"), (22, "22nd"), (111, "111th")):
            self.assertEqual(ordinal(n), want)


class FillTest(unittest.TestCase):
    """Fills the real template and reads the .docx back."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        parsed = parse_affidavit(_write(Path(tmp.name), EMITTED))
        context = dict(CONTEXT, deponent_name=parsed["deponent"],
                       affidavit_ordinal=ordinal(parsed["affidavit_number"]),
                       affidavit_paragraphs=parsed["paragraphs"])
        out = Path(tmp.name) / "out.docx"
        fill(SKILL_ROOT / "templates" / "affidavit.dotx", context, "", out, form="affidavit")
        with zipfile.ZipFile(out) as z:
            self.body = etree.fromstring(z.read("word/document.xml")).find(WN("body"))

    def numbered(self):
        """The LEAPBCParaNumL1 paragraphs before the jurat table."""
        found = []
        for child in self.body:
            if child.tag == WN("tbl"):
                break
            style = child.find(f"{WN('pPr')}/{WN('pStyle')}")
            if style is not None and style.get(WN("val")) == "LEAPBCParaNumL1":
                found.append(child)
        return found

    def test_carries_the_emitted_paragraphs_in_order(self):
        self.assertEqual([_para_text(p) for p in self.numbered()], [
            "I am the bookkeeper of the plaintiff.",
            'Attached hereto and marked as Exhibit "A" is a true copy of Invoice 1001, '
            'issued under the agreement attached as Exhibit "B".',
        ])

    def test_exhibit_references_are_bold_and_nothing_else_is(self):
        bold = [_para_text(r) for p in self.numbered() for r in p.iter(WN("r"))
                if r.find(f"{WN('rPr')}/{WN('b')}") is not None]
        self.assertEqual(bold, ['Exhibit "A"', 'Exhibit "B"'])

    def test_header_carries_the_affidavit_number_and_deponent(self):
        text = "\n".join(_para_text(p) for p in self.body.iter(WN("p")))
        self.assertIn("This is the 1st affidavit", text)
        self.assertIn("of R. Deponent in this case", text)
        self.assertIn("I, R. Deponent of 123 Main Street", text)

    def test_template_preamble_and_exhibit_block_do_not_survive(self):
        text = "\n".join(_para_text(p) for p in self.body.iter(WN("p")))
        for gone in ("hereinafter deposed", "[[BLOCK", "[[END-BLOCK", "[EXHIBIT", "to this my Affidavit"):
            self.assertNotIn(gone, text)

    def test_last_paragraph_keeps_with_the_jurat(self):
        last = self.numbered()[-1]
        self.assertIsNotNone(last.find(f"{WN('pPr')}/{WN('keepNext')}"))


class FillStepTest(unittest.TestCase):
    """asmaff.fill writes the .docx into the package's Writing folder."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.matter = root / "L1234 Alpha v Beta"
        (self.matter / "0. DRAFTS").mkdir(parents=True)
        self.ctx = {"matter_path": str(self.matter), "writing_folder": "NOA Stay",
                    "form_id": "affidavit", "scalars": dict(CONTEXT),
                    "affidavit": parse_affidavit(_write(root, EMITTED))}

    def test_names_the_docx_by_number_and_deponent(self):
        from steps.asmaff import fill as asmaff_fill
        asmaff_fill.calls_script(self.ctx)
        out = Path(self.ctx["output_path"])
        self.assertEqual(out, self.matter / "0. DRAFTS" / "NOA Stay" / "Affidavit #1 of R. Deponent.docx")
        with zipfile.ZipFile(out) as z:
            body = etree.fromstring(z.read("word/document.xml")).find(WN("body"))
        text = "\n".join(_para_text(p) for p in body.iter(WN("p")))
        self.assertIn("of R. Deponent in this case", text)
        self.assertIn("I am the bookkeeper of the plaintiff.", text)

    def test_refuses_a_deponent_name_unfit_for_a_file_name(self):
        from steps.asmaff import fill as asmaff_fill
        self.ctx["affidavit"]["deponent"] = "A/B Holdings"
        with self.assertRaises(RuntimeError):
            asmaff_fill.calls_script(self.ctx)


class HarnessTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.case_data = Path(tmp.name)
        self._dir = harness.SESSIONS_DIR
        harness.SESSIONS_DIR = self.case_data / "form-sessions"
        self.addCleanup(setattr, harness, "SESSIONS_DIR", self._dir)
        harness.load_all_steps()

    def init(self, request):
        return harness.cmd_init(request, case_data_folder=str(self.case_data),
                                writing_folder="NOA Stay")

    def test_token_starts_the_strict_sequence_and_locates_in_process(self):
        _write(self.case_data, EMITTED)
        action = self.init("asmaff 7")
        # asmaff.locate is computed, so the first subagent step is the profile.
        self.assertEqual(action["action"], "spawn_subagent")
        self.assertEqual(action["step_id"], "gen.matter_profile")
        ctx = harness.load_ctx(action["session_id"])
        self.assertEqual((ctx["form_id"], ctx["sequence"], ctx["affidavit_document_id"]),
                         ("affidavit", "asmaff", 7))
        self.assertEqual(ctx["affidavit"]["affidavit_number"], 1)

    def test_missing_file_halts_naming_the_emitter(self):
        action = self.init("asmaff 7")
        self.assertEqual(action["action"], "halt")
        self.assertIn("affidavit-7.md", action["error"])
        self.assertIn("emit_affidavit", action["error"])

    def test_malformed_file_halts_with_the_parse_error(self):
        _write(self.case_data, EMITTED.replace("2. Attached", "3. Attached"))
        action = self.init("asmaff 7")
        self.assertEqual(action["action"], "halt")
        self.assertIn("expected 2", action["error"])

    def test_unset_case_data_folder_halts_saying_so(self):
        action = harness.cmd_init("asmaff 7", writing_folder="NOA Stay")
        self.assertEqual(action["action"], "halt")
        self.assertIn("--matter-data-folder", action["error"])

    def test_token_without_a_document_id_halts(self):
        action = self.init("asmaff")
        self.assertEqual(action["action"], "halt")

    def test_locate_stores_the_parsed_file(self):
        path = _write(self.case_data, EMITTED)
        ctx = harness.load_ctx(self.init("asmaff 7")["session_id"])
        ctx = locate.apply(ctx, json.loads(locate.build_prompt(ctx))["data"])
        self.assertEqual(ctx["affidavit_path"], str(path))
        self.assertEqual(ctx["affidavit"]["affidavit_number"], 1)

    def test_scalars_never_ask_for_the_deponent_or_ordinal(self):
        keys = [k for k, _ in gen_scalars._fields_for({"form_id": "affidavit", "operation": "asmaff"})]
        self.assertNotIn("affidavit_ordinal", keys)
        self.assertNotIn("deponent_name", keys)
        self.assertIn("deponent_address", keys)
        generate = [k for k, _ in gen_scalars._fields_for({"form_id": "affidavit"})]
        self.assertIn("affidavit_ordinal", generate)

    def test_verify_runs_under_assemble_rules(self):
        self.assertIn("asmaff.fill", harness.ASSEMBLY_FILLS)
        self.assertEqual(harness.SEQUENCES["asmaff"][-2:], ["asmaff.fill", "shared.verify"])


if __name__ == "__main__":
    unittest.main()
