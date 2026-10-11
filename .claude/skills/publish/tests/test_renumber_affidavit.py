"""renumber_affidavit.py writes a renumbered copy of a draft affidavit and refuses
anything it cannot change cleanly (#1390)."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from lxml import etree

SCRIPT = (Path(__file__).resolve().parents[1] / "subskills" / "renumber-affidavit"
          / "scripts" / "renumber_affidavit.py")
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = "{%s}" % W_NS

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/'
    'vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/'
    'vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>')
RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/'
    '2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
COMMENTS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:comments xmlns:w="%s"><w:comment w:id="0" w:author="A">'
    '<w:p><w:r><w:t>A comment</w:t></w:r></w:p></w:comment></w:comments>' % W_NS)


def para(*runs):
    return "<w:p>%s</w:p>" % "".join(runs)


def run(text):
    return '<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % text


TAIL = run(" of Jane Doe in this case and was made on June 1, 2026")
TEMPLATE = para(run("This is the "), run("1st affidavit"), TAIL)
SDT_PR = ('<w:sdtPr><w:alias w:val="Affidavit number"/><w:dropDownList>'
          '<w:listItem w:displayText="1st affidavit" w:value="1st affidavit"/>'
          '<w:listItem w:displayText="2nd affidavit" w:value="2nd affidavit"/>'
          '</w:dropDownList></w:sdtPr>')
SDT = para(run("This is the "), '<w:sdt>%s<w:sdtContent>%s</w:sdtContent></w:sdt>'
           % (SDT_PR, run("1st affidavit")), TAIL)
SUPERSCRIPT_RPR = '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'
SUPERSCRIPT = para(run("This is the 1"),
                   '<w:r>%s<w:t>st</w:t></w:r>' % SUPERSCRIPT_RPR, run(" affidavit"), TAIL)
REVISIONS = para(
    run("Before "),
    '<w:ins w:id="1" w:author="A" w:date="2026-10-01T00:00:00Z">%s</w:ins>' % run("inserted"),
    '<w:del w:id="2" w:author="A" w:date="2026-10-01T00:00:00Z">'
    '<w:r><w:delText>deleted</w:delText></w:r></w:del>',
    '<w:commentRangeStart w:id="0"/>', run("commented"), '<w:commentRangeEnd w:id="0"/>',
    '<w:r><w:commentReference w:id="0"/></w:r>')


def document(body):
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="%s"><w:body>%s</w:body></w:document>' % (W_NS, body))


def write_docx(path, body, header=None, comments=False):
    parts = {"[Content_Types].xml": CONTENT_TYPES, "_rels/.rels": RELS,
             "word/document.xml": document(body)}
    if header is not None:
        parts["word/header1.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:hdr xmlns:w="%s">%s</w:hdr>' % (W_NS, header))
    if comments:
        parts["word/comments.xml"] = COMMENTS
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    return path


def part_root(path, part="word/document.xml"):
    with zipfile.ZipFile(path) as z:
        return etree.fromstring(z.read(part))


def text_of(path, part="word/document.xml"):
    return "".join(t.text or "" for t in part_root(path, part).iter(W + "t"))


class RenumberTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.out = self.tmp / "out.docx"

    def tearDown(self):
        self._tmp.cleanup()

    def call(self, request):
        req = self.tmp / "request.json"
        req.write_text(json.dumps(request), encoding="utf-8")
        proc = subprocess.run([sys.executable, "-B", str(SCRIPT), str(req)],
                              capture_output=True, text=True)
        result = json.loads(proc.stdout)
        self.assertEqual(proc.returncode, 0 if result["success"] else 1, proc.stderr)
        return result

    def probe(self, path):
        return self.call({"mode": "probe", "source": str(path)})

    def write(self, source, old=1, new=2, out=None):
        before = Path(source).read_bytes()
        result = self.call({"mode": "write", "source": str(source),
                            "out_path": str(out or self.out),
                            "old_number": old, "new_number": new})
        self.assertEqual(Path(source).read_bytes(), before, "source changed")
        return result

    def refuse(self, source, error, old=1, new=2):
        result = self.write(source, old, new)
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], error, result)
        self.assertTrue(result["detail"])
        return result

    def test_plain_run(self):
        src = write_docx(self.tmp / "src.docx", TEMPLATE)
        result = self.write(src)
        self.assertTrue(result["success"], result)
        self.assertEqual(result["location"], "plain_run")
        self.assertEqual(result["part"], "word/document.xml")
        probe = self.probe(self.out)
        self.assertEqual([m["number"] for m in probe["matches"]], [2])
        self.assertEqual(probe["matches"][0]["location"], "plain_run")
        self.assertIn("This is the 2nd affidavit of Jane Doe", text_of(self.out))

    def test_dropdown_content_control(self):
        src = write_docx(self.tmp / "src.docx", SDT)
        self.assertEqual(self.probe(src)["matches"][0]["location"], "sdt")
        result = self.write(src)
        self.assertTrue(result["success"], result)
        self.assertEqual(result["location"], "sdt")
        self.assertIn("This is the 2nd affidavit", text_of(self.out))
        before = etree.tostring(next(part_root(src).iter(W + "sdtPr")))
        after = etree.tostring(next(part_root(self.out).iter(W + "sdtPr")))
        self.assertEqual(before, after)

    def test_split_runs_superscript_suffix(self):
        src = write_docx(self.tmp / "src.docx", SUPERSCRIPT)
        result = self.write(src)
        self.assertTrue(result["success"], result)
        self.assertEqual(result["location"], "split_runs")
        texts = [t.text for t in part_root(self.out).iter(W + "t")]
        self.assertEqual(texts[:2], ["This is the 2", "nd"])
        before = etree.tostring(next(part_root(src).iter(W + "rPr")))
        after = etree.tostring(next(part_root(self.out).iter(W + "rPr")))
        self.assertEqual(before, after)

    def test_identifier_in_header_only(self):
        src = write_docx(self.tmp / "src.docx", para(run("Body text")), header=TEMPLATE)
        self.assertEqual(self.probe(src)["parts_searched"],
                         ["word/document.xml", "word/header1.xml"])
        result = self.write(src)
        self.assertTrue(result["success"], result)
        self.assertEqual(result["part"], "word/header1.xml")
        self.assertIn("This is the 2nd affidavit", text_of(self.out, "word/header1.xml"))

    def test_tracked_changes_and_comments_survive(self):
        src = write_docx(self.tmp / "src.docx", TEMPLATE + REVISIONS, comments=True)
        probe = self.probe(src)
        self.assertTrue(probe["tracked_changes_present"])
        self.assertTrue(probe["comments_present"])
        self.assertFalse(probe["matches"][0]["in_tracked_change"])
        result = self.write(src)
        self.assertTrue(result["success"], result)
        self.assertTrue(result["tracked_changes_present"])
        self.assertTrue(result["comments_present"])
        with zipfile.ZipFile(src) as a, zipfile.ZipFile(self.out) as b:
            self.assertEqual(a.read("word/comments.xml"), b.read("word/comments.xml"))
            self.assertEqual(a.namelist(), b.namelist())
        root = part_root(self.out)
        for tag in ("ins", "del", "delText", "commentRangeStart", "commentReference"):
            self.assertEqual(len(list(root.iter(W + tag))), 1, tag)
        self.assertEqual(next(root.iter(W + "delText")).text, "deleted")

    def test_output_exists_is_untouched(self):
        src = write_docx(self.tmp / "src.docx", TEMPLATE)
        self.out.write_bytes(b"keep")
        self.refuse(src, "output_exists")
        self.assertEqual(self.out.read_bytes(), b"keep")

    def test_not_a_docx(self):
        src = self.tmp / "src.docx"
        src.write_bytes(b"not a zip")
        self.refuse(src, "not_a_docx")
        self.assertFalse(self.out.exists())

    def test_refusals_leave_no_output(self):
        ins_digit = para(
            run("This is the "),
            '<w:del w:id="1" w:author="A"><w:r><w:delText>1</w:delText></w:r></w:del>',
            '<w:ins w:id="2" w:author="A">%s</w:ins>' % run("2"), run("nd affidavit"), TAIL)
        cases = [
            ("not_found", para(run("No identifier here")), "identifier_not_found", 1, 2),
            ("two", TEMPLATE + TEMPLATE, "identifier_ambiguous", 1, 2),
            ("mismatch", TEMPLATE, "ordinal_mismatch", 3, 4),
            ("tracked", ins_digit, "ordinal_in_tracked_change", 2, 3),
            ("split", para(run("This is the 1"), run("2th affidavit"), TAIL),
             "identifier_split", 12, 13),
            ("same", TEMPLATE, "invalid_number", 1, 1),
            ("zero", TEMPLATE, "invalid_number", 1, 0),
        ]
        for name, body, error, old, new in cases:
            with self.subTest(name):
                src = write_docx(self.tmp / (name + ".docx"), body)
                self.refuse(src, error, old, new)
                self.assertFalse(self.out.exists())

    def test_suffix_rule(self):
        cases = ((1, "st", 2, "2nd"), (11, "th", 12, "12th"), (2, "nd", 3, "3rd"),
                 (22, "nd", 23, "23rd"), (1, "ST", 2, "2ND"))
        for index, (old, suffix, new, expected) in enumerate(cases):
            with self.subTest(expected):
                src = write_docx(self.tmp / ("src%d.docx" % index),
                                 para(run("This is the "), run("%d%s affidavit" % (old, suffix)),
                                      TAIL))
                out = self.tmp / ("out%d.docx" % index)
                result = self.write(src, old, new, out)
                self.assertTrue(result["success"], result)
                self.assertIn("This is the %s affidavit" % expected, text_of(out))


if __name__ == "__main__":
    unittest.main()
