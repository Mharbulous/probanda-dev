"""make_precedent.py: synthetic Word files only."""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "make_precedent.py"

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
YELLOW = '<w:highlight w:val="yellow"/>'


def wrap(root, body):
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:%s %s>%s</w:%s>' % (root, NS, body, root)


def doc(body):
    return wrap("document", "<w:body>%s</w:body>" % body)


def run(text, rpr=""):
    props = "<w:rPr>%s</w:rPr>" % rpr if rpr else ""
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (props, text)


def para(*runs):
    return "<w:p>%s</w:p>" % "".join(runs)


class MakePrecedentTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.out = self.tmp / "precedents"
        self.out.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def docx(self, document, extra=None, name="source.docx"):
        path = self.tmp / name
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", "<Types/>")
            z.writestr("word/document.xml", document)
            z.writestr("word/media/logo.png", b"\x89PNG\x00not really")
            for part, content in (extra or {}).items():
                z.writestr(part, content)
        return path

    def run_script(self, source, replacements, name="2026-01-02 Fee Agreement - PRECEDENT", out_dir=None):
        request = self.tmp / "request.json"
        request.write_text(
            json.dumps({"source": str(source), "out_dir": str(out_dir or self.out), "name": name, "replacements": replacements}),
            encoding="utf-8",
        )
        done = subprocess.run([sys.executable, str(SCRIPT), str(request)], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(done.returncode, 0, done.stderr)
        lines = done.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1, done.stdout)
        return json.loads(lines[0])

    def part(self, path, name="word/document.xml"):
        with zipfile.ZipFile(path) as z:
            return z.read(name).decode("utf-8")

    def assertWroteNothing(self):
        self.assertEqual(os.listdir(self.out), [])

    def test_value_in_one_run_becomes_a_highlighted_placeholder(self):
        source = self.docx(doc(para(run("Dear Pat Doe, welcome."))))
        result = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[CLIENT NAME]"}])
        self.assertTrue(result["success"], result)
        self.assertEqual(result["replaced"], {"[CLIENT NAME]": 1})
        xml = self.part(result["path"])
        self.assertIn('<w:t xml:space="preserve">Dear </w:t>', xml)
        self.assertIn('<w:r><w:rPr>%s</w:rPr><w:t xml:space="preserve">[CLIENT NAME]</w:t></w:r>' % YELLOW, xml)
        self.assertIn('<w:t xml:space="preserve">, welcome.</w:t>', xml)
        self.assertNotIn("Pat Doe", xml)

    def test_value_split_across_runs_takes_the_first_runs_properties(self):
        source = self.docx(doc(para(run("To Pa", "<w:b/>"), run("t D", "<w:i/>"), run("oe now", "<w:u w:val=\"single\"/>"))))
        result = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[CLIENT]"}])
        xml = self.part(result["path"])
        self.assertIn('<w:rPr><w:b/>%s</w:rPr><w:t xml:space="preserve">[CLIENT]</w:t>' % YELLOW, xml)
        self.assertIn('<w:t xml:space="preserve">To </w:t>', xml)
        self.assertIn('<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve"> now</w:t></w:r>', xml)
        self.assertNotIn("<w:i/>", xml, "the middle run held only matched text, so it goes")
        self.assertEqual(result["replaced"], {"[CLIENT]": 1})

    def test_value_in_a_header_and_a_footer(self):
        header = wrap("hdr", para(run("File: ", "<w:b/>"), run("S-1234")))
        footer = wrap("ftr", para(run("S-1234 page")))
        source = self.docx(doc(para(run("Body"))), {"word/header2.xml": header, "word/footer1.xml": footer})
        result = self.run_script(source, [{"value": "S-1234", "placeholder": "[FILE NUMBER]"}])
        self.assertEqual(result["replaced"], {"[FILE NUMBER]": 2})
        self.assertIn(YELLOW + '</w:rPr><w:t xml:space="preserve">[FILE NUMBER]', self.part(result["path"], "word/header2.xml"))
        self.assertIn("[FILE NUMBER]", self.part(result["path"], "word/footer1.xml"))

    def test_highlight_sits_in_schema_order(self):
        rpr = '<w:rFonts w:ascii="Arial"/><w:b/><w:sz w:val="22"/><w:u w:val="single"/><w:lang w:val="en-CA"/>'
        source = self.docx(doc(para(run("Pat Doe", rpr))))
        xml = self.part(self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}])["path"])
        self.assertIn('<w:rFonts w:ascii="Arial"/><w:b/><w:sz w:val="22"/>%s<w:u w:val="single"/><w:lang w:val="en-CA"/>' % YELLOW, xml)

    def test_an_existing_highlight_is_replaced_not_doubled(self):
        source = self.docx(doc(para(run("Pat Doe", '<w:highlight w:val="cyan"/>'))))
        xml = self.part(self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}])["path"])
        self.assertEqual(len(re.findall("<w:highlight", xml)), 1)
        self.assertIn(YELLOW, xml)

    def test_unmatched_paragraphs_and_other_parts_stay_byte_identical(self):
        keep_one = para(run("Keep me  exactly", "<w:b/><w:i/>")).replace("<w:p>", '<w:p w:rsidR="00AA">')
        keep_two = '<w:p w:rsidR="00BB"><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Flush &amp; left</w:t></w:r></w:p>'
        empty_run = "<w:p><w:r><w:rPr><w:b/></w:rPr></w:r></w:p>"
        changed = para(run("Pat Doe"))
        source = self.docx(
            doc(keep_one + changed + keep_two + empty_run),
            {"word/styles.xml": "<w:styles>  odd   spacing </w:styles>", "docProps/app.xml": "<Properties>Word</Properties>"},
        )
        result = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}])
        xml = self.part(result["path"])
        self.assertTrue(xml.startswith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + NS))
        for kept in (keep_one, keep_two, empty_run):
            self.assertIn(kept, xml)
        with zipfile.ZipFile(source) as a, zipfile.ZipFile(result["path"]) as b:
            self.assertEqual(a.namelist(), b.namelist())
            for name in a.namelist():
                if name != "word/document.xml":
                    self.assertEqual(a.read(name), b.read(name), name)

    def test_source_is_not_changed(self):
        source = self.docx(doc(para(run("Pat Doe"))))
        before = source.read_bytes()
        self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}])
        self.assertEqual(source.read_bytes(), before)

    def test_existing_placeholders_survive_a_modify_run(self):
        first = self.docx(doc(para(run("Dear Pat Doe, fee 2%"))))
        made = self.run_script(first, [{"value": "Pat Doe", "placeholder": "[CLIENT]"}])
        # The practitioner edits the precedent in Word and types a new client detail into it.
        edited_xml = self.part(made["path"]).replace("</w:body>", para(run("Reference Client L999")) + "</w:body>")
        edited = self.docx(edited_xml, name="edited.docx")
        result = self.run_script(edited, [{"value": "L999", "placeholder": "[MATTER]"}])
        self.assertTrue(result["success"], result)
        xml = self.part(result["path"])
        self.assertIn(YELLOW + '</w:rPr><w:t xml:space="preserve">[CLIENT]</w:t>', xml)
        self.assertIn("[MATTER]", xml)
        self.assertNotIn("L999", xml)

    def test_a_value_inside_a_highlighted_placeholder_is_left_alone(self):
        placeholder = run("[CLIENT NAME]", YELLOW)
        source = self.docx(doc(para(placeholder, run(" and Client copy"))))
        result = self.run_script(source, [{"value": "Client", "placeholder": "[WHO]"}])
        self.assertTrue(result["success"], result)
        self.assertIn("[CLIENT NAME]", self.part(result["path"]))
        self.assertIn("[WHO]", self.part(result["path"]))

    def test_a_bracketed_value_with_no_highlight_is_still_replaced(self):
        source = self.docx(doc(para(run("[Pat Doe] signed"))))
        result = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}])
        self.assertTrue(result["success"], result)
        self.assertNotIn("Pat Doe", self.part(result["path"]))

    def test_a_longer_value_wins_over_a_shorter_one_inside_it(self):
        source = self.docx(doc(para(run("Pat Doe and Doe"))))
        result = self.run_script(
            source, [{"value": "Doe", "placeholder": "[SURNAME]"}, {"value": "Pat Doe", "placeholder": "[NAME]"}]
        )
        self.assertEqual(result["replaced"], {"[NAME]": 1, "[SURNAME]": 1})

    def test_a_shorter_value_found_only_inside_a_longer_one_counts_as_found(self):
        source = self.docx(doc(para(run("Pat Doe"))))
        result = self.run_script(
            source, [{"value": "Doe", "placeholder": "[SURNAME]"}, {"value": "Pat Doe", "placeholder": "[NAME]"}]
        )
        self.assertTrue(result["success"], result)

    def test_matches_whole_words_only_and_folds_curly_apostrophes_and_nbsp(self):
        source = self.docx(doc(para(run("Pat O’Doe and Pat O'Doe"))))
        result = self.run_script(source, [{"value": "Pat O'Doe", "placeholder": "[C]"}])
        self.assertEqual(result["replaced"], {"[C]": 2})

    def test_a_value_does_not_match_across_a_tab(self):
        tabbed = "<w:p><w:r><w:t>Pat</w:t><w:tab/><w:t>Doe</w:t></w:r></w:p>"
        source = self.docx(doc(tabbed))
        result = self.run_script(source, [{"value": "PatDoe", "placeholder": "[C]"}])
        self.assertEqual(result["error"], "value_not_found")

    def test_a_run_with_a_tab_keeps_it(self):
        tabbed = "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Pat</w:t><w:tab/><w:t>keep</w:t></w:r></w:p>"
        source = self.docx(doc(tabbed))
        xml = self.part(self.run_script(source, [{"value": "Pat", "placeholder": "[C]"}])["path"])
        self.assertIn("<w:tab/><w:t>keep</w:t>", xml)
        self.assertIn("[C]", xml)

    def test_a_text_box_paragraph_is_read_apart_from_its_parent(self):
        box = '<w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Pat Doe</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r>'
        source = self.docx(doc("<w:p><w:r><w:t>Before </w:t></w:r>%s<w:r><w:t>after Pat Doe</w:t></w:r></w:p>" % box))
        result = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}])
        self.assertEqual(result["replaced"], {"[C]": 2})
        self.assertNotIn("Pat Doe", self.part(result["path"]))

    def test_never_overwrites_and_takes_the_next_number(self):
        source = self.docx(doc(para(run("Pat Doe"))))
        first = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}], name="Fee Agreement")
        taken = Path(first["path"]).read_bytes()
        second = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[D]"}], name="Fee Agreement.docx")
        third = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[E]"}], name="Fee Agreement")
        self.assertEqual(Path(first["path"]).name, "Fee Agreement.docx")
        self.assertEqual(Path(second["path"]).name, "Fee Agreement (2).docx")
        self.assertEqual(Path(third["path"]).name, "Fee Agreement (3).docx")
        self.assertEqual(Path(first["path"]).read_bytes(), taken)

    def test_refuses_a_value_not_found(self):
        source = self.docx(doc(para(run("Nothing here"))))
        result = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}])
        self.assertEqual(result["error"], "value_not_found")
        self.assertIn("Pat Doe", result["detail"])
        self.assertWroteNothing()

    def test_refuses_a_file_that_is_not_a_docx(self):
        bad = self.tmp / "old.doc"
        bad.write_bytes(b"not a zip")
        for source in (bad, self.tmp / "missing.docx"):
            self.assertEqual(self.run_script(source, [])["error"], "not_a_docx")
        self.assertWroteNothing()

    def test_refuses_a_folder_that_cannot_be_reached(self):
        source = self.docx(doc(para(run("Pat Doe"))))
        result = self.run_script(source, [{"value": "Pat Doe", "placeholder": "[C]"}], out_dir=self.tmp / "nowhere")
        self.assertEqual(result["error"], "no_folder")

    def test_refuses_a_bad_request(self):
        source = self.docx(doc(para(run("Pat Doe"))))
        cases = (
            ([{"value": "Pat Doe", "placeholder": "CLIENT"}], "Fee"),
            ([{"value": "", "placeholder": "[C]"}], "Fee"),
            ([{"value": "Pat", "placeholder": "[C]"}, {"value": "Pat", "placeholder": "[D]"}], "Fee"),
            ([], "..\\Fee"),
            ([], "sub/Fee"),
        )
        for replacements, name in cases:
            self.assertEqual(self.run_script(source, replacements, name=name)["error"], "bad_request", name)
        self.assertWroteNothing()

    def assertLeftover(self, source, where, name="Fee Agreement", value="Pat Doe"):
        result = self.run_script(source, [{"value": value, "placeholder": "[C]"}], name=name)
        self.assertEqual(result["error"], "leftover", result)
        self.assertEqual({h["where"] for h in json.loads(result["detail"])}, {where})
        self.assertWroteNothing()

    def test_leftover_in_document_properties(self):
        core = "<cp:coreProperties><dc:title>Letter to PAT DOE</dc:title></cp:coreProperties>"
        self.assertLeftover(self.docx(doc(para(run("Pat Doe"))), {"docProps/core.xml": core}), "docProps/core.xml")

    def test_leftover_in_the_output_name(self):
        self.assertLeftover(self.docx(doc(para(run("Pat Doe")))), "the file name", name="Fee Agreement (from pat doe)")

    def test_leftover_in_another_case_or_inside_a_longer_word(self):
        self.assertLeftover(self.docx(doc(para(run("Pat Doe")) + para(run("PAT DOE v. Crown")))), "word/document.xml")
        self.assertLeftover(self.docx(doc(para(run("Doe")) + para(run("File DoeP")))), "word/document.xml", value="Doe")

    def test_leftover_split_across_runs_in_another_case(self):
        self.assertLeftover(self.docx(doc(para(run("Pat Doe")) + para(run("PAT"), run(" DOE")))), "word/document.xml")

    def test_leftover_in_tracked_deletions_comments_and_alt_text(self):
        deleted = "<w:p><w:del><w:r><w:delText>Pat Doe</w:delText></w:r></w:del></w:p>"
        self.assertLeftover(self.docx(doc(para(run("Pat Doe")) + deleted)), "word/document.xml")
        comment = wrap("comments", para(run("ask Pat Doe")))
        self.assertLeftover(self.docx(doc(para(run("Pat Doe"))), {"word/comments.xml": comment}), "word/comments.xml")
        picture = '<w:p><w:r><w:drawing><wp:docPr id="1" name="Picture" descr="Photo of Pat Doe"/></w:drawing></w:r></w:p>'
        self.assertLeftover(self.docx(doc(para(run("Pat Doe")) + picture)), "word/document.xml")

    def test_leftover_in_a_hyperlink_target(self):
        rels = '<Relationships><Relationship Id="r1" Target="mailto:pat.doe@example.com"/></Relationships>'
        source = self.docx(doc(para(run("pat.doe@example.com"))), {"word/_rels/document.xml.rels": rels})
        result = self.run_script(source, [{"value": "pat.doe@example.com", "placeholder": "[EMAIL]"}], name="Fee")
        self.assertEqual(result["error"], "leftover")
        self.assertIn("word/_rels/document.xml.rels", result["detail"])

    def test_a_placeholder_naming_its_value_is_no_leftover(self):
        source = self.docx(doc(para(run("Client copy"))))
        result = self.run_script(source, [{"value": "Client", "placeholder": "[CLIENT]"}])
        self.assertTrue(result["success"], result)

    def test_escaped_text_is_matched_and_written_back_escaped(self):
        source = self.docx(doc(para(run("Doe &amp; Sons, tail &lt;x&gt;"))))
        result = self.run_script(source, [{"value": "Doe & Sons", "placeholder": "[A & B]"}])
        xml = self.part(result["path"])
        self.assertIn("[A &amp; B]", xml)
        self.assertIn(", tail &lt;x&gt;", xml)


if __name__ == "__main__":
    unittest.main()
