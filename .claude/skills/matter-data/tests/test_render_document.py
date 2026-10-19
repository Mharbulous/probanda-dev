import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
TEST_TMP = CASE_DATA_ROOT.parents[2] / ".test-tmp"
TEST_TMP.mkdir(exist_ok=True)
FIXTURES = CASE_DATA_ROOT / "tests" / "fixtures"

sys.path.insert(0, str(CASE_DATA_ROOT / "references" / "scripts"))

spec = importlib.util.spec_from_file_location(
    "render_document", CASE_DATA_ROOT / "references" / "scripts" / "render_document.py"
)
render_document = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render_document)


class RenderDocxTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)

    def tearDown(self):
        self.tempdir.cleanup()

    def render(self):
        text, paragraph_count, attachments = render_document.render_docx(
            str(FIXTURES / "sample.docx")
        )
        return text, paragraph_count, attachments

    def test_paragraph_sequence_includes_table_cell(self):
        text, paragraph_count, attachments = self.render()
        self.assertEqual(paragraph_count, 4)
        self.assertEqual(attachments, [])
        lines = text.splitlines()
        self.assertEqual(lines[0], "¶1\tFirst paragraph.")
        self.assertEqual(lines[1], "¶2\tSecond paragraph with extra spaces.")
        self.assertEqual(lines[2], "¶3\tTable cell paragraph.")
        self.assertEqual(lines[3], "¶4\tLast paragraph.")

    def test_determinism_via_cli(self):
        out1 = Path(self.tempdir.name) / "run1"
        out2 = Path(self.tempdir.name) / "run2"
        rc1 = render_document.main([str(FIXTURES / "sample.docx"), str(out1)])
        rc2 = render_document.main([str(FIXTURES / "sample.docx"), str(out2)])
        self.assertEqual(rc1, 0)
        self.assertEqual(rc2, 0)
        text1 = (out1 / "sample.docx.txt").read_bytes()
        text2 = (out2 / "sample.docx.txt").read_bytes()
        self.assertEqual(text1, text2)

    def test_head_chars_writes_the_head_beside_the_rendering(self):
        out = Path(self.tempdir.name) / "head"
        rc = render_document.main([str(FIXTURES / "sample.docx"), str(out), "--head-chars", "20"])
        self.assertEqual(rc, 0)
        whole = (out / "sample.docx.txt").read_text(encoding="utf-8")
        self.assertEqual((out / "sample.docx.head.txt").read_text(encoding="utf-8"), whole[:20])

    def test_head_chars_must_be_a_positive_integer(self):
        out = Path(self.tempdir.name) / "bad"
        for value in ("0", "-5", "many"):
            with self.subTest(value=value):
                rc = render_document.main([str(FIXTURES / "sample.docx"), str(out), "--head-chars", value])
                self.assertEqual(rc, 2)
                self.assertFalse(out.exists())


class RenderEmlTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)

    def tearDown(self):
        self.tempdir.cleanup()

    def render(self):
        return render_document.render_eml(str(FIXTURES / "sample.eml"))

    def test_header_block_and_body_paragraphs(self):
        text, paragraph_count, attachments = self.render()
        self.assertEqual(paragraph_count, 3)
        lines = text.splitlines()
        header_lines = [l for l in lines if l.startswith("hdr\t")]
        self.assertEqual(
            header_lines,
            [
                "hdr\tFrom: Jane Counsel <jane@examplefirm.test>",
                "hdr\tTo: John Client <john@example.test>",
                "hdr\tDate: Mon, 01 Jun 2026 09:30:00 -0700",
                "hdr\tSubject: Re: Settlement offer",
            ],
        )
        body_lines = [l for l in lines if l.startswith("¶")]
        self.assertEqual(len(body_lines), 3)
        self.assertIn("Please see the attached settlement offer for your review.", body_lines[0])
        self.assertIn("Regards, Jane", body_lines[2])

    def test_attachment_metadata_no_content_written(self):
        text, _paragraph_count, attachments = self.render()
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0]["name"], "offer.txt")
        import hashlib
        expected_sha256 = hashlib.sha256(b"OFFER TERMS\n").hexdigest()
        self.assertEqual(attachments[0]["sha256"], expected_sha256)
        self.assertIn("Attachment: offer.txt", text)
        # Rendered text carries the filename only -- never attachment bytes.
        self.assertNotIn("OFFER TERMS", text)

    def test_attachment_bytes_written_when_dir_given(self):
        att_dir = Path(self.tempdir.name) / "atts"
        _text, _count, attachments = render_document.render_eml(
            str(FIXTURES / "sample.eml"), str(att_dir))
        self.assertEqual(attachments[0]["size"], 12)
        self.assertEqual(attachments[0]["content_type"], "text/plain")
        self.assertEqual(Path(attachments[0]["path"]).read_bytes(), b"OFFER TERMS\n")

    def test_determinism_via_cli(self):
        out1 = Path(self.tempdir.name) / "run1"
        out2 = Path(self.tempdir.name) / "run2"
        rc1 = render_document.main([str(FIXTURES / "sample.eml"), str(out1)])
        rc2 = render_document.main([str(FIXTURES / "sample.eml"), str(out2)])
        self.assertEqual(rc1, 0)
        self.assertEqual(rc2, 0)
        text1 = (out1 / "sample.eml.txt").read_bytes()
        text2 = (out2 / "sample.eml.txt").read_bytes()
        self.assertEqual(text1, text2)


