"""publish-general's fill: fill_general.py's CLI against saved tool responses.

While a cited item of the format file reads unconfirmed, only the review copy is written:
its body's first paragraph carries the warning and every header and footer part is the
deliverable's. The deliverable is refused, naming the rule_ref, and is written once the
item reads confirmed. A letterhead render reports overridden_by_letterhead once. Output is
named from --out-name, and a taken name gets the next " vN": nothing is ever overwritten.

Run: python -m unittest discover -s .claude/skills/publish/tests
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import support
from support import LAWYER, STAFF, W

FILL_GENERAL = support.PUBLISH_ROOT / "subskills" / "publish-general" / "scripts" / "fill_general.py"
PATH = "publish/CAN/BC/_NoVenue/format.md"
HEADER_FOOTER = re.compile(r"^word/(header|footer)\d*\.xml$")

MEMO_FACE = """# Example Memo

Re: the example file

1. The first paragraph of the memo.

2. The second paragraph of the memo.

Yours truly,

________________________________
Pat Example
Lawyer
Example Law Corporation

To: Test Recipient (test@example.com)
"""

LETTER_FACE = """# Example letter

Test Recipient
123 Any Street

Dear Test Recipient,

Re: Test matter

A body paragraph.

A second body paragraph.

Yours very truly,

________________________________
Pat Example
Lawyer
Example Law Corporation

To: Test Recipient (test@example.com)
"""
LETTER_BODY = ["A body paragraph.", "A second body paragraph."]

FORMAT = {
    "paper": {"value": "letter", "rule_ref": "F-paper"},
    "margins": {"value": {"top": "1 in", "bottom": "1 in", "left": "25 mm", "right": "25 mm"},
                "rule_ref": "F-margins"},
    "header": {"value": "Example header", "rule_ref": "F-header"},
    "page_numbering": {"value": {"position": "bottom-center", "format": "arabic", "first_page": True},
                       "rule_ref": "F-pages"},
}


def filed(title, face, letterhead=False):
    """drafting_forms__render's filed response for a general Writing, with its stored layout."""
    layout = {"renderer": "general", "needs_forum_parts": False, "folder_code": "XMPL",
              "title": title, "exhibit_numbering": "writing", "letterhead": letterhead, "parts": []}
    return {"filing_id": 1, "revision": 3,
            "documents": [{"document_type": "General_writing", "file_name": title + ".md", "markdown": face}],
            "stored_layout": {"layout": layout, "venue": None, "passage_hashes": {},
                              "type_file": "draft/CAN/BC/_NoVenue/Documents/example.md", "venue_file": None},
            "timings": {}}


def format_read(fmt=FORMAT, learned=True, **items):
    """knowledge__read's response for the format file: every cited item confirmed (or vetted),
    except as `items` overrides it by rule_ref."""
    rows = []
    for entry in fmt.values():
        row = {"rule_ref": entry["rule_ref"], "status": "confirmed" if learned else "vetted",
               "freshness": "not verified", "passage_hash": "0" * 64, "currency": None, "record": PATH}
        row.update(items.get(entry["rule_ref"].replace("-", "_"), {}))
        rows.append(row)
    return {"path": PATH, "layer": "local", "learned": learned, "header": {}, "items": rows,
            "stale_confirmation": [], "orphaned_confirmations": [], "currency_moved": [],
            "corrections": [], "sources_check": "none", "format": fmt, "corrections_substituted": []}


def parts_of(path):
    with zipfile.ZipFile(path) as z:
        return {name: z.read(name) for name in z.namelist()}


def paragraphs(document_xml):
    body = ET.fromstring(document_xml).find("{%s}body" % W)
    return [p for p in body if p.tag == "{%s}p" % W]


def text(p):
    return "".join(t.text or "" for t in p.iter("{%s}t" % W))


def ppr_children(p):
    ppr = p.find("{%s}pPr" % W)
    return [child.tag.split("}")[1] for child in ppr]


