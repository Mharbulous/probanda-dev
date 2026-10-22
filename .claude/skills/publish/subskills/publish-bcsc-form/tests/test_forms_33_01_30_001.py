"""Forms 33.01 (Notice of Hearing of Application) and 30.001 (record cover)."""
from __future__ import annotations

import contextlib
import io
import sys
import unittest
import zipfile
from pathlib import Path

from lxml import etree


SKILL_ROOT = Path(__file__).resolve().parents[1]
TEST_OUTPUT = SKILL_ROOT / "tests" / ".tmp-forms-33-01-30-001"
sys.path.insert(0, str(SKILL_ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import harness  # noqa: E402
from fill_plain import fill  # noqa: E402
from test_forms_17_8 import GUID, assert_well_formed  # noqa: E402

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
CAPTION = {
    "court_file_number": "S-123456",
    "registry": "Vancouver",
    "plaintiff_caption": "ALPHA COMPANY LTD.",
    "plaintiff_role": "Plaintiff",
    "defendant_caption": "BETA COMPANY LTD.",
    "defendant_role": "Defendant",
}


def render(form: str, context: dict) -> list[str]:
    """Fill the form's template and return its paragraph texts."""
    TEST_OUTPUT.mkdir(exist_ok=True)
    output = TEST_OUTPUT / f"{form}.docx"
    with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
        fill(SKILL_ROOT / harness.REGISTRY[form]["template"], context, "", output,
             form=harness.REGISTRY[form]["fill_form_arg"])
    assert_well_formed(output)
    with zipfile.ZipFile(output) as package:
        root = etree.fromstring(package.read("word/document.xml"))
    output.unlink()
    return ["".join(t.text or "" for t in p.iter(f"{W}t")) for p in root.iter(f"{W}p")]


def checked(paragraphs: list[str]) -> list[str]:
    return [p for p in paragraphs if "☒" in p]


class RegistryAndTemplates(unittest.TestCase):
    def test_registry_entries_are_generate_only(self) -> None:
        for form in ("form-33.01", "form-30.001"):
            spec = harness.REGISTRY[form]
            self.assertTrue(spec["generate_only"])
            self.assertEqual(spec["fill_form_arg"], form)
            self.assertEqual(spec["template"], f"templates/{form}.docx")
            self.assertTrue((SKILL_ROOT / spec["template"]).is_file())

    def test_templates_are_sanitized_and_parseable(self) -> None:
        for form in ("form-33.01", "form-30.001"):
            path = SKILL_ROOT / "templates" / f"{form}.docx"
            assert_well_formed(path)
            with zipfile.ZipFile(path) as package:
                names = package.namelist()
                self.assertNotIn("docProps/custom.xml", names)
                self.assertFalse(any(n.startswith(("customXml/", "word/webextensions/", "[trash]/"))
                                     for n in names))
                payload = b"\n".join(package.read(n) for n in names)
                self.assertNotIn("​".encode(), payload)
                self.assertIsNone(GUID.search(payload))


class Form33_01(unittest.TestCase):
    def test_given_fields_fill_and_chosen_boxes_are_checked(self) -> None:
        paragraphs = render("form-33.01", {
            **CAPTION,
            "application_respondents": "Beta Company Ltd.",
            "applicant_parties": "Alpha Company Ltd.",
            "notice_dated": "October 14, 2026",
            "hearing_place": "800 Smithe Street, Vancouver, BC",
            "hearing_day": "November 3, 2026",
            "hearing_time": "9:45 a.m.",
            "notice_served_dates": "October 15, 2026",
            "no_response_time_expired": "yes",
            "hearing_date_basis": "unopposed",
            "agreed_time_estimate": "30 minutes",
            "associate_judge": "no",
            "final_order": "yes",
            "orders_sought": "Paragraphs 1 to 3",
            "signatory": "lawyer",
            "signatory_name": "Alex Example",
        })
        text = "\n".join(paragraphs)
        self.assertIn("No. S-123456", text)
        self.assertIn("ALPHA COMPANY LTD.", paragraphs)
        self.assertIn("To: Beta Company Ltd.", paragraphs)
        self.assertIn(
            "TAKE NOTICE that the notice of application of Alpha Company Ltd. dated "
            "October 14, 2026 will be heard at the courthouse at 800 Smithe Street, "
            "Vancouver, BC on November 3, 2026 at 9:45 a.m.", paragraphs)
        self.assertIn("The orders being sought are as set out in the Notice of "
                      "Application dated October 14, 2026:", paragraphs)
        self.assertIn("Paragraphs 1 to 3", paragraphs)
        self.assertIn("Alex Example", paragraphs)
        self.assertEqual(checked(paragraphs), [
            "☒The notice of application was served on October 15, 2026",
            "☒No application response has been served and the time to serve a "
            "response has expired.",
            "☒The application is unopposed, by consent or without notice.",
            "☒It has been agreed by the parties that the hearing will take 30 minutes.",
            "☒This matter is not within the jurisdiction of an associate judge.",
            "☒The application is seeking a final order.",
            "Signature of ☐ applicant ☒ lawyer for applicant(s)",
        ])
        # A box the context does not choose keeps its line and its blank.
        self.assertIn("☐The application response(s) was(were) served on [date(s)]",
                      paragraphs)

    def test_unagreed_duration_takes_each_side_as_given(self) -> None:
        paragraphs = render("form-33.01", {
            **CAPTION,
            "applicant_estimate_minutes": "45",
            "respondent_gave_no_estimate": "yes",
            "associate_judge": "yes",
            "signatory": "applicant",
        })
        self.assertIn("(a) the time estimate of the applicant(s) is 45 minutes, and",
                      paragraphs)
        self.assertEqual(checked(paragraphs), [
            "☒The parties have been unable to agree as to how long the hearing will take and",
            "☒the application respondent(s) has(ve) not given a time estimate.",
            "☒This matter is within the jurisdiction of an associate judge.",
            "Signature of ☒ applicant ☐ lawyer for applicant(s)",
        ])
        self.assertIn("(b) ☐the time estimate of the application respondent(s) is "
                      "_______ minutes.", paragraphs)

    def test_absent_fields_keep_the_forms_own_text(self) -> None:
        paragraphs = render("form-33.01", dict(CAPTION))
        self.assertEqual(checked(paragraphs), [])
        self.assertIn("To: [name(s) of application respondent(s), if any]", paragraphs)
        self.assertIn(
            "TAKE NOTICE that the notice of application of [party(ies)] dated [date] "
            "will be heard at the courthouse at [address] on [date] at [time of day].",
            paragraphs)
        self.assertIn("[set out paragraph numbers of orders from the Notice of Application "
                      "and any additional proposed terms sought by consent]", paragraphs)
        self.assertIn("[type or print name]", paragraphs)
        self.assertIn("Date: [mmmm d, yyyy]", paragraphs)

    def test_an_unknown_election_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            render("form-33.01", {**CAPTION, "hearing_date_basis": "maybe"})


class Form30_001(unittest.TestCase):
    def test_given_fields_fill_one_block_per_party(self) -> None:
        paragraphs = render("form-30.001", {
            **CAPTION,
            "record_type": "APPLICATION RECORD",
            "rule_reference": "(RULE 8-1 (15))",
            "parties": [
                {"name": "Alpha Company Ltd.", "counsel": "Alex Example",
                 "address": "123 Example Street", "contact": "604-555-0100"},
                {"name": "Beta Company Ltd.", "counsel": "",
                 "address": "456 Example Street", "contact": "beta@example.test"},
                {"name": "Charlie Example"},
            ],
            "appearance_type": "Hearing",
            "appearance_date_time": "November 3, 2026 at 9:45 a.m.",
            "appearance_place": "800 Smithe Street, Vancouver, BC",
            "plaintiff_time_estimate": "30 minutes",
            "heard_before": "associate_judge",
            "provided_by": "the Plaintiff",
        })
        self.assertIn("APPLICATION RECORD", paragraphs)
        self.assertIn("(RULE 8-1 (15))", paragraphs)
        for line in ("Alpha Company Ltd.", "Alex Example", "123 Example Street",
                     "604-555-0100", "Beta Company Ltd.", "beta@example.test",
                     "Charlie Example"):
            self.assertIn(line, paragraphs)
        # Charlie gave no counsel, address or contact, so those lines keep the
        # form's instruction once; Beta's empty counsel blanks its line.
        self.assertEqual(paragraphs.count("[name of counsel if applicable]"), 1)
        self.assertEqual(paragraphs.count("[address for delivery]"), 1)
        self.assertIn("Date and Time of Hearing: November 3, 2026 at 9:45 a.m.", paragraphs)
        self.assertIn("Place of Hearing: 800 Smithe Street, Vancouver, BC", paragraphs)
        self.assertIn("Time estimate of the Plaintiff: 30 minutes", paragraphs)
        self.assertIn("Time estimate of the Defendant: ________________", paragraphs)
        self.assertIn("To be heard before ☐ Judge ☒ Associate Judge ☐ Registrar", paragraphs)
        self.assertIn("Application Record provided by: the Plaintiff", paragraphs)
        self.assertFalse(any("[[" in p for p in paragraphs))

    def test_absent_fields_keep_the_forms_own_text(self) -> None:
        paragraphs = render("form-30.001", dict(CAPTION))
        self.assertIn("[TYPE OF RECORD]", paragraphs)
        self.assertEqual(paragraphs.count("[name of party]"), 2)
        self.assertIn("Date and Time of [indicate appearance type]: ________________", paragraphs)
        self.assertIn("To be heard before ☐ Judge ☐ Associate Judge ☐ Registrar", paragraphs)
        self.assertIn("[Type of Record] provided by: ________________", paragraphs)
        self.assertFalse(any("[[" in p for p in paragraphs))


if __name__ == "__main__":
    unittest.main()
