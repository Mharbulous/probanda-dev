"""The letterhead step: render_letterhead.py against a synthetic template and profile.

The output keeps every part of the template but the body: the header and footer differ
only by their substituted tokens, and a scanned signature adds only its media part, its
relationship and the png content type. The signer must be an active roster lawyer. The
signature is placed only when this machine's `person` is the signer, and a `signature`
whose file is absent, an unknown signer or a missing template stops the render.

Run: python -m unittest discover -s source/skills/publish/tests
"""
from __future__ import annotations

import re
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import support
import render_letterhead  # on sys.path via support
from support import LAWYER, PAYLOAD, STAFF, W

SIGNATURE_PNG = support.png(40, 10)
KEEP = ("keepNext", "keepLines")


def parts_of(path):
    with zipfile.ZipFile(path) as z:
        return {name: z.read(name) for name in z.namelist()}


def paragraphs(document_xml):
    body = ET.fromstring(document_xml).find("{%s}body" % W)
    return [p for p in body if p.tag == "{%s}p" % W]


def text(p):
    return "".join(t.text or "" for t in p.iter("{%s}t" % W))


def ppr_children(p):
    return [child.tag.split("}")[1] for child in p.find("{%s}pPr" % W)]


def index_of(paras, wanted):
    return next(i for i, p in enumerate(paras) if text(p) == wanted)


def image_relationships(parts):
    found = []
    for name, data in parts.items():
        if name.endswith(".rels"):
            for rel in re.findall(r"<Relationship\b[^>]*/>", data.decode("utf-8")):
                if 'Type="%s"' % support.IMAGE_REL in rel:
                    found.append((name, re.search(r'Id="([^"]+)"', rel).group(1)))
    return found


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.appdata = self.tmp / "appdata"
        self.template_parts = support.template_parts()
        self.template = support.write_zip(self.tmp / "letterhead.docx", self.template_parts)
        self.signature = self.tmp / "signature.png"
        self.signature.write_bytes(SIGNATURE_PNG)

    def config(self, **config):
        support.write_config(self.appdata, config)

    def render(self, payload=PAYLOAD, template=None):
        profile = support.write_profile(self.tmp / "profile.json", template or self.template)
        return support.render(self.tmp, payload, self.appdata, profile)

    def render_ok(self, payload=PAYLOAD):
        proc, out = self.render(payload)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return parts_of(out)

    def assert_refused(self, needle, payload=PAYLOAD, template=None):
        proc, out = self.render(payload, template)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn(needle, proc.stderr)
        self.assertFalse(out.exists())


class TestNonBodyParts(Base):
    def test_every_part_but_the_body_byte_matches_the_template(self):
        self.config(person=STAFF["key"])
        out = self.render_ok()
        self.assertEqual(list(out), list(self.template_parts))
        values = {"{{AUTHOR_NAME}}": LAWYER["name"], "{{AUTHOR_EMAIL}}": LAWYER["email"],
                  "{{DIRECT_LINE}}": LAWYER["direct_line"],
                  "{{FILE_NUMBER}}": PAYLOAD["file_number"]}
        for name, data in self.template_parts.items():
            if name == "word/document.xml":
                continue
            expected = data
            if name in ("word/header3.xml", "word/footer3.xml"):
                filled = data.decode("utf-8")
                for token, value in values.items():
                    filled = filled.replace(token, value)
                self.assertNotEqual(filled.encode("utf-8"), data, name + " carries no token")
                expected = filled.encode("utf-8")
            self.assertEqual(out[name], expected, name)

    def test_a_literal_double_brace_in_the_header_renders_intact(self):
        self.config(person=STAFF["key"])
        parts = support.template_parts()
        parts["word/header3.xml"] = parts["word/header3.xml"].replace(
            b"</w:p></w:hdr>", b"<w:r><w:t>{{not a token}}</w:t></w:r></w:p></w:hdr>")
        template = support.write_zip(self.tmp / "literal.docx", parts)
        proc, out = self.render(template=template)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        header = parts_of(out)["word/header3.xml"].decode("utf-8")
        self.assertIn("<w:t>{{not a token}}</w:t>", header)
        self.assertIn(LAWYER["name"], header)
        self.assertNotIn("{{AUTHOR_NAME}}", header)