class Base(unittest.TestCase):
    title = "Example Memo"
    face = MEMO_FACE
    stem = "2026-10-01 MEMO re the example file"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.out = self.tmp / "out"
        self.out.mkdir()
        self.appdata = self.tmp / "appdata"
        self.review = self.out / (self.stem + " (format unverified).docx")
        self.deliverable = self.out / (self.stem + ".docx")

    def fill(self, read, letterhead=False, extra=(), stem=None):
        (self.tmp / "filed.json").write_text(json.dumps(filed(self.title, self.face, letterhead)), encoding="utf-8")
        (self.tmp / "format.json").write_text(json.dumps(read), encoding="utf-8")
        cmd = [sys.executable, "-B", str(FILL_GENERAL), "--filed", str(self.tmp / "filed.json"),
               "--format", str(self.tmp / "format.json"), "--out-dir", str(self.out),
               "--out-name", self.stem if stem is None else stem, *extra]
        env = {**os.environ, "APPDATA": str(self.appdata), "PYTHONUTF8": "1"}
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
        lines = proc.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1, proc.stdout + proc.stderr)
        return proc, json.loads(lines[0])


class TestUnconfirmedItem(Base):
    """F-paper is agent-sourced and unconfirmed: only the review copy, and the deliverable refused."""

    def setUp(self):
        super().setUp()
        self.proc, self.result = self.fill(format_read(F_paper={"status": "unconfirmed", "pdf_page": "3"}))

    def test_the_deliverable_is_refused_naming_the_rule_ref(self):
        self.assertNotEqual(self.proc.returncode, 0)
        self.assertEqual(self.result["error"], "deliverable_refused")
        self.assertIn("F-paper", self.result["detail"])
        self.assertEqual(self.result["unconfirmed"],
                         [{"rule_ref": "F-paper", "property": "paper", "value": "letter", "pdf_page": "3"}])
        self.assertFalse(self.deliverable.exists())

    def test_the_review_copy_warns_in_the_body_first_paragraph_only(self):
        self.assertEqual(self.result["review_copy"], str(self.review))
        parts = parts_of(self.review)
        warning = "Format unverified: F-paper, transcribed from PDF p. 3"
        self.assertEqual(text(paragraphs(parts["word/document.xml"])[0]), warning)
        self.assertEqual(text(paragraphs(parts["word/document.xml"])[1]), self.title)
        self.assertEqual([name for name, data in parts.items() if b"Format unverified" in data],
                         ["word/document.xml"])
        self.assertFalse([name for name in parts if name.startswith("docProps/")])

    def test_the_review_copy_changes_no_header_or_footer_part(self):
        # Once the sidecar row exists the item reads confirmed, and the deliverable is written.
        proc, result = self.fill(format_read())
        self.assertEqual(proc.returncode, 0, result)
        review, deliverable = parts_of(self.review), parts_of(self.deliverable)
        self.assertEqual(sorted(review), sorted(deliverable))
        header_footer = [name for name in review if HEADER_FOOTER.match(name)]
        self.assertEqual(header_footer, ["word/footer1.xml", "word/header1.xml"])
        for name in review:
            if name != "word/document.xml":
                self.assertEqual(review[name], deliverable[name], name)


class TestConfirmedItem(Base):
    def test_the_deliverable_is_written_once_the_item_reads_confirmed(self):
        proc, result = self.fill(format_read())
        self.assertEqual(proc.returncode, 0, result)
        self.assertEqual(result["deliverable"], str(self.deliverable))
        self.assertNotIn("review_copy", result)
        self.assertFalse(self.review.exists())
        document = parts_of(self.deliverable)["word/document.xml"]
        self.assertEqual(text(paragraphs(document)[0]), self.title)
        self.assertEqual(result["defaulted"],
                         ["typeface", "font_size", "line_spacing", "footer", "filing_stamp_reservation"])

    def test_a_vetted_file_whose_source_moved_is_warned_of_but_not_refused(self):
        proc, result = self.fill(format_read(learned=False, F_margins={"freshness": "missing"}))
        self.assertEqual(proc.returncode, 0, result)
        self.assertTrue(self.deliverable.exists())
        review = parts_of(self.review)["word/document.xml"]
        self.assertEqual(text(paragraphs(review)[0]), "Source changed: F-margins")

    def test_a_vetted_file_item_reading_unconfirmed_never_blocks_the_deliverable(self):
        # A corrected row on a missing source reads unconfirmed for the session.
        proc, result = self.fill(format_read(learned=False,
                                             F_margins={"status": "unconfirmed", "freshness": "missing"}))
        self.assertEqual(proc.returncode, 0, result)
        self.assertEqual(result["deliverable"], str(self.deliverable))
        self.assertEqual(result["review_copy"], str(self.review))
        review = parts_of(self.review)["word/document.xml"]
        self.assertEqual(text(paragraphs(review)[0]), "Source changed: F-margins")
        self.assertNotIn(b"Format unverified", parts_of(self.review)["word/document.xml"])