def build_msg(top, recips=(), attachs=()):
    """Write a minimal Outlook .msg (compound file) from stream dicts.

    top / each recip / each attach: {stream_name: bytes}. Streams under 4096
    bytes land in the mini stream and larger ones in FAT sectors, so both of
    the reader's paths run.
    """
    FREE, END = 0xFFFFFFFF, 0xFFFFFFFE
    entries = []

    def add(name, typ, data=b""):
        entries.append({"name": name, "type": typ, "right": FREE,
                        "child": FREE, "data": data, "start": END})
        return len(entries) - 1

    def add_children(parent, items):
        prev = None
        for name, typ, data, kids in items:
            i = add(name, typ, data)
            if prev is None:
                entries[parent]["child"] = i
            else:
                entries[prev]["right"] = i
            prev = i
            if kids:
                add_children(i, kids)

    def streams(d):
        return [(n, 2, b, None) for n, b in d.items()]

    root = add("Root Entry", 5)
    items = streams(top)
    items += [(f"__recip_version1.0_#{i:08X}", 1, b"", streams(r))
              for i, r in enumerate(recips)]
    items += [(f"__attach_version1.0_#{i:08X}", 1, b"", streams(a))
              for i, a in enumerate(attachs)]
    add_children(root, items)

    def pad(b, size):
        return b + b"\0" * (-len(b) % size)

    mini, minifat = b"", []
    for e in entries:
        if e["type"] == 2 and 0 < len(e["data"]) < 4096:
            n = -(-len(e["data"]) // 64)
            e["start"] = len(minifat)
            minifat += list(range(e["start"] + 1, e["start"] + n)) + [END]
            mini += pad(e["data"], 64)

    fat, sectors = [0xFFFFFFFD], [None]  # sector 0 is the FAT itself

    def alloc(data):
        data = pad(data, 512)
        n = len(data) // 512
        start = len(fat)
        fat.extend(list(range(start + 1, start + n)) + [END])
        sectors.extend(data[i:i + 512] for i in range(0, len(data), 512))
        return start

    for e in entries:
        if e["type"] == 2 and len(e["data"]) >= 4096:
            e["start"] = alloc(e["data"])
    entries[root]["start"] = alloc(mini)
    entries[root]["data"] = mini
    first_minifat = alloc(b"".join(v.to_bytes(4, "little") for v in minifat))
    n_minifat = len(fat) - first_minifat

    dir_bytes = b""
    for e in entries:
        name = (e["name"] + "\0").encode("utf-16-le")
        dir_bytes += (pad(name, 64) + len(name).to_bytes(2, "little")
                      + bytes([e["type"], 1])
                      + FREE.to_bytes(4, "little")
                      + e["right"].to_bytes(4, "little")
                      + e["child"].to_bytes(4, "little")
                      + b"\0" * 36
                      + e["start"].to_bytes(4, "little")
                      + len(e["data"]).to_bytes(8, "little"))
    first_dir = alloc(dir_bytes)
    assert len(fat) <= 128, "fixture outgrew one FAT sector"
    sectors[0] = pad(b"".join(v.to_bytes(4, "little") for v in fat)
                     + FREE.to_bytes(4, "little") * (128 - len(fat)), 512)

    def u16(v):
        return v.to_bytes(2, "little")

    def u32(v):
        return v.to_bytes(4, "little")

    header = (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 16
              + u16(0x3E) + u16(3) + u16(0xFFFE) + u16(9) + u16(6) + b"\0" * 6
              + u32(0) + u32(1) + u32(first_dir) + u32(0) + u32(4096)
              + u32(first_minifat) + u32(n_minifat) + u32(END) + u32(0)
              + u32(0) + u32(FREE) * 108)
    return header + b"".join(sectors)


def props(header_len, fixed):
    """A __properties_version1.0 stream: {tag: 8-byte value}."""
    out = b"\0" * header_len
    for tag, value in fixed.items():
        out += tag.to_bytes(4, "little") + b"\0" * 4 + value.ljust(8, b"\0")
    return out


def u(text):
    return text.encode("utf-16-le")


# 2026-06-01 16:30:00 UTC as a FILETIME.
import datetime
SENT_FILETIME = (int((datetime.datetime(2026, 6, 1, 16, 30, tzinfo=datetime.timezone.utc)
                      - datetime.datetime(1601, 1, 1, tzinfo=datetime.timezone.utc)
                      ).total_seconds()) * 10_000_000).to_bytes(8, "little")
BIG_ATTACHMENT = b"%PDF-1.4\n" + b"x" * 5000


def recip(name, addr, kind):
    return {"__properties_version1.0": props(8, {0x0C150003: kind.to_bytes(4, "little")}),
            "__substg1.0_3001001F": u(name), "__substg1.0_39FE001F": u(addr)}


def plain_msg():
    return build_msg(
        {
            "__properties_version1.0": props(32, {0x00390040: SENT_FILETIME}),
            "__substg1.0_0037001F": u("Re: Règlement — 和解 offer"),
            "__substg1.0_0C1A001F": u("Jane Counsel"),
            "__substg1.0_5D01001F": u("jane@examplefirm.test"),
            "__substg1.0_007D001F": u(
                "Date: Mon, 01 Jun 2026 09:30:00 -0700\r\n"
                "Message-ID: <abc123@examplefirm.test>\r\n"
                "In-Reply-To: <prev456@example.test>\r\n\r\n"),
            "__substg1.0_1000001F": u(
                "Cher Monsieur Côté,\r\n\r\nVeuillez trouver l’offre ci-jointe. "
                "金額は ¥500,000 です。\r\n\r\nRegards,\r\nJane"),
        },
        recips=[recip("John Client", "john@example.test", 1),
                recip("Ann Copy", "ann@example.test", 2),
                recip("Bob Blind", "bob@example.test", 3)],
        attachs=[
            {"__properties_version1.0": props(8, {}),
             "__substg1.0_3707001F": u("offer.txt"),
             "__substg1.0_370E001F": u("text/plain"),
             "__substg1.0_37010102": b"OFFER TERMS\n"},
            {"__properties_version1.0": props(8, {}),
             "__substg1.0_3707001F": u("Exhibit é.pdf"),
             "__substg1.0_37010102": BIG_ATTACHMENT},
        ],
    )


def html_only_msg():
    return build_msg({
        "__properties_version1.0": props(32, {
            0x00390040: SENT_FILETIME,
            0x3FDE0003: (65001).to_bytes(4, "little")}),
        "__substg1.0_0037001F": u("HTML only"),
        "__substg1.0_0C1A001F": u("Jane Counsel"),
        "__substg1.0_10130102": (
            "<html><head><style>p{color:red}</style></head><body>"
            "<p>First &amp; foremost, café.</p>\n\n<p>Second <b>para</b>.</p>"
            "</body></html>").encode("utf-8"),
    })


class RenderMsgTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)
        self.dir = Path(self.tempdir.name)

    def tearDown(self):
        self.tempdir.cleanup()

    def write(self, name, data):
        path = self.dir / name
        path.write_bytes(data)
        return str(path)

    def test_headers_recipients_and_non_ascii_body(self):
        text, paragraph_count, _ = render_document.render_msg(
            self.write("plain.msg", plain_msg()))
        lines = text.splitlines()
        self.assertEqual(
            [l for l in lines if l.startswith("hdr\t")],
            [
                "hdr\tFrom: Jane Counsel <jane@examplefirm.test>",
                "hdr\tTo: John Client <john@example.test>",
                "hdr\tCc: Ann Copy <ann@example.test>",
                "hdr\tBcc: Bob Blind <bob@example.test>",
                "hdr\tDate: Mon, 01 Jun 2026 09:30:00 -0700",
                "hdr\tSubject: Re: Règlement — 和解 offer",
                "hdr\tMessage-ID: <abc123@examplefirm.test>",
                "hdr\tIn-Reply-To: <prev456@example.test>",
            ],
        )
        self.assertEqual(paragraph_count, 3)
        self.assertEqual(lines[8], "¶1\tCher Monsieur Côté,")
        self.assertEqual(
            lines[9], "¶2\tVeuillez trouver l’offre ci-jointe. 金額は ¥500,000 です。")
        self.assertEqual(lines[10], "¶3\tRegards, Jane")

    def test_attachments_listed_hashed_and_extracted(self):
        import hashlib
        att_dir = self.dir / "atts"
        text, _, attachments = render_document.render_msg(
            self.write("plain.msg", plain_msg()), str(att_dir))
        self.assertEqual([a["name"] for a in attachments], ["offer.txt", "Exhibit é.pdf"])
        self.assertEqual(attachments[0]["size"], 12)
        self.assertEqual(attachments[0]["content_type"], "text/plain")
        self.assertEqual(attachments[0]["sha256"],
                         hashlib.sha256(b"OFFER TERMS\n").hexdigest())
        self.assertEqual(attachments[1]["content_type"], "application/pdf")
        self.assertEqual(Path(attachments[0]["path"]).read_bytes(), b"OFFER TERMS\n")
        self.assertEqual(Path(attachments[1]["path"]).read_bytes(), BIG_ATTACHMENT)
        self.assertIn("Attachment: offer.txt (12 bytes, text/plain)", text)
        self.assertNotIn("OFFER TERMS", text)

    def test_html_only_body_and_utc_date_fallback(self):
        text, paragraph_count, attachments = render_document.render_msg(
            self.write("html.msg", html_only_msg()))
        lines = text.splitlines()
        self.assertEqual(attachments, [])
        self.assertEqual(paragraph_count, 2)
        self.assertIn(
            "hdr\tDate: 2026-06-01T16:30:00+00:00 (UTC; original time zone not recorded)",
            lines)
        self.assertEqual(lines[-2], "¶1\tFirst & foremost, café.")
        self.assertEqual(lines[-1], "¶2\tSecond para .")

    def test_determinism_via_cli(self):
        src = self.write("plain.msg", plain_msg())
        out1, out2 = self.dir / "run1", self.dir / "run2"
        self.assertEqual(render_document.main([src, str(out1)]), 0)
        self.assertEqual(render_document.main([src, str(out2)]), 0)
        self.assertEqual((out1 / "plain.msg.txt").read_bytes(),
                         (out2 / "plain.msg.txt").read_bytes())
        self.assertTrue((out1 / "plain.msg.attachments" / "1_offer.txt").exists())

    def test_corrupt_msg_exits_nonzero_no_output(self):
        bad = self.write("bad.msg", b"not a compound file")
        out_dir = self.dir / "out"
        self.assertNotEqual(render_document.main([bad, str(out_dir)]), 0)
        self.assertFalse((out_dir / "bad.msg.txt").exists())

    def test_msg_without_readable_body_is_refused(self):
        no_body = build_msg({
            "__properties_version1.0": props(32, {}),
            "__substg1.0_0037001F": u("No body"),
        })
        with self.assertRaises(render_document.RenderError):
            render_document.render_msg(self.write("nobody.msg", no_body))