class TestSigner(Base):
    def setUp(self):
        super().setUp()
        self.config(person=STAFF["key"])

    def test_a_staff_signer_is_refused(self):
        self.assert_refused("only a roster lawyer signs", {**PAYLOAD, "signer": STAFF["key"]})

    def test_an_inactive_lawyer_is_refused(self):
        self.assert_refused('signer "fl" is inactive', {**PAYLOAD, "signer": "fl"})

    def test_an_unknown_signer_key_is_refused(self):
        self.assert_refused('signer "zz" is not a key in the firm roster',
                            {**PAYLOAD, "signer": "zz"})


class TestMissingFiles(Base):
    def test_a_missing_template_stops_the_render(self):
        self.config(person=STAFF["key"])
        self.assert_refused("letterhead template not found",
                            template=self.tmp / "no such letterhead.docx")

    def test_a_signature_whose_file_is_absent_stops_the_render(self):
        self.config(person=STAFF["key"], signature=str(self.tmp / "missing.png"))
        self.assert_refused("signature file not found")


class TestSomeoneElsesLetter(Base):
    """This machine's person is not the signer: a blank signing space, no image."""

    def setUp(self):
        super().setUp()
        self.config(person=STAFF["key"], signature=str(self.signature))
        self.parts = self.render_ok()
        self.doc = self.parts["word/document.xml"].decode("utf-8")

    def test_the_body_has_no_drawing(self):
        self.assertNotIn("<w:drawing", self.doc)
        self.assertNotIn("r:embed", self.doc)

    def test_the_only_media_and_image_relationship_are_the_header_logo(self):
        media = [name for name in self.parts if name.startswith("word/media/")]
        self.assertEqual(media, ["word/media/logo.png"])
        self.assertEqual(image_relationships(self.parts),
                         [("word/_rels/header3.xml.rels", "rIdLogo")])

    def test_the_signing_space_is_three_empty_paragraphs(self):
        paras = paragraphs(self.doc)
        between = paras[index_of(paras, "per") + 1:index_of(paras, LAWYER["name"])]
        self.assertEqual(len(between), 3)
        for p in between:
            self.assertEqual(p.findall("{%s}r" % W), [], "signing space must be empty")