class TestVersioning(Base):
    def version(self, n, suffix=""):
        return self.out / ("%s v%d%s.docx" % (self.stem, n, suffix))

    def test_a_second_run_versions_the_deliverable_and_leaves_the_first_untouched(self):
        self.fill(format_read())
        first = self.deliverable.read_bytes()
        proc, result = self.fill(format_read())
        self.assertEqual(proc.returncode, 0, result)
        self.assertEqual(result["deliverable"], str(self.version(2)))
        self.assertEqual(result["versioned_from"], str(self.deliverable))
        self.assertEqual(self.deliverable.read_bytes(), first)

    def test_an_unversioned_run_reports_no_versioned_from(self):
        proc, result = self.fill(format_read(F_paper={"status": "unconfirmed"}))
        self.assertNotIn("review_copy_versioned_from", result)
        proc, result = self.fill(format_read())
        self.assertEqual(result["deliverable"], str(self.deliverable))
        self.assertNotIn("versioned_from", result)

    def test_the_review_copy_series_is_versioned_on_its_own(self):
        self.review.write_bytes(b"an earlier review copy")
        proc, result = self.fill(format_read(learned=False, F_margins={"freshness": "missing"}))
        self.assertEqual(proc.returncode, 0, result)
        self.assertEqual(result["review_copy"], str(self.version(2, " (format unverified)")))
        self.assertEqual(result["review_copy_versioned_from"], str(self.review))
        self.assertEqual(result["deliverable"], str(self.deliverable))
        self.assertNotIn("versioned_from", result)
        self.assertEqual(self.review.read_bytes(), b"an earlier review copy")

    def test_the_next_version_is_one_past_the_highest(self):
        self.version(2).write_bytes(b"version two")
        proc, result = self.fill(format_read())
        self.assertEqual(proc.returncode, 0, result)
        self.assertEqual(result["deliverable"], str(self.version(3)))
        self.assertEqual(result["versioned_from"], str(self.version(2)))
        self.assertEqual(self.version(2).read_bytes(), b"version two")
        self.assertFalse(self.deliverable.exists())

    def test_no_temporary_file_remains(self):
        proc, result = self.fill(format_read(learned=False, F_margins={"freshness": "missing"}))
        self.assertEqual(proc.returncode, 0, result)
        self.assertEqual(sorted(p.name for p in self.out.iterdir()),
                         sorted([self.deliverable.name, self.review.name]))


class TestOutName(Base):
    def test_a_stem_that_is_not_a_bare_name_is_refused(self):
        for stem in ("", "   ", "2026-10-01 MEMO re a/b", 'MEMO re "x"', "MEMO re x.docx",
                     "MEMO re x.pdf", "MEMO re x v2"):
            with self.subTest(stem=stem):
                proc, result = self.fill(format_read(), stem=stem)
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(result["error"], "bad_input")
                self.assertEqual(list(self.out.iterdir()), [])

    def test_a_stem_ending_in_an_amount_is_not_taken_for_an_extension(self):
        stem = "2026-10-01 INV re costs $1,234.56"
        proc, result = self.fill(format_read(), stem=stem)
        self.assertEqual(proc.returncode, 0, result)
        self.assertTrue((self.out / (stem + ".docx")).exists())


