"""Regression guard: every <w:rPr> a letter emits lists its children in CT_RPr order.

ECMA-376 17.3.2.28 defines run properties as a fixed sequence, not a set. Word accepts an
out-of-order rPr, so a violation ships silently and only surfaces in a stricter consumer --
another OOXML library, a validator, a future Word. The September 2026 letterhead-font change
left one such site behind: the enclosure/cc runs concatenated emphasis onto a size-bearing
prefix, giving rFonts, sz, szCs, i, iCs where the schema wants i and iCs before sz.

Run: python -m unittest discover -s .claude/skills/publish/tests
"""
from __future__ import annotations

import re
import tempfile
import unittest
import zipfile
from pathlib import Path

import support
import fill_general  # on sys.path via support

# The cc entry with an email and the italic body span are the sites that concatenate
# emphasis onto a prefix; the rest exercises the remaining run-property branches.
PAYLOAD = {
    "signer": "pe",
    "file_number": "9999.T002",
    "date": "September 6, 2026",
    "recipient": ["Test Recipient", "123 Any Street", "Vancouver, BC V6B 1A1"],
    "attention": "Test Attention",
    "delivery": "VIA EMAIL ONLY",
    "recipient_email": "test@example.com",
    "salutation": "Dear Test Recipient,",
    "re": ["Test matter"],
    "body": [
        "A **bold** span, an *italic* span and an __underlined__ span.",
        "- A hanging-indent bullet item.",
    ],
    "enclosures": ["Test enclosure", "A second enclosure"],
    "cc": ["Plain Recipient", {"name": "Named Recipient", "email": "cc@example.com"}],
}

RPR_BLOCK = re.compile(r"<w:rPr>(.*?)</w:rPr>", re.S)
CHILD = re.compile(r"<w:([A-Za-z]+)\b")


def child_names(block):
    return CHILD.findall(block)


class TestRprSerialiser(unittest.TestCase):
    """Unit-level: the serialiser sorts, regardless of what order the caller concatenated."""

    def test_emphasis_appended_to_a_size_prefix_is_reordered(self):
        small = fill_general.MINOR + '<w:sz w:val="16"/><w:szCs w:val="16"/>'
        out = fill_general.rpr(small + "<w:i/><w:iCs/>")
        inner = RPR_BLOCK.match(out).group(1)
        self.assertEqual(child_names(inner), ["rFonts", "i", "iCs", "sz", "szCs"])

    def test_already_ordered_input_is_unchanged(self):
        fragment = fill_general.MINOR + '<w:smallCaps/><w:sz w:val="28"/><w:lang w:val="en-CA"/>'
        self.assertEqual(fill_general.rpr(fragment), "<w:rPr>" + fragment + "</w:rPr>")

    def test_empty_fragment_yields_an_empty_rpr(self):
        self.assertEqual(fill_general.rpr(""), "<w:rPr></w:rPr>")

    def test_a_non_ctrpr_child_is_rejected(self):
        # <w:tab/> belongs in the run, not its properties -- misplacing it must fail loudly
        # rather than sort into some arbitrary position.
        with self.assertRaises(ValueError):
            fill_general.rpr(fill_general.MINOR + "<w:tab/>")

    def test_stray_text_is_rejected(self):
        with self.assertRaises(ValueError):
            fill_general.rpr(fill_general.MINOR + "leftover")


class TestGeneratedLetterRprOrder(unittest.TestCase):
    """End-to-end: no rPr anywhere in a real letter violates the sequence."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        tmp_path = Path(cls.tmp.name)
        out_path = support.render_synthetic(tmp_path, PAYLOAD)
        with zipfile.ZipFile(out_path) as z:
            cls.document_xml = z.read("word/document.xml").decode("utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_every_rpr_is_in_schema_order(self):
        blocks = RPR_BLOCK.findall(self.document_xml)
        self.assertTrue(blocks, "no <w:rPr> found -- test is vacuous")
        order = fill_general.RPR_ORDER
        for block in blocks:
            names = child_names(block)
            for name in names:
                self.assertIn(name, order, "w:%s is not a CT_RPr child" % name)
            indices = [order.index(name) for name in names]
            self.assertEqual(indices, sorted(indices),
                             "out of CT_RPr order: <w:rPr>%s</w:rPr>" % block)

    def test_the_italic_cc_email_run_carries_size_after_emphasis(self):
        # The specific site the September 2026 font change left behind. Pinned by name so a
        # regression here reports the cause rather than a generic ordering failure.
        self.assertIn("<w:rPr>" + fill_general.MINOR
                      + '<w:i/><w:iCs/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>',
                      self.document_xml)


if __name__ == "__main__":
    unittest.main()