class TestOwnLetter(Base):
    """This machine's person is the signer and has a signature: the image is placed."""

    def setUp(self):
        super().setUp()
        self.config(person=LAWYER["key"], signature=str(self.signature))

    def test_the_signature_fills_the_signing_space(self):
        doc = self.render_ok()["word/document.xml"].decode("utf-8")
        paras = paragraphs(doc)
        between = paras[index_of(paras, "per") + 1:index_of(paras, LAWYER["name"])]
        self.assertEqual(len(between), 1)
        blip = between[0].find(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip")
        self.assertEqual(blip.get("{%s}embed" % support.R), "rIdSignature")
        self.assertIn('<wp:extent cx="1371600" cy="342900"/>', doc)
        self.assertIn(">PE/PE<", doc)

    def test_the_package_gains_the_image_its_relationship_and_its_content_type(self):
        # No header logo, so the template declares no png type and the render adds one.
        template_parts = support.template_parts(logo=False)
        template = support.write_zip(self.tmp / "no-logo.docx", template_parts)
        proc, out = self.render(template=template)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        parts = parts_of(out)
        self.assertEqual(list(parts), list(template_parts) + ["word/media/signature.png"])
        self.assertEqual(parts["word/media/signature.png"], SIGNATURE_PNG)
        self.assertEqual(image_relationships(parts),
                         [("word/_rels/document.xml.rels", "rIdSignature")])
        self.assertIn('<Default Extension="png" ContentType="image/png"/>',
                      parts["[Content_Types].xml"].decode("utf-8"))

    def test_a_declared_png_type_is_not_added_again(self):
        parts = self.render_ok()
        self.assertEqual(parts["[Content_Types].xml"],
                         self.template_parts["[Content_Types].xml"])


class TestVerify(unittest.TestCase):
    def test_a_change_beyond_the_signature_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            parts = support.template_parts()
            template = support.write_zip(Path(tmp) / "letterhead.docx", parts)
            names = list(parts)
            values = dict.fromkeys(render_letterhead.TOKENS, "filled")
            for name in ("word/header3.xml", "word/footer3.xml"):
                parts[name] = render_letterhead.fill_tokens(
                    parts[name].decode("utf-8"), values).encode("utf-8")
            render_letterhead.add_signature(parts, names, SIGNATURE_PNG)
            rels = parts["word/_rels/document.xml.rels"].decode("utf-8")
            parts["word/_rels/document.xml.rels"] = rels.replace(
                "</Relationships>",
                '<Relationship Id="rIdExtra" Type="%s" Target="media/extra.png"/>'
                "</Relationships>" % support.IMAGE_REL).encode("utf-8")
            out = support.write_zip(Path(tmp) / "out.docx", {n: parts[n] for n in names})
            with self.assertRaises(SystemExit) as stop:
                render_letterhead.verify(str(out), str(template), signed=True, values=values)
            self.assertIn("beyond the signature's addition", str(stop.exception))


# Enough body to run the letter onto a second page.
FILLER = ("Filler paragraph %02d says something about the matter at modest length so that "
          "it takes up two or three lines of the page, like an ordinary paragraph would.")


class TestTwoPageKeepChain(Base):
    """The closing and signature block keep with the last body paragraph."""

    def setUp(self):
        super().setUp()
        self.config(person=LAWYER["key"], signature=str(self.signature))
        payload = {**PAYLOAD, "body": [FILLER % i for i in range(1, 31)] + ["The last paragraph."],
                   "enclosures": ["An enclosure"]}
        self.paras = paragraphs(self.render_ok(payload)["word/document.xml"])
        self.last = index_of(self.paras, "The last paragraph.")
        self.signer = index_of(self.paras, LAWYER["name"])

    def test_keep_next_chains_from_the_last_body_paragraph_to_the_signer(self):
        chain = self.paras[self.last:self.signer + 1]
        self.assertEqual(len(chain), 7)  # para, blank, closing, firm, per, signature, signer
        for p in chain:
            self.assertEqual(ppr_children(p)[:2], list(KEEP), text(p) or "(signature or blank)")

    def test_the_chain_is_anchored_to_the_initials_line(self):
        initials = self.paras[self.signer + 1]
        self.assertEqual(text(initials), "PE/PE")
        self.assertNotIn("keepNext", ppr_children(initials))
        self.assertNotIn("keepNext", ppr_children(self.paras[self.last - 2]))


class TestCcAndEnclosures(Base):
    """`cc` and `enclosures` must be lists; a string would print one line per character."""

    def test_a_malformed_cc_or_enclosures_is_refused_naming_it(self):
        self.config(person=STAFF["key"])
        cases = [({"enclosures": "Affidavit #1"}, "enclosures"),
                 ({"enclosures": ["Affidavit #1", 2]}, "enclosures"),
                 ({"cc": "Jane Doe"}, "`cc`"),
                 ({"cc": [{"email": "jane@example.com"}]}, "cc[0]"),
                 ({"cc": [{"name": "Jane Doe", "email": 5}]}, "cc[0].email")]
        for fields, named in cases:
            with self.subTest(fields=fields):
                self.assert_refused(named, {**PAYLOAD, **fields})

    def test_a_non_string_attention_is_refused_naming_it(self):
        self.config(person=STAFF["key"])
        cases = [({"attention": ["Jane Doe"]}, "`attention`"),
                 ({"recipient": None, "recipients": [{"recipient": ["Jane Doe"], "attention": 5}]},
                  "`recipients[0].attention`")]
        for fields, named in cases:
            with self.subTest(fields=fields):
                self.assert_refused(named, {**PAYLOAD, **fields})

    def test_an_absent_null_or_empty_cc_or_enclosures_prints_none(self):
        self.config(person=STAFF["key"])
        for value in (None, []):
            with self.subTest(value=value):
                parts = self.render_ok({**PAYLOAD, "cc": value, "enclosures": value})
                texts = [text(p) for p in paragraphs(parts["word/document.xml"])]
                self.assertFalse([t for t in texts if t.startswith(("cc.", "Encl."))], texts)
                (self.tmp / "letter.docx").unlink()



class TestLayout(Base):
    """The page a letter gets, the same on every render."""

    MARKER = "SOLICITOR CLIENT PRIVILEGED"

    def setUp(self):
        super().setUp()
        self.config(person=STAFF["key"])
        self.payload = {**PAYLOAD, "attention": "Jane Doe", "marker": self.MARKER}
        self.doc = self.render_ok(self.payload)["word/document.xml"]
        self.body = list(ET.fromstring(self.doc).find("{%s}body" % W))

    def in_fresh_folder(self):
        """Point later renders at a new folder, so each writes its own letter.docx."""
        self.tmp = Path(tempfile.mkdtemp(dir=self._tmp.name))

    def bold(self, run):
        rpr = run.find("{%s}rPr" % W)
        return rpr is not None and rpr.find("{%s}b" % W) is not None

    def test_two_renders_of_one_payload_give_the_same_document(self):
        self.in_fresh_folder()
        again = self.render_ok(self.payload)["word/document.xml"]
        self.assertEqual(again, self.doc)

    def test_the_file_number_is_in_no_body_paragraph(self):
        for p in ET.fromstring(self.doc).iter("{%s}p" % W):
            self.assertNotIn(PAYLOAD["file_number"], text(p))

    def test_attention_is_the_only_bold_run_in_the_address_cell(self):
        table = next(e for e in self.body if e.tag == "{%s}tbl" % W)
        address = table.find("{%s}tr/{%s}tc" % (W, W))
        bold = [r.findtext("{%s}t" % W) for r in address.iter("{%s}r" % W) if self.bold(r)]
        self.assertEqual(bold, ["Attention: Jane Doe"])

    def test_the_re_paragraph_has_a_bottom_border(self):
        re_para = next(p for p in self.body if p.tag == "{%s}p" % W and text(p).startswith("Re:"))
        self.assertIsNotNone(re_para.find("{%s}pPr/{%s}pBdr/{%s}bottom" % (W, W, W)))

    def test_the_marker_is_one_bold_line_between_the_date_and_the_address(self):
        texts = [text(e) if e.tag == "{%s}p" % W else "<table>" for e in self.body]
        date, marker, table = (texts.index(PAYLOAD["date"]), texts.index(self.MARKER),
                               texts.index("<table>"))
        self.assertLess(date, marker)
        self.assertLess(marker, table)
        runs = self.body[marker].findall("{%s}r" % W)
        self.assertTrue(runs and all(self.bold(r) for r in runs))

    def test_no_marker_prints_no_marker_line(self):
        self.in_fresh_folder()
        doc = self.render_ok(PAYLOAD)["word/document.xml"].decode("utf-8")
        self.assertNotIn(self.MARKER, doc)

    def test_a_non_string_marker_is_refused_naming_it(self):
        self.in_fresh_folder()
        self.assert_refused("`marker`", {**PAYLOAD, "marker": ["x"]})

    def test_the_section_properties_are_the_templates(self):
        pattern = re.compile(rb"<w:sectPr\b.*</w:sectPr>", re.S)
        self.assertEqual(pattern.search(self.doc).group(0),
                         pattern.search(self.template_parts["word/document.xml"]).group(0))


if __name__ == "__main__":
    unittest.main()