class TestFormatBlock(Base):
    def test_an_unknown_property_fails_hard_naming_the_file_the_property_and_the_rule(self):
        fmt = {"signature": {"value": "keep", "rule_ref": "F-sig"}}
        proc, result = self.fill(format_read(fmt))
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(result["error"], "invalid_format")
        self.assertIn(PATH + ": format.signature: is not a settable property", result["detail"])
        self.assertFalse(self.review.exists() or self.deliverable.exists())

    def test_the_page_numbering_vocabulary_and_positivity_fail_as_invalid_format(self):
        pages = FORMAT["page_numbering"]
        for prop, value, rule in [
            ("page_numbering", dict(pages["value"], position="bottom"),
             "format.page_numbering.value.position: must be one of top-left"),
            ("page_numbering", dict(pages["value"], format="roman"),
             "format.page_numbering.value.format: must be one of arabic, lower-roman, upper-roman"),
            ("page_numbering", dict(pages["value"], first_page=1),
             "format.page_numbering.value.first_page: must be true or false"),
            ("font_size", "0 pt", "format.font_size.value: must be greater than zero"),
            ("line_spacing", 0, "format.line_spacing.value: must be greater than zero"),
        ]:
            with self.subTest(prop=prop, value=value):
                proc, result = self.fill(format_read({prop: {"value": value, "rule_ref": "F-x"}}))
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(result["error"], "invalid_format")
                self.assertIn(PATH + ": " + rule, result["detail"])
                self.assertFalse(self.review.exists() or self.deliverable.exists())


class TestSignatureBlock(Base):
    def test_the_signature_block_keeps_with_the_paragraph_before_it(self):
        proc, result = self.fill(format_read())
        self.assertEqual(proc.returncode, 0, result)
        paras = paragraphs(parts_of(self.deliverable)["word/document.xml"])
        texts = [text(p) for p in paras]
        before = texts.index("2.The second paragraph of the memo.")
        chain = paras[before:before + 3]
        self.assertEqual(texts[before + 1], "Yours truly,")
        self.assertTrue(texts[before + 2].startswith("________________________________"))
        for p in chain[:2]:
            self.assertEqual(ppr_children(p)[:2], ["keepNext", "keepLines"])
        self.assertEqual(ppr_children(chain[2])[0], "keepLines")
        self.assertNotIn("keepNext", ppr_children(chain[2]))
        self.assertEqual(texts[-1], "To: Test Recipient (test@example.com)")
        self.assertNotIn("keepNext", ppr_children(paras[-1]))