class RenderRtfTests(unittest.TestCase):
    """Westlaw .doc downloads are RTF with every case name inside a HYPERLINK field
    whose instruction is not braced; pandoc drops those field results (#1410)."""

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)
        self.dir = Path(self.tempdir.name)

    def tearDown(self):
        self.tempdir.cleanup()

    def rtf(self, body):
        return render_document.render_rtf_bytes(body.encode("latin-1"))

    def test_field_result_text_kept_in_place(self):
        text, paragraph_count, attachments = render_document.render_rtf(
            str(FIXTURES / "westlaw-field.doc"))
        self.assertEqual(paragraph_count, 2)
        self.assertEqual(attachments, [])
        self.assertEqual(text.splitlines(), [
            "45 The outcome is determined on its own facts with the court being guided "
            "by the factors summarized in Anenda, and the question of whether or not it "
            "is in the overall interests of justice.",
            "46 In Anenda the court quoted the café owner’s “notice” "
            "– see para. 23.",
        ])

    def test_no_field_instructions_or_non_text_destinations(self):
        text, _, _ = render_document.render_rtf(str(FIXTURES / "westlaw-field.doc"))
        for leak in ("HYPERLINK", "http", "example.test", "Invented", "89504e",
                     "Example Generator", "Times New Roman", "co_document_1", "?"):
            self.assertNotIn(leak, text)

    def test_cli_renders_doc_and_rtf_deterministically(self):
        src = self.dir / "Decision.rtf"
        src.write_bytes((FIXTURES / "westlaw-field.doc").read_bytes())
        for name in (str(FIXTURES / "westlaw-field.doc"), str(src)):
            out1, out2 = self.dir / "a", self.dir / "b"
            self.assertEqual(render_document.main([name, str(out1)]), 0)
            self.assertEqual(render_document.main([name, str(out2)]), 0)
            base = Path(name).name + ".txt"
            self.assertEqual((out1 / base).read_bytes(), (out2 / base).read_bytes())
            self.assertIn("summarized in Anenda, and", (out1 / base).read_text(encoding="utf-8"))

    def test_binary_word_doc_refused_no_output(self):
        bad = self.dir / "binary.doc"
        bad.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 504)
        out_dir = self.dir / "out"
        self.assertNotEqual(render_document.main([str(bad), str(out_dir)]), 0)
        self.assertFalse((out_dir / "binary.doc.txt").exists())

    def test_unbalanced_braces_refused_no_output(self):
        bad = self.dir / "broken.doc"
        bad.write_bytes(b"{\\rtf1\\ansi {\\b text\\par}")
        out_dir = self.dir / "out"
        self.assertNotEqual(render_document.main([str(bad), str(out_dir)]), 0)
        self.assertFalse((out_dir / "broken.doc.txt").exists())
        with self.assertRaises(render_document.RenderError):
            self.rtf("{\\rtf1 text}}")

    def test_bin_payload_skipped(self):
        text, _, _ = self.rtf("{\\rtf1\\ansi {\\pict\\bin3 }{}}Visible\\par}")
        self.assertEqual(text, "Visible\n")

    def test_unicode_fallback_count_and_code_page(self):
        self.assertEqual(self.rtf("{\\rtf1 \\u8212?x\\par}")[0], "—x\n")
        self.assertEqual(self.rtf("{\\rtf1 \\uc0\\u8212 x\\par}")[0], "—x\n")
        self.assertEqual(self.rtf("{\\rtf1\\ansi\\ansicpg1251 \\'c0\\par}")[0], "А\n")

    def test_nested_field_inside_result(self):
        text, _, _ = self.rtf(
            '{\\rtf1 {\\field{\\*\\fldinst HYPERLINK "u1"}{\\fldrslt Outer '
            '{\\field{\\*\\fldinst HYPERLINK "u2"}{\\fldrslt Inner}}}}\\par}')
        self.assertEqual(text, "Outer Inner\n")


class RenderFailureTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_unsupported_extension_exits_nonzero_no_output(self):
        junk = Path(self.tempdir.name) / "sample.xyz"
        junk.write_text("junk")
        out_dir = Path(self.tempdir.name) / "out"
        rc = render_document.main([str(junk), str(out_dir)])
        self.assertNotEqual(rc, 0)
        self.assertFalse((out_dir / "sample.xyz.txt").exists())

    def test_corrupt_docx_exits_nonzero_no_output(self):
        bad = Path(self.tempdir.name) / "bad.docx"
        bad.write_text("not a zip file")
        out_dir = Path(self.tempdir.name) / "out"
        rc = render_document.main([str(bad), str(out_dir)])
        self.assertNotEqual(rc, 0)
        self.assertFalse((out_dir / "bad.docx.txt").exists())


if __name__ == "__main__":
    unittest.main()
