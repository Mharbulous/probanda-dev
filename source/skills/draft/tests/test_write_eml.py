"""write_eml.py (#1453): the unsent Outlook draft writer. Every test stubs the Outlook registry
and the Signatures folder, so none reads this machine's Outlook profile."""

import ast
import base64
import importlib.util
import os
import re
import struct
import sys
import zlib
from email import policy
from email.parser import BytesParser
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "write_eml.py"
_spec = importlib.util.spec_from_file_location("write_eml", SCRIPT)
write_eml = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(write_eml)

SENDER = "pat@example.com"
BODY = "Dear Bert,\n\nPlease pay the invoice by Friday.\nIt is now overdue — 30 days.\n\nThank you"


def png(rgb):
    """A valid 1x1 PNG of one colour."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00" + bytes(rgb))) + chunk(b"IEND", b""))


def no_accounts():
    return []


def request(out_dir, **extra):
    return dict({"from_name": "Pat Example", "from_address": SENDER, "to": ["Bert Other <bert@example.org>"],
                 "subject": "Invoice 7413", "body": BODY, "out_dir": str(out_dir), "out_name": "2026-10-02 EM Bert re invoice"},
                **extra)


def parse(path):
    with open(path, "rb") as f:
        return BytesParser(policy=policy.default).parse(f)


@pytest.fixture
def signatures(tmp_path):
    """An Outlook-written signature: windows-1252, a VML block, the !vml fallback markers, two
    relative images in its _files folder, one remote image, and a UTF-16 .txt."""
    folder = tmp_path / "Signatures"
    files = folder / "Logica Law_files"
    files.mkdir(parents=True)
    (files / "image001.png").write_bytes(png((200, 0, 0)))
    (files / "image002.png").write_bytes(png((0, 0, 200)))
    htm = ('<html xmlns:v="urn:schemas-microsoft-com:vml">\r\n<head>\r\n'
           '<meta http-equiv=Content-Type content="text/html; charset=windows-1252">\r\n'
           '<link rel=File-List href="Logica%20Law_files/filelist.xml">\r\n</head>\r\n'
           '<body lang=EN-CA style=\'word-wrap:break-word\'>\r\n<div class=WordSection1>\r\n'
           '<p class=MsoNormal>Pat Example — Barrister</p>\r\n'
           '<p class=MsoNormal><!--[if gte vml 1]><v:shape id="Picture_x0020_1" style=\'width:90pt\'>'
           '<v:imagedata src="Logica%20Law_files/image001.png" o:title=""/></v:shape><![endif]-->'
           '<![if !vml]><img width=120 height=40 src="Logica%20Law_files/image001.png" v:shapes="Picture_x0020_1"><![endif]>'
           '</p>\r\n<p class=MsoNormal><img width=16 height=16 src="Logica%20Law_files/image002.png" alt=x>'
           '<img src="https://example.com/badge.png"></p>\r\n'
           '<p class=MsoNormal><img src=\'Logica%20Law_files/image001.png\'></p>\r\n</div>\r\n</body>\r\n</html>\r\n')
    (folder / "Logica Law.htm").write_bytes(htm.encode("cp1252"))
    (folder / "Logica Law.txt").write_bytes("﻿Pat Example — Barrister\r\nLogica Law\r\n".encode("utf-16-le"))
    return folder


def test_plain_draft_parses_back_with_its_headers_and_the_body_exact(tmp_path):
    result = write_eml.run(request(tmp_path, cc=["cara@example.net"]), no_accounts, tmp_path)
    assert result["success"] is True
    assert result["path"] == str(tmp_path / "2026-10-02 EM Bert re invoice.eml")
    assert result["signature"] is None
    assert "no Outlook account" in result["signature_note"]
    assert result["attachments"] == []
    assert "versioned_from" not in result
    msg = parse(result["path"])
    assert msg["X-Unsent"] == "1"
    assert msg["From"] == "Pat Example <pat@example.com>"
    assert msg["To"] == "Bert Other <bert@example.org>"
    assert msg["Cc"] == "cara@example.net"
    assert msg["Subject"] == "Invoice 7413"
    assert msg["Date"] is None and msg["Message-ID"] is None
    assert msg.get_content_type() == "text/plain"
    assert msg.get_content() == BODY
    assert os.listdir(tmp_path) == ["2026-10-02 EM Bert re invoice.eml"]


def test_html_draft_from_a_signature(tmp_path, signatures):
    out = tmp_path / "out"
    out.mkdir()
    accounts = lambda: [(SENDER, "Logica Law")]
    result = write_eml.run(request(out), accounts, signatures)
    assert result["signature"] == "Logica Law"
    assert "signature_note" not in result
    msg = parse(result["path"])
    assert msg.get_content_type() == "multipart/alternative"
    text = msg.get_body(("plain",)).get_content()
    assert text == BODY + "\n\nPat Example — Barrister\nLogica Law\n"
    related = msg.get_payload()[1]
    assert related.get_content_type() == "multipart/related"
    page = msg.get_body(("html",)).get_content()
    assert "<!--[if gte vml 1]>" not in page and "<![if !vml]>" not in page and "<![endif]>" not in page
    assert 'charset=utf-8"' in page and "windows-1252" not in page
    assert "Pat Example — Barrister" in page
    assert re.search(r"<body[^>]*>\s*<p>Dear Bert,</p><p>Please pay the invoice by Friday\.<br>It is now overdue "
                     r"— 30 days\.</p><p>Thank you</p><p>&nbsp;</p>", page)
    srcs = re.findall(r"<img\b[^>]*?\ssrc=[\"']([^\"']*)", page)
    assert srcs == ["cid:image001@signature", "cid:image002@signature", "https://example.com/badge.png", "cid:image001@signature"]
    inline = {part["Content-ID"]: part for part in related.iter_parts() if part.get_content_maintype() == "image"}
    assert sorted(inline) == ["<image001@signature>", "<image002@signature>"]
    for part in inline.values():
        assert part.get_content_disposition() == "inline"
    assert inline["<image002@signature>"].get_content() == (signatures / "Logica Law_files" / "image002.png").read_bytes()


def test_data_uri_images_become_inline_cid_parts(tmp_path, signatures):
    # Outlook often writes the <img> fallback as a base64 data: URI, with a space after the comma
    # and line breaks inside, and keeps the _files copy only for the VML block (Brahm's signature).
    image = png((0, 200, 0))
    encoded = base64.b64encode(image).decode("ascii")
    uri = "data:image/png;base64, " + encoded[:20] + "\r\n" + encoded[20:]
    htm = signatures / "Logica Law.htm"
    htm.write_bytes(htm.read_bytes().replace(b'src="Logica%20Law_files/image002.png"', ('src="%s"' % uri).encode("ascii")))
    result = write_eml.run(request(tmp_path), lambda: [(SENDER, "Logica Law")], signatures)
    msg = parse(result["path"])
    page = msg.get_body(("html",)).get_content()
    assert "data:" not in page
    srcs = re.findall(r"<img\b[^>]*?\ssrc=[\"']([^\"']*)", page)
    assert srcs == ["cid:image001@signature", "cid:image002@signature", "https://example.com/badge.png", "cid:image001@signature"]
    inline = {part["Content-ID"]: part for part in msg.get_payload()[1].iter_parts() if part.get_content_maintype() == "image"}
    assert inline["<image002@signature>"].get_content() == image
    assert inline["<image002@signature>"].get_content_type() == "image/png"


def test_a_missing_signature_image_is_refused_naming_it(tmp_path, signatures):
    (signatures / "Logica Law_files" / "image002.png").unlink()
    with pytest.raises(write_eml.Refusal) as refused:
        write_eml.run(request(tmp_path), lambda: [(SENDER, "Logica Law")], signatures)
    assert refused.value.code == "signature_image_missing"
    assert "image002.png" in refused.value.detail
    assert not list(tmp_path.glob("*.eml"))


def utf16(text):
    return (text + "\x00").encode("utf-16-le")


@pytest.mark.parametrize("accounts, name, note", [
    ([("Pat@Example.com", "Logica Law"), ("other@example.com", "Other")], "Logica Law", None),
    ([(utf16(SENDER), utf16("Logica Law"))], "Logica Law", None),
    ([(SENDER, "Logica Law"), (SENDER, "Short")], None, "several default signatures: Logica Law, Short"),
    ([(SENDER, "Logica Law"), (SENDER, "Logica Law")], "Logica Law", None),
    ([("other@example.com", "Other"), (SENDER, None)], None, "no Outlook account for pat@example.com"),
    ([(SENDER, "Gone")], None, "Gone.htm"),
])
def test_signature_resolution(signatures, accounts, name, note):
    found = write_eml.resolve_signature(SENDER, lambda: accounts, signatures)
    assert found["name"] == name
    if note:
        assert note in found["note"]
    else:
        assert found["htm"] == signatures / "Logica Law.htm"


def test_no_windows_is_soft_and_any_other_registry_error_is_a_refusal(signatures):
    def not_windows():
        raise ModuleNotFoundError("No module named 'winreg'")

    def denied():
        raise PermissionError(5, "Access is denied")

    assert write_eml.resolve_signature(SENDER, not_windows, signatures)["name"] is None
    with pytest.raises(write_eml.Refusal) as refused:
        write_eml.resolve_signature(SENDER, denied, signatures)
    assert refused.value.code == "signature_registry_error"
    assert "Access is denied" in refused.value.detail
    with pytest.raises(write_eml.Refusal) as refused:
        write_eml.resolve_signature(SENDER, lambda: [(SENDER, b"\x41")], signatures)
    assert refused.value.code == "signature_registry_error"


def test_a_signature_in_an_unknown_charset_is_refused(tmp_path, signatures):
    htm = signatures / "Logica Law.htm"
    htm.write_bytes(htm.read_bytes().replace(b"windows-1252", b"x-no-such-charset"))
    with pytest.raises(write_eml.Refusal) as refused:
        write_eml.run(request(tmp_path), lambda: [(SENDER, "Logica Law")], signatures)
    assert refused.value.code == "signature_unusable"
    assert not list(tmp_path.glob("*.eml"))


def test_a_from_name_that_cannot_head_an_address_is_refused(tmp_path):
    with pytest.raises(write_eml.Refusal) as refused:
        write_eml.run(request(tmp_path, from_name="Pat\nExample"), no_accounts, tmp_path)
    assert refused.value.code == "bad_address"
    assert os.listdir(tmp_path) == []


def test_a_new_out_dir_is_made_only_once_every_check_has_passed(tmp_path):
    new = tmp_path / "Bert letters"
    with pytest.raises(write_eml.Refusal):
        write_eml.run(request(new, attachments=[str(tmp_path / "gone.pdf")]), no_accounts, tmp_path)
    assert not new.exists()
    result = write_eml.run(request(new), no_accounts, tmp_path)
    assert result["path"] == str(new / "2026-10-02 EM Bert re invoice.eml")


def test_unresolved_attachments_are_named_together_and_nothing_is_written(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    present = tmp_path / "invoice.pdf"
    present.write_bytes(b"%PDF-1.4")
    gone = [str(tmp_path / "gone.pdf"), str(tmp_path / "also gone.docx")]
    with pytest.raises(write_eml.Refusal) as refused:
        write_eml.run(request(out, attachments=[str(present), *gone]), no_accounts, tmp_path)
    assert refused.value.code == "attachment_unresolved"
    for path in gone:
        assert path in refused.value.detail
    assert str(present) not in refused.value.detail
    assert os.listdir(out) == []


def test_attachments_wrap_the_body_in_multipart_mixed(tmp_path):
    present = tmp_path / "invoice.pdf"
    present.write_bytes(b"%PDF-1.4")
    result = write_eml.run(request(tmp_path, attachments=[str(present)]), no_accounts, tmp_path)
    assert result["attachments"] == [{"name": "invoice.pdf", "size": 8}]
    msg = parse(result["path"])
    assert msg.get_content_type() == "multipart/mixed"
    assert msg.get_body(("plain",)).get_content() == BODY
    [attachment] = msg.iter_attachments()
    assert (attachment.get_content_type(), attachment.get_filename()) == ("application/pdf", "invoice.pdf")
    assert attachment.get_content() == b"%PDF-1.4"


def test_a_taken_name_versions_to_v2_and_leaves_the_first_copy(tmp_path):
    first = write_eml.run(request(tmp_path), no_accounts, tmp_path)
    before = Path(first["path"]).read_bytes()
    again = write_eml.run(request(tmp_path, subject="Invoice 7413, again"), no_accounts, tmp_path)
    assert again["path"] == str(tmp_path / "2026-10-02 EM Bert re invoice v2.eml")
    assert again["versioned_from"] == first["path"]
    assert Path(first["path"]).read_bytes() == before
    assert sorted(os.listdir(tmp_path)) == ["2026-10-02 EM Bert re invoice v2.eml", "2026-10-02 EM Bert re invoice.eml"]


def test_imports_only_the_standard_library():
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            modules.add(node.module.split(".")[0])
    assert modules and modules <= set(sys.stdlib_module_names), modules - set(sys.stdlib_module_names)