class TestLetterhead(Base):
    title = "Example letter"
    face = LETTER_FACE

    fmt = {prop: FORMAT[prop] for prop in ("paper", "margins")}

    def fill_letter(self, read=None, **payload):
        support.write_config(self.appdata, {"person": STAFF["key"]})
        template = support.write_zip(self.tmp / "letterhead.docx", support.template_parts())
        profile = support.write_profile(self.tmp / "profile.json", template)
        letter = self.tmp / "letter.json"
        letter.write_text(json.dumps({**support.PAYLOAD, "body": LETTER_BODY, **payload}), encoding="utf-8")
        return self.fill(read or format_read(self.fmt), letterhead=True,
                         extra=("--letter", str(letter), "--profile", str(profile)))

    def test_overridden_by_letterhead_is_reported_once(self):
        read = format_read(self.fmt, F_paper={"practitioner_sourced": True}, F_margins={"practitioner_sourced": True})
        proc, result = self.fill_letter(read)
        self.assertEqual(proc.returncode, 0, result)
        self.assertEqual(result["overridden_by_letterhead"], ["paper", "margins"])
        self.assertEqual(proc.stdout.count("overridden_by_letterhead"), 1)
        header = parts_of(self.deliverable)["word/header3.xml"].decode("utf-8")
        self.assertIn(LAWYER["name"], header)

    def test_the_letterhead_overrides_every_property_the_file_sets(self):
        fmt = dict(self.fmt, typeface={"value": "Arial", "rule_ref": "F-face"},
                   font_size={"value": "11 pt", "rule_ref": "F-size"},
                   line_spacing={"value": 2, "rule_ref": "F-spacing"},
                   page_numbering=FORMAT["page_numbering"],
                   filing_stamp_reservation={"value": "2 in", "rule_ref": "F-stamp"})
        proc, result = self.fill_letter(format_read(fmt))
        self.assertEqual(proc.returncode, 0, result)
        self.assertEqual(result["overridden_by_letterhead"],
                         ["paper", "margins", "typeface", "font_size", "line_spacing",
                          "page_numbering", "filing_stamp_reservation"])
        styles = parts_of(self.deliverable)["word/styles.xml"].decode("utf-8")
        self.assertNotIn("Arial", styles)

    def test_an_unconfirmed_overridden_item_blocks_and_is_marked_not_applied(self):
        proc, result = self.fill_letter(format_read(self.fmt, F_paper={"status": "unconfirmed"}))
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(result["error"], "deliverable_refused")
        self.assertEqual(result["unconfirmed"], [{"rule_ref": "F-paper", "property": "paper",
                                                  "value": "letter", "overridden_by_letterhead": True}])
        self.assertTrue(self.review.exists())
        self.assertFalse(self.deliverable.exists())

    def test_a_dropped_body_paragraph_is_refused(self):
        proc, result = self.fill_letter(body=["A body paragraph."])
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(result["error"], "letter_body_incomplete")
        self.assertIn("A second body paragraph.", result["detail"])
        self.assertFalse(self.review.exists() or self.deliverable.exists())

    def test_a_re_line_not_on_the_filed_face_is_refused(self):
        proc, result = self.fill_letter(re=["Another matter"])
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(result["error"], "letter_field_not_in_filed_face")
        self.assertIn("re line 'Another matter'", result["detail"])
        self.assertFalse(self.review.exists() or self.deliverable.exists())

    def test_a_field_carrying_the_label_the_letterhead_prints_is_refused_naming_it(self):
        cases = [({"attention": "Attention: Test Recipient"}, "`attention`"),
                 ({"recipients": [{"recipient": ["Test Recipient"], "attention": "Attn: Test Recipient"}]},
                  "`recipients[0].attention`"),
                 ({"re": ["Re: Test matter"]}, "`re[0]`"),
                 ({"cc": [{"name": "cc: Other Counsel"}]}, "`cc[0].name`"),
                 ({"enclosures": ["Encl. Affidavit #1"]}, "`enclosures[0]`")]
        for payload, field in cases:
            with self.subTest(field=field):
                proc, result = self.fill_letter(**payload)
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(result["error"], "letter_field_carries_label")
                self.assertIn(field, result["detail"])
                self.assertFalse(self.review.exists() or self.deliverable.exists())

    def test_an_unlabelled_attention_prints_its_label_once(self):
        proc, result = self.fill_letter(attention="Test Recipient")
        self.assertEqual(proc.returncode, 0, result)
        document = ET.fromstring(parts_of(self.deliverable)["word/document.xml"])
        texts = [text(p) for p in document.iter("{%s}p" % W)]
        self.assertIn("Attention: Test Recipient", texts)
        self.assertEqual(sum(t.count("Attention:") for t in texts), 1)

    def test_a_non_string_attention_is_refused_as_bad_input_naming_it(self):
        cases = [({"attention": ["Jane Doe"]}, "attention"),
                 ({"attention": 5}, "attention"),
                 ({"attention": []}, "attention"),
                 ({"recipients": [{"recipient": ["Test Recipient"], "attention": ["Jane Doe"]}]},
                  "recipients[0].attention"),
                 ({"recipients": [{"recipient": ["Test Recipient"], "attention": 5}]},
                  "recipients[0].attention")]
        for payload, field in cases:
            with self.subTest(payload=payload):
                proc, result = self.fill_letter(**payload)
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(result["error"], "bad_input")
                self.assertIn(field, result["detail"])
                self.assertNotIn("trace", result)
                self.assertFalse(self.review.exists() or self.deliverable.exists())

    def test_an_absent_attention_builds(self):
        proc, result = self.fill_letter()
        self.assertEqual(proc.returncode, 0, result)

    def test_a_null_attention_builds(self):
        proc, result = self.fill_letter(attention=None)
        self.assertEqual(proc.returncode, 0, result)

    def test_an_attention_not_on_the_filed_face_is_refused_naming_it(self):
        cases = [({"attention": "Nobody On The Face"}, "attention 'Nobody On The Face'"),
                 ({"recipients": [{"recipient": ["Test Recipient"], "attention": "Ghost Person"}]},
                  "recipients[0].attention 'Ghost Person'")]
        for payload, named in cases:
            with self.subTest(named=named):
                proc, result = self.fill_letter(**payload)
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(result["error"], "letter_field_not_in_filed_face")
                self.assertIn(named, result["detail"])
                self.assertFalse(self.review.exists() or self.deliverable.exists())


