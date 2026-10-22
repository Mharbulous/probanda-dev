from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from lxml import etree


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from steps.gen import matter_profile  # noqa: E402
import harness  # noqa: E402
import fill_plain  # noqa: E402
from fill_plain import _join_party_names, fill  # noqa: E402


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W, "r": R}
TEMPLATES = tuple(sorted((SKILL_ROOT / "templates").iterdir()))


def _paragraph_texts(document: etree._Element) -> list[str]:
    return [
        "".join(node.text or "" for node in paragraph.iter(f"{{{W}}}t")).strip()
        for paragraph in document.findall(".//w:p", NS)
    ]


VISIBLE_RUN_PROPERTIES = (
    "b", "i", "u", "caps", "smallCaps", "strike", "sz", "color", "highlight",
)


def _justification(paragraph: etree._Element) -> str:
    node = paragraph.find("w:pPr/w:jc", NS)
    return "left" if node is None else node.get(f"{{{W}}}val")


def _visible_run_formatting(paragraph: etree._Element) -> list[tuple[str, object]]:
    """Character formatting a reader can see, in document order.

    ``szCs`` is excluded because it sizes complex-script runs only. The Form 33
    responding trio carries a paragraph-mark ``szCs=20`` that the originating
    trio lacks, a leftover of the hand patch that cannot show on a Latin-script
    caption.
    """
    return [
        (etree.QName(node).localname, node.get(f"{{{W}}}val"))
        for run in paragraph.findall(".//w:r", NS)
        for node in run.findall("w:rPr/*", NS)
        if etree.QName(node).localname in VISIBLE_RUN_PROPERTIES
    ]


def _header_contract(path: Path) -> tuple[bool, list[dict[str, object]]]:
    with zipfile.ZipFile(path) as package:
        document = etree.fromstring(package.read("word/document.xml"))
        relationships = etree.fromstring(
            package.read("word/_rels/document.xml.rels")
        )
        section = document.find(".//w:sectPr", NS)
        if section is None:
            return False, []
        title_page = section.find("w:titlePg", NS) is not None
        references = []
        for reference in section.findall("w:headerReference", NS):
            relationship_id = reference.get(f"{{{R}}}id")
            relationship = relationships.xpath(
                ".//*[local-name()='Relationship' and @Id=$relationship_id]",
                relationship_id=relationship_id,
            )
            target = relationship[0].get("Target")
            part = "word/" + target.replace("\\", "/").removeprefix("../")
            header = etree.fromstring(package.read(part))
            paragraphs = header.findall(".//w:p", NS)
            references.append(
                {
                    "type": reference.get(f"{{{W}}}type"),
                    "text": "".join(header.itertext()).strip(),
                    "alignments": [
                        alignment.get(f"{{{W}}}val")
                        for paragraph in paragraphs
                        for alignment in paragraph.findall("./w:pPr/w:jc", NS)
                    ],
                }
            )
    return title_page, references


def _confirmed_context(groups: list[dict]) -> tuple[dict, str]:
    context = {
        "profile": {
            "matter_metadata": {},
            "proceedings": [
                {
                    "court": "Supreme Court of British Columbia",
                    "registry": "Vancouver",
                    "file_number": "S-123456",
                    "courthouse_address": "800 Smithe Street",
                    "valid_role_groups": groups,
                    "correction_required": [],
                }
            ],
        },
        "step_answers": ["yes"],
    }
    warnings = io.StringIO()
    with contextlib.redirect_stderr(warnings):
        prompt = matter_profile.build_prompt(context)
    match = re.search(
        r"Return the confirmed profile data:\n(\{.*\})\n\n## Constraints",
        prompt,
        re.DOTALL,
    )
    if match is None:
        raise AssertionError(f"confirmed prompt did not contain JSON: {prompt}")
    return json.loads(match.group(1))["data"]["context_fields"], warnings.getvalue()


def _group(role: str, label: str, *parties: tuple[int, str]) -> dict:
    return {
        "role": role,
        "role_label": label,
        "parties": [
            {"party_id": party_id, "name": name}
            for party_id, name in parties
        ],
    }


