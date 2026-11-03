"""client_letter.py: a client letter's Word review draft, on invented data only.

Fills only the registered letterhead, holds the file until a roster lawyer approves it, lifts the hold
without touching anything else, and never overwrites a copy the practitioner may have edited in Word.
"""
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

import support

import client_letter
import render_letterhead

STEM = "2026-11-03 LET Client re invented award"
LETTER = {**support.PAYLOAD, "body": ["First paragraph of invented advice.", "Second paragraph, *as written*."]}


def parts_of(path):
    with zipfile.ZipFile(path) as docx:
        return {name: docx.read(name) for name in docx.namelist()}


def paragraphs(path):
    document = parts_of(path)["word/document.xml"].decode("utf-8")
    return [client_letter.text_of(m.group(0)) for m in client_letter.PARAGRAPH.finditer(document)]


def edit_document(path, old, new):
    """What a practitioner's save in Word does to the body, leaving every other part."""
    parts = parts_of(path)
    document = parts["word/document.xml"].decode("utf-8")
    assert old in document, old
    parts["word/document.xml"] = document.replace(old, new).encode("utf-8")
    support.write_zip(path, parts)


class ClientLetterTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.draft = self.tmp / "0. DRAFT"
        self.draft.mkdir()
        self.template = support.write_zip(self.tmp / "letterhead.docx", support.first_page_template_parts())
        self.signature = self.tmp / "signature.png"
        self.signature.write_bytes(support.png())
        self.use_machine("pe")
        before = os.environ.get("APPDATA"), os.environ.get("COCLERK_CONFIG_PATH")
        os.environ["APPDATA"] = str(self.tmp / "appdata")
        os.environ.pop("COCLERK_CONFIG_PATH", None)

        def restore():
            os.environ.pop("APPDATA", None)
            if before[0] is not None:
                os.environ["APPDATA"] = before[0]
            if before[1] is not None:
                os.environ["COCLERK_CONFIG_PATH"] = before[1]
        self.addCleanup(restore)

    def use_machine(self, person):
        self.person = person
        support.write_config(self.tmp / "appdata", {"person": person, "signature": str(self.signature)})

    def request(self, **extra):
        profile = {"firm_name": support.FIRM_NAME, "roster": support.ROSTER, "letterhead": str(self.template), "person": self.person}
        return {"out_dir": str(self.draft), "output_name": STEM, "letter": LETTER, "profile": profile, **extra}

    def fill(self, **extra):
        return client_letter.fill(self.request(**extra))

    def approve(self, **extra):
        return client_letter.approve(self.request(**extra))

    def refused(self, code, fn, **extra):
        with self.assertRaises(client_letter.Refusal) as caught:
            fn(self.request(**extra))
        self.assertEqual(caught.exception.code, code)

    def test_it_fills_the_first_page_tokens_and_holds_the_letter(self):
        path = self.fill()["path"]
        parts = parts_of(path)
        header = parts["word/header1.xml"].decode("utf-8")
        for value in ("Pat Example", "pat@example.com", "555-0100", "9999.T001"):
            self.assertIn(value, header)
        for name, data in parts.items():
            if name.endswith(".xml"):
                self.assertNotIn(b"{{", data, name)
        self.assertEqual(paragraphs(path)[0], "Counsel's review: pending")

    def test_the_body_is_the_text_given_verbatim(self):
        text = paragraphs(self.fill()["path"])
        self.assertIn("First paragraph of invented advice.", text)
        self.assertIn("Second paragraph, as written.", text)

    def test_only_the_registered_letterhead_is_filled_and_it_stays_as_it_was(self):
        before = Path(self.template).read_bytes()
        request = self.request(template="elsewhere.docx", letterhead="elsewhere.docx")
        path = client_letter.fill(request)["path"]
        self.assertEqual(Path(self.template).read_bytes(), before)
        self.assertEqual(set(parts_of(path)), set(parts_of(self.template)))

    def test_no_letterhead_registered_is_refused_and_nothing_is_written(self):
        request = self.request()
        request["profile"]["letterhead"] = None
        with self.assertRaises(SystemExit):
            client_letter.fill(request)
        self.assertEqual(os.listdir(self.draft), [])

    def test_it_never_signs_even_on_the_signers_machine_with_a_scan_on_file(self):
        parts = parts_of(self.fill()["path"])
        self.assertNotIn(render_letterhead.SIGNATURE_PART, parts)
        self.assertNotIn(b"<w:drawing", parts["word/document.xml"])

    def test_approval_removes_only_the_hold(self):
        path = self.fill()["path"]
        before = parts_of(path)
        text = paragraphs(path)
        result = self.approve()
        self.assertEqual(result["approved_by"], "Pat Example")
        after = parts_of(path)
        self.assertEqual(paragraphs(path), text[2:], "the line and the blank under it go, and nothing else")
        self.assertEqual({k: v for k, v in after.items() if k != "word/document.xml"},
                         {k: v for k, v in before.items() if k != "word/document.xml"})
        self.assertEqual(list(after), list(before), "the part order Word expects stays")

    def test_approval_keeps_the_practitioners_word_edits(self):
        path = self.fill()["path"]
        edit_document(path, "First paragraph of invented advice.", "First paragraph, as the lawyer amended it.")
        self.approve()
        self.assertIn("First paragraph, as the lawyer amended it.", paragraphs(path))

    def test_a_hold_line_word_has_resaved_is_still_found(self):
        path = self.fill()["path"]
        document = parts_of(path)["word/document.xml"].decode("utf-8")
        span = client_letter.hold_span(document)
        resaved = ('<w:p w:rsidR="00AB12CD" w:rsidRDefault="00AB12CD"><w:r><w:t>Counsel&apos;s </w:t></w:r>'
                   '<w:proofErr w:type="spellStart"/><w:r w:rsidRPr="1"><w:t xml:space="preserve">review: </w:t></w:r>'
                   '<w:r><w:t>pending</w:t></w:r></w:p>')
        edit_document(path, document[span[0]:span[1]], '<w:p w:rsidR="1"/>' + resaved)
        self.approve()
        self.assertNotIn("pending", " ".join(paragraphs(path)))

    def test_only_an_active_roster_lawyer_approves(self):
        path = self.fill()["path"]
        before = Path(path).read_bytes()
        for person in ("ss", "fl", "nobody"):
            with self.subTest(person=person):
                self.person = person
                self.refused("not_a_roster_lawyer", client_letter.approve)
        self.assertEqual(Path(path).read_bytes(), before)

    def test_a_file_with_no_hold_is_refused(self):
        self.fill()
        self.approve()
        self.refused("no_hold", client_letter.approve)

    def test_a_file_open_in_word_is_left_alone(self):
        path = Path(self.fill()["path"])
        (self.draft / ("~$" + path.name[2:])).write_bytes(b"owner")
        before = path.read_bytes()
        self.refused("open_in_word", client_letter.approve)
        self.assertEqual(path.read_bytes(), before)

    def test_a_second_fill_never_overwrites_and_must_name_what_it_revises(self):
        path = Path(self.fill()["path"])
        before = path.read_bytes()
        self.refused("copy_exists", client_letter.fill)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(os.listdir(self.draft), [path.name])

    def test_a_revision_is_the_next_copy_and_leaves_word_edits_in_the_earlier_one(self):
        first = Path(self.fill()["path"])
        edit_document(first, "First paragraph of invented advice.", "The lawyer's own wording.")
        edited = first.read_bytes()
        result = self.fill(revises=STEM)
        self.assertTrue(result["path"].endswith(STEM + " v2.docx"))
        self.assertEqual(result["versioned_from"], str(first))
        self.assertEqual(first.read_bytes(), edited, "a held earlier copy is not touched at all")
        self.assertNotIn("hold_restored_on", result)
        self.assertEqual(paragraphs(result["path"])[0], "Counsel's review: pending")

    def test_a_revision_after_approval_puts_the_hold_back_on_the_approved_copy(self):
        first = self.fill()["path"]
        edit_document(first, "First paragraph of invented advice.", "The lawyer's own wording.")
        self.approve()
        result = self.fill(revises=STEM)
        self.assertEqual(result["hold_restored_on"], first)
        self.assertEqual(paragraphs(first)[0], "Counsel's review: pending")
        self.assertIn("The lawyer's own wording.", paragraphs(first))

    def test_a_revision_must_name_the_newest_copy(self):
        self.fill()
        self.fill(revises=STEM)
        self.refused("newer_copy", client_letter.fill, revises=STEM)

    def test_only_the_newest_copy_is_approved(self):
        self.fill()
        self.fill(revises=STEM)
        self.refused("newer_copy", client_letter.approve)
        self.assertTrue(self.approve(output_name=STEM + " v2")["path"].endswith(" v2.docx"))

    def test_the_script_reports_a_stop_as_a_refusal_line(self):
        request = json.dumps({"action": "fill", **self.request(letter={"signer": "pe"})})
        import subprocess
        import sys
        proc = subprocess.run([sys.executable, "-B", client_letter.__file__], input=request.encode("utf-8"),
                              capture_output=True, env={**os.environ, "PYTHONUTF8": "1"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["error"], "letterhead_refused")
        self.assertIn("missing required field", result["detail"])


if __name__ == "__main__":
    unittest.main()
