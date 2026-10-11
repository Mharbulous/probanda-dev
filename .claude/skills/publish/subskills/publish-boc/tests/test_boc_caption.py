from __future__ import annotations

import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from lxml import etree


SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

from fill_boc import fill as fill_boc  # noqa: E402


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W, "r": R}


def _paragraph_texts(document: etree._Element) -> list[str]:
    return [
        "".join(node.text or "" for node in paragraph.iter(f"{{{W}}}t")).strip()
        for paragraph in document.findall(".//w:p", NS)
    ]


class BillOfCostsCaptionTest(unittest.TestCase):
    def test_bill_of_costs_renders_the_caption_contract(self) -> None:
        context = {
            "court_file_number": "S-123456",
            "registry": "Vancouver",
            "originating_party": "ALPHA COMPANY LTD.",
            "originating_party_role": "Plaintiff",
            "responding_party": "BETA COMPANY LTD.",
            "responding_party_role": "Defendant",
            "party_claiming_costs": "Alpha Company Ltd.",
            "tariff_items": [],
        }
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "form-62.docx"
            fill_boc(context, output)
            with zipfile.ZipFile(output) as package:
                paragraphs = _paragraph_texts(
                    etree.fromstring(package.read("word/document.xml"))
                )
                package_bytes = b"\n".join(
                    package.read(name) for name in package.namelist()
                )
        for expected in (
            "In the Supreme Court of British Columbia",
            "Between",
            "Plaintiff",
            "and",
            "Defendant",
        ):
            self.assertIn(expected, paragraphs)
        self.assertNotIn(b"\\textcolor", package_bytes)
        self.assertNotIn(b"\\sout", package_bytes)


if __name__ == "__main__":
    unittest.main()