RENDER_CONTEXT = {
    "correction_required": [],
    "court_file_number": "S-123456",
    "registry": "Vancouver",
    "court_location": "800 Smithe Street",
    "plaintiff_caption": "ALPHA COMPANY LTD.",
    "plaintiff_role": "Plaintiff",
    "defendant_caption": "BETA COMPANY LTD.",
    "defendant_role": "Defendant",
    "additional_captions": [
        {"caption": "CHARLIE EXAMPLE", "role_label": "Third party"}
    ],
    "applicant_names": "Alpha Company Ltd.",
    "to_affected_parties": "Beta Company Ltd.",
    "proposed_hearing": "August 20, 2026",
    "duration_hours": "1",
    "duration_minutes": "0",
    "client_name": "Alpha Company Ltd.",
    "lawyer_name": "Alex Example",
    "firm_address": "123 Example Street",
    "firm_email": "alex@example.test",
    "firm_fax": "604-555-0100",
    "client_address": "123 Example Street",
    "client_email": "client@example.test",
    "client_fax": "604-555-0101",
    "lawyer_details": "Alex Example, 123 Example Street",
    "respondent_name_and_address": "Beta Company Ltd., 456 Example Street",
    "proceeding_brought_by": "the petitioner",
    "parties_description": "Beta Company Ltd.",
    "filed_by": "the Plaintiff",
    "required_text": "An order in the terms supplied",
    "affidavit_description": "Affidavit # 1 of Jordan Example, made August 7, 2026.",
    "amount": "$1,234.56",
    "notice_dated": "August 1, 2026",
    "hearing_date": "The application respondent(s) agree to the applicant's hearing date of August 20, 2026.",
    "time_estimate": "one hour",
    "opposed_order_numbers": "1",
    "no_position_order_numbers": "2",
    "deponent_name": "Jordan Example",
    "deponent_address": "789 Example Street",
    "deponent_occupation": "Legal assistant",
    "swear_or_affirm": "affirm",
    "sworn_or_affirmed": "AFFIRMED",
    "affidavit_date": "August 7, 2026",
    "affidavit_ordinal": "first",
    "commissioner_city": "Vancouver",
    "person_served": "Beta Company Ltd.",
    "service_date": "August 6, 2026",
    "service_time": "2:00 p.m.",
    "service_city": "Vancouver",
    "service_method": "email",
    "service_email": "service@example.test",
    "service_address": "456 Example Street",
    "filed_documents": [
        {"description": "Notice of Civil Claim", "stamp_date": "August 1, 2026"}
    ],
    "unfiled_documents": [],
}