class TestLetterheadAttentionOnFace(Base):
    """A face that prints its own attention line, so the attention value is on it only there."""
    title = TestLetterhead.title
    face = LETTER_FACE.replace("123 Any Street\n", "123 Any Street\n\nAttention: Jane Doe\n")
    fmt = TestLetterhead.fmt
    fill_letter = TestLetterhead.fill_letter

    def test_an_attention_matching_the_face_attention_line_builds_and_prints_its_label_once(self):
        proc, result = self.fill_letter(attention="Jane Doe")
        self.assertEqual(proc.returncode, 0, result)
        document = ET.fromstring(parts_of(self.deliverable)["word/document.xml"])
        texts = [text(p) for p in document.iter("{%s}p" % W)]
        self.assertIn("Attention: Jane Doe", texts)
        self.assertEqual(sum(t.count("Attention:") for t in texts), 1)

    def test_an_attention_carrying_its_label_is_still_refused_for_the_label(self):
        proc, result = self.fill_letter(attention="Attention: Jane Doe")
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(result["error"], "letter_field_carries_label")
        self.assertFalse(self.review.exists() or self.deliverable.exists())


class TestLetterheadCcAndEnclosures(Base):
    """`cc` and `enclosures` must be lists; a string would print one line per character."""
    title = TestLetterhead.title
    face = LETTER_FACE
    fmt = TestLetterhead.fmt
    fill_letter = TestLetterhead.fill_letter

    def letter_texts(self):
        document = ET.fromstring(parts_of(self.deliverable)["word/document.xml"])
        return [text(p) for p in document.iter("{%s}p" % W)]

    def test_a_malformed_cc_or_enclosures_is_refused_naming_it(self):
        cases = [({"enclosures": "Affidavit #1"}, "`enclosures`"),
                 ({"enclosures": {"item": "Affidavit #1"}}, "`enclosures`"),
                 ({"enclosures": 3}, "`enclosures`"),
                 ({"enclosures": ["Affidavit #1", 2]}, "`enclosures`"),
                 ({"cc": "Jane Doe"}, "`cc`"),
                 ({"cc": {"name": "Jane Doe"}}, "`cc`"),
                 ({"cc": 3}, "`cc`"),
                 ({"cc": [""]}, "cc[0]"),
                 ({"cc": ["Jane Doe", {"email": "jane@example.com"}]}, "cc[1]"),
                 ({"cc": [{"name": "Jane Doe", "email": 5}]}, "cc[0].email")]
        for payload, named in cases:
            with self.subTest(payload=payload):
                proc, result = self.fill_letter(**payload)
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(result["error"], "bad_input")
                self.assertIn(named, result["detail"])
                self.assertFalse(self.review.exists() or self.deliverable.exists())

    def test_list_values_print_one_line_per_entry(self):
        proc, result = self.fill_letter(
            cc=["Other Counsel", {"name": "Second Counsel", "email": "second@example.com"}],
            enclosures=["Affidavit #1", "Exhibit list"])
        self.assertEqual(proc.returncode, 0, result)
        texts = self.letter_texts()
        for line in ("cc. Other Counsel", "cc. Second Counsel, second@example.com",
                     "Encl.Affidavit #1", "Exhibit list"):
            self.assertIn(line, texts)

    def test_an_absent_null_or_empty_cc_or_enclosures_prints_none(self):
        for payload in ({}, {"cc": None, "enclosures": None}, {"cc": [], "enclosures": []}):
            with self.subTest(payload=payload):
                proc, result = self.fill_letter(**payload)
                self.assertEqual(proc.returncode, 0, result)
                texts = self.letter_texts()
                self.assertFalse([t for t in texts if t.startswith(("cc.", "Encl."))], texts)
                self.deliverable.unlink()


if __name__ == "__main__":
    unittest.main()
