from __future__ import annotations

import re
import sys
import unittest
import zipfile
from pathlib import Path

from lxml import etree


SKILL_ROOT = Path(__file__).resolve().parents[1]
TEST_OUTPUT = SKILL_ROOT / "tests" / ".tmp-forms-17-8"
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import harness  # noqa: E402
from fill_plain import fill  # noqa: E402


W = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
GUID = re.compile(rb"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def package_text(path: Path, part: str = "word/document.xml") -> str:
    with zipfile.ZipFile(path) as package:
        root = etree.fromstring(package.read(part))
    return "".join(root.itertext())


def assert_well_formed(path: Path) -> None:
    """The .docx is an intact zip whose main part parses.

    Stands in for a python-docx `Document(path)` smoke call -- the 2026-08-05
    affidavit-form-split plan pins this skill to lxml plus the stdlib, and the
    import took all four tests in this file down wherever python-docx was
    absent.  Nothing here ever read an attribute off the Document.
    """
    with zipfile.ZipFile(path) as package:
        assert package.testzip() is None, f"{path.name} is not a well-formed zip"
        etree.fromstring(package.read("word/document.xml"))


class Form17And8Tests(unittest.TestCase):
    def test_registry_entries_are_generate_only(self) -> None:
        expected = {
            "form-17": ("templates/form-17.docx", "form-17"),
            "form-8": ("templates/form-8.docx", "form-8"),
        }
        for form_id, (template, fill_arg) in expected.items():
            spec = harness.REGISTRY[form_id]
            self.assertTrue(spec["generate_only"])
            self.assertEqual(spec["template"], template)
            self.assertEqual(spec["fill_form_arg"], fill_arg)
            self.assertTrue((SKILL_ROOT / template).is_file())

    def test_templates_are_sanitized_and_parseable(self) -> None:
        for filename in ("form-17.docx", "form-8.docx"):
            path = SKILL_ROOT / "templates" / filename
            assert_well_formed(path)
            with zipfile.ZipFile(path) as package:
                names = package.namelist()
                self.assertNotIn("docProps/custom.xml", names)
                self.assertFalse(any(name.startswith("customXml/") for name in names))
                self.assertFalse(any(name.startswith("word/webextensions/") for name in names))
                self.assertFalse(any(name.startswith("[trash]/") for name in names))
                payload = b"\n".join(package.read(name) for name in names)
                self.assertNotIn("\u200b".encode(), payload)
                self.assertIsNone(GUID.search(payload))

                core = etree.fromstring(package.read("docProps/core.xml"))
                values = {
                    etree.QName(element).localname: element.text or ""
                    for element in core.iter()
                }
                self.assertEqual(values.get("creator"), "")
                self.assertEqual(values.get("lastModifiedBy"), "")
                self.assertEqual(values.get("lastPrinted", ""), "")
                self.assertEqual(values.get("revision"), "1")

    def test_form17_dummy_fill(self) -> None:
        context = {
            "court_file_number": "S-123456",
            "registry": "Vancouver",
            "plaintiff_caption": "ALPHA COMPANY LTD.",
            "plaintiff_role": "PLAINTIFF",
            "defendant_caption": "BETA COMPANY LTD.",
            "defendant_role": "DEFENDANT",
            "filed_by": "the Plaintiff",
            "required_text": "Judgment in the terms supplied by the practitioner",
            "affidavit_description": "Affidavit # 1 of Jordan Example, made August 7, 2026.",
            "client_name": "Alpha Company Ltd.",
            "lawyer_name": "Alex Example",
        }
        TEST_OUTPUT.mkdir(exist_ok=True)
        output = TEST_OUTPUT / "form-17-filled.docx"
        self.addCleanup(output.unlink, missing_ok=True)
        fill(SKILL_ROOT / "templates/form-17.docx", context, "", output, form="form-17")
        assert_well_formed(output)
        text = package_text(output)
        self.assertIn("No. S-123456", text)
        self.assertIn("Filed by: the Plaintiff", text)
        self.assertIn(context["required_text"], text)
        self.assertIn(context["affidavit_description"], text)
        self.assertIn("Signature of lawyer for Alpha Company Ltd.", text)
        self.assertIn("Alex Example", text)

    def test_form8_dummy_fill(self) -> None:
        context = {
            "court_file_number": "S-123456",
            "registry": "Vancouver",
            "plaintiff_caption": "ALPHA COMPANY LTD.",
            "plaintiff_role": "PLAINTIFF",
            "defendant_caption": "BETA COMPANY LTD.",
            "defendant_role": "DEFENDANT",
            "amount": "$1,234.56",
            "lawyer_name": "Alex Example",
        }
        TEST_OUTPUT.mkdir(exist_ok=True)
        output = TEST_OUTPUT / "form-8-filled.docx"
        self.addCleanup(output.unlink, missing_ok=True)
        fill(SKILL_ROOT / "templates/form-8.docx", context, "", output, form="form-8")
        assert_well_formed(output)
        text = package_text(output)
        self.assertIn("Defendant, BETA COMPANY LTD., pay", text)
        self.assertIn("Defendant BETA COMPANY LTD. pay", text)
        self.assertIn("$1,234.56", text)
        self.assertIn("Date: ________________", text)
        self.assertNotIn("Last updated:", text)


if __name__ == "__main__":
    unittest.main()