class CaptionContractTests(unittest.TestCase):
    def test_all_template_captions_use_prescribed_case_and_no_colons(self) -> None:
        self.assertEqual(11, len(TEMPLATES))
        for path in TEMPLATES:
            with self.subTest(template=path.name), zipfile.ZipFile(path) as package:
                document = etree.fromstring(package.read("word/document.xml"))
                paragraphs = _paragraph_texts(document)
                self.assertTrue(
                    any(
                        value.startswith("In the Supreme Court of British Columbia")
                        for value in paragraphs
                    )
                )
                if any(value in paragraphs for value in ("BETWEEN", "Between")):
                    self.assertIn("Between", paragraphs)
                    self.assertIn("and", paragraphs)
                self.assertNotIn("BETWEEN:", paragraphs)
                self.assertNotIn("AND:", paragraphs)
                self.assertNotIn("PLAINTIFF", paragraphs)
                self.assertNotIn("DEFENDANT(S)", paragraphs)

    def test_templates_with_form_number_headers_are_first_page_only_and_centred(self) -> None:
        for path in TEMPLATES:
            with self.subTest(template=path.name):
                title_page, references = _header_contract(path)
                non_empty = [reference for reference in references if reference["text"]]
                if not non_empty:
                    continue
                first = [reference for reference in non_empty if reference["type"] == "first"]
                default = [
                    reference for reference in references
                    if reference["type"] == "default"
                ]
                self.assertTrue(title_page)
                self.assertEqual(1, len(non_empty))
                self.assertEqual(1, len(first))
                self.assertTrue(all(not reference["text"] for reference in default))
                self.assertIn("center", first[0]["alignments"])

    def test_every_registered_plain_form_renders_the_caption_contract(self) -> None:
        context = dict(RENDER_CONTEXT)
        with tempfile.TemporaryDirectory() as temporary:
            for form_id, spec in harness.REGISTRY.items():
                if spec["fill_script"] != "fill_plain.py":
                    continue
                form_context = dict(context)
                if spec["fill_form_arg"] == "petition":
                    form_context["plaintiff_role"] = "Petitioner"
                    form_context["defendant_role"] = "Respondent"
                output = Path(temporary) / f"{form_id}.docx"
                fill(
                    SKILL_ROOT / spec["template"],
                    form_context,
                    "",
                    output,
                    form=spec["fill_form_arg"],
                )
                with self.subTest(form=form_id), zipfile.ZipFile(output) as package:
                    document = etree.fromstring(package.read("word/document.xml"))
                    paragraphs = _paragraph_texts(document)
                    self.assertTrue(
                        any(
                            value.startswith("In the Supreme Court of British Columbia")
                            for value in paragraphs
                        )
                    )
                    self.assertFalse(
                        any("IN THE SUPREME COURT OF BRITISH COLUMBIA" in value for value in paragraphs)
                    )
                    if spec["fill_form_arg"] == "form-33":
                        self.assertIn("Between", paragraphs)
                        self.assertIn("and", paragraphs)
                    elif "Between" in paragraphs:
                        self.assertIn("and", paragraphs)
                    if spec["fill_form_arg"] == "nocc":
                        self.assertIn("Plaintiff", paragraphs)
                        self.assertIn("Defendant(s)", paragraphs)
                    elif spec["fill_form_arg"] == "petition":
                        self.assertIn("Petitioner", paragraphs)
                        self.assertIn("Respondent", paragraphs)
                    else:
                        self.assertIn("Plaintiff", paragraphs)
                        self.assertIn("Defendant", paragraphs)
                    package_bytes = b"\n".join(
                        package.read(name) for name in package.namelist()
                    )
                    self.assertNotIn(b"\\textcolor", package_bytes)
                    self.assertNotIn(b"\\sout", package_bytes)

                with self.subTest(form=form_id, captions="additional"):
                    self.assertIn("CHARLIE EXAMPLE", paragraphs)
                    self.assertIn("Third party", paragraphs)
                    self.assertGreaterEqual(paragraphs.count("and"), 2)

    def _render_noa(self, context: dict, directory: str) -> list[str]:
        spec = harness.REGISTRY["form-32"]
        output = Path(directory) / "form-32.docx"
        fill(SKILL_ROOT / spec["template"], context, "", output,
             form=spec["fill_form_arg"])
        with zipfile.ZipFile(output) as package:
            return _paragraph_texts(etree.fromstring(package.read("word/document.xml")))

    def test_additional_captions_that_cannot_be_placed_raise(self) -> None:
        """Both failure paths are loud: a form with no anchor registered, and
        an anchor its template does not carry. A party dropped from a filed
        style of cause is too expensive to lose silently."""
        context = dict(RENDER_CONTEXT)
        with tempfile.TemporaryDirectory() as temporary:
            anchors = dict(fill_plain.FORM_CAPTION_ROLE_ANCHORS)

            missing_entry = {k: v for k, v in anchors.items() if k != "noa"}
            with patch.dict(fill_plain.FORM_CAPTION_ROLE_ANCHORS,
                            missing_entry, clear=True):
                with self.assertRaises(ValueError) as caught:
                    self._render_noa(context, temporary)
            self.assertIn("no caption role anchor registered", str(caught.exception))

            with patch.dict(fill_plain.FORM_CAPTION_ROLE_ANCHORS,
                            {"noa": "[NOT IN THIS TEMPLATE]"}):
                with self.assertRaises(ValueError) as caught:
                    self._render_noa(context, temporary)
            self.assertIn("was not found", str(caught.exception))

    def test_empty_additional_captions_renders_unchanged(self) -> None:
        """An empty list stays a no-op: the trio is exactly what the
        additional party adds, and nothing else moves."""
        with tempfile.TemporaryDirectory() as temporary:
            without = self._render_noa(
                dict(RENDER_CONTEXT, additional_captions=[]), temporary)
            with_party = self._render_noa(dict(RENDER_CONTEXT), temporary)
        self.assertNotIn("CHARLIE EXAMPLE", without)
        self.assertNotIn("Third party", without)
        self.assertIn("Plaintiff", without)
        self.assertIn("Defendant", without)
        self.assertEqual(len(with_party), len(without) + 3)

    def test_existing_party_counterclaim_group_is_suppressed_with_rule_warning(self) -> None:
        fields, warning = _confirmed_context(
            [
                _group("plaintiff", "PLAINTIFF", (1, "Alice Example")),
                _group("defendant", "DEFENDANTS", (2, "Beta Ltd.")),
                _group(
                    "defendant_by_counterclaim",
                    "DEFENDANT BY WAY OF COUNTERCLAIM",
                    (1, "Alice Example"),
                ),
            ]
        )
        self.assertEqual("Plaintiff", fields["plaintiff_role"])
        self.assertEqual("Defendants", fields["defendant_role"])
        self.assertEqual([], fields["additional_captions"])
        self.assertIn("Rule 3-4(3)", warning)

    def test_form33_template_carries_its_caption_tokens(self) -> None:
        """A leftover-token check passes when a token is absent rather than
        unfilled, so the caption block needs a presence check of its own."""
        with zipfile.ZipFile(SKILL_ROOT / "templates" / "form-33.dotx") as package:
            text = "".join(
                "".join(
                    node.text or ""
                    for node in etree.fromstring(package.read(name)).iter(f"{{{W}}}t")
                )
                for name in package.namelist()
                if name.startswith("word/") and name.endswith(".xml")
            )
        for token in (
            "[CAPTION ORIGINATING PARTY]",
            "[ORIGINATING PARTY]",
            "[CAPTION RESPONDING PARTY]",
            "[RESPONDING PARTY]",
        ):
            self.assertIn(token, text)

    def test_party_names_join_as_a_prose_list_with_a_lower_case_and(self) -> None:
        """A role group's parties run together in one paragraph.

        The serial comma applies at every count, including two. The separator
        is a lower-case literal and is never derived from a name, so a party
        whose own name contains AND keeps it upper case -- the one case where
        a naive title-casing or uppercasing join would corrupt a filed caption.
        """
        self.assertEqual("", _join_party_names([]))
        self.assertEqual("ALICE EXAMPLE", _join_party_names(["ALICE EXAMPLE"]))
        self.assertEqual(
            "ALICE EXAMPLE, and ALEX EXAMPLE",
            _join_party_names(["ALICE EXAMPLE", "ALEX EXAMPLE"]),
        )
        self.assertEqual(
            "BETA COMPANY LTD., CHARLIE EXAMPLE, and DELTA HOLDINGS INC.",
            _join_party_names(
                ["BETA COMPANY LTD.", "CHARLIE EXAMPLE", "DELTA HOLDINGS INC."]
            ),
        )
        self.assertEqual(
            "SMITH AND SONS LTD., and BETA LTD.",
            _join_party_names(["SMITH AND SONS LTD.", "BETA LTD."]),
        )

    def test_form33_caption_block_is_formatted_uniformly(self) -> None:
        """The caption was written back into the empty paragraph shells the LEAP
        conversion left behind, so the originating and responding trios could
        drift apart in formatting while every text-level assertion still passed.

        Fidelity to the prescribed arrangement is the practitioner's call and no
        test can make it. What a test can hold is that the two trios agree slot
        for slot, and that a rendered names paragraph carries the symmetric
        indent and no character formatting of its own -- so one human look at
        one rendering generalises to other party counts.
        """
        with zipfile.ZipFile(SKILL_ROOT / "templates" / "form-33.dotx") as package:
            template = etree.fromstring(package.read("word/document.xml"))
        paragraphs = template.findall(".//w:p", NS)
        texts = _paragraph_texts(template)
        start = texts.index("Between")
        self.assertEqual(
            [
                "Between",
                "[CAPTION ORIGINATING PARTY]",
                "[ORIGINATING PARTY]",
                "and",
                "[CAPTION RESPONDING PARTY]",
                "[RESPONDING PARTY]",
            ],
            texts[start:start + 6],
        )
        block = paragraphs[start:start + 6]
        for offset, slot in enumerate(("anchor word", "party names", "role label")):
            with self.subTest(slot=slot):
                self.assertEqual(
                    _justification(block[offset]),
                    _justification(block[offset + 3]),
                )
                self.assertEqual(
                    _visible_run_formatting(block[offset]),
                    _visible_run_formatting(block[offset + 3]),
                )

        context = {
            "court_file_number": "S-123456",
            "registry": "Vancouver",
            "plaintiff_caption": "ALICE EXAMPLE\nALEX EXAMPLE",
            "plaintiff_role": "Plaintiffs",
            "defendant_caption": "BETA COMPANY LTD.\nCHARLIE EXAMPLE",
            "defendant_role": "Defendants",
            "client_name": "Alice Example",
            "lawyer_name": "Jordan Lawyer",
        }
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "form-33.docx"
            fill(
                SKILL_ROOT / "templates" / "form-33.dotx",
                context,
                "",
                output,
                form="form-33",
            )
            with zipfile.ZipFile(output) as package:
                rendered = etree.fromstring(package.read("word/document.xml"))
        rendered_paragraphs = rendered.findall(".//w:p", NS)
        rendered_texts = _paragraph_texts(rendered)
        start = rendered_texts.index("Between")
        self.assertEqual(
            [
                "Between",
                "ALICE EXAMPLE, and ALEX EXAMPLE",
                "Plaintiffs",
                "and",
                "BETA COMPANY LTD., and CHARLIE EXAMPLE",
                "Defendants",
            ],
            rendered_texts[start:start + 6],
        )
        caption = rendered_paragraphs[start:start + 6]
        for index in (1, 4):
            with self.subTest(paragraph=rendered_texts[start + index]):
                self.assertEqual("center", _justification(caption[index]))
                self.assertEqual([], _visible_run_formatting(caption[index]))
                indent = caption[index].find("w:pPr/w:ind", NS)
                self.assertIsNotNone(indent, "names paragraph is not indented")
                # Symmetric, or centring shifts off the page centre.
                self.assertEqual(
                    indent.get(f"{{{W}}}left"), indent.get(f"{{{W}}}right")
                )
        for index in (2, 5):
            with self.subTest(paragraph=rendered_texts[start + index]):
                self.assertEqual("right", _justification(caption[index]))

    def test_form33_preserves_count_aware_sentence_case_role(self) -> None:
        context = {
            "court_file_number": "S-123456",
            "registry": "Vancouver",
            "plaintiff_caption": "ALICE EXAMPLE\nALEX EXAMPLE",
            "plaintiff_role": "Plaintiffs",
            "defendant_caption": "BETA COMPANY LTD.",
            "defendant_role": "Defendant",
            "client_name": "Alice Example",
            "lawyer_name": "Jordan Lawyer",
        }
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "form-33.docx"
            fill(
                SKILL_ROOT / "templates" / "form-33.dotx",
                context,
                "",
                output,
                form="form-33",
            )
            with zipfile.ZipFile(output) as package:
                paragraphs = _paragraph_texts(
                    etree.fromstring(package.read("word/document.xml"))
                )
        self.assertIn("Signature of lawyer for the Plaintiffs", paragraphs)
        self.assertFalse(any("PlaintiffsS" in value for value in paragraphs))

    def test_nonparty_counterclaim_group_renders_with_rule_label(self) -> None:
        fields, warning = _confirmed_context(
            [
                _group("plaintiff", "PLAINTIFF", (1, "Alice Example")),
                _group("defendant", "DEFENDANT", (2, "Beta Ltd.")),
                _group(
                    "defendant_by_counterclaim",
                    "DEFENDANT BY WAY OF COUNTERCLAIM",
                    (3, "Charlie Example"),
                ),
            ]
        )
        self.assertEqual(
            [
                {
                    "caption": "CHARLIE EXAMPLE",
                    "role_label": "Defendant by way of counterclaim",
                }
            ],
            fields["additional_captions"],
        )
        self.assertEqual("", warning)

    def test_mixed_counterclaim_group_keeps_only_the_nonparty(self) -> None:
        fields, warning = _confirmed_context(
            [
                _group("plaintiff", "PLAINTIFF", (1, "Alice Example")),
                _group("defendant", "DEFENDANT", (2, "Beta Ltd.")),
                _group(
                    "defendant_by_counterclaim",
                    "DEFENDANTS BY WAY OF COUNTERCLAIM",
                    (1, "Alice Example"),
                    (3, "Charlie Example"),
                ),
            ]
        )
        self.assertEqual(
            [
                {
                    "caption": "CHARLIE EXAMPLE",
                    "role_label": "Defendant by way of counterclaim",
                }
            ],
            fields["additional_captions"],
        )
        self.assertIn("Rule 3-4(3)", warning)

    def test_third_party_group_is_unchanged_except_prescribed_case(self) -> None:
        fields, warning = _confirmed_context(
            [
                _group("plaintiff", "PLAINTIFF", (1, "Alice Example")),
                _group("defendant", "DEFENDANT", (2, "Beta Ltd.")),
                _group("third_party", "THIRD PARTY", (2, "Beta Ltd.")),
            ]
        )
        self.assertEqual(
            [{"caption": "BETA LTD.", "role_label": "Third party"}],
            fields["additional_captions"],
        )
        self.assertEqual("", warning)


if __name__ == "__main__":
    unittest.main()
