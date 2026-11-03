"""Shared fixtures for the letterhead tests.

The firm's real letterhead is private and never ships with the skill, so renderer tests
run against a synthetic letterhead and firm profile built here, with a synthetic
coclerk.json under a temporary APPDATA.
"""
from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

PUBLISH_ROOT = Path(__file__).resolve().parents[1]
RENDER_LETTERHEAD = PUBLISH_ROOT / "scripts" / "render_letterhead.py"
sys.path.insert(0, str(PUBLISH_ROOT / "scripts"))
sys.path.insert(0, str(PUBLISH_ROOT / "subskills" / "publish-general" / "scripts"))

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_RELS = "http://schemas.openxmlformats.org/package/2006/relationships"
IMAGE_REL = R + "/image"

SECT_PR = ('<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>'
           '<w:footerReference w:type="default" r:id="rIdFooter"/>'
           '<w:pgSz w:w="12240" w:h="15840"/>'
           '<w:pgMar w:top="2410" w:right="900" w:bottom="1440" w:left="993"'
           ' w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')

FIRM_NAME = "Example Law Corporation"

# A firm.json-shaped roster: a lawyer who signs, a staff member who prepares, and a
# lawyer who has left.
LAWYER = {"key": "pe", "name": "Pat Example", "designation": "Lawyer", "role": "lawyer",
          "email": "pat@example.com", "direct_line": "555-0100",
          "closing": "Yours very truly,", "initials": "PE", "active": True}
STAFF = {"key": "ss", "name": "Sam Staff", "designation": "Legal Assistant", "role": "staff",
         "email": "sam@example.com", "direct_line": "555-0101",
         "closing": "Yours truly,", "initials": "ss", "active": True}
FORMER = {"key": "fl", "name": "Former Lawyer", "designation": "Lawyer", "role": "lawyer",
          "email": "former@example.com", "direct_line": "555-0102",
          "closing": "Yours truly,", "initials": "FL", "active": False}
ROSTER = [LAWYER, STAFF, FORMER]

PAYLOAD = {
    "signer": "pe",
    "file_number": "9999.T001",
    "date": "September 24, 2026",
    "recipient": ["Test Recipient", "123 Any Street", "Vancouver, BC V6B 1A1"],
    "salutation": "Dear Test Recipient,",
    "re": ["Test matter"],
    "body": ["A body paragraph."],
}


def png(width=4, height=1):
    """A valid, minimal greyscale PNG."""
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    raw = b"".join(b"\x00" + b"\x80" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def template_parts(logo=True, body_image=False):
    """The parts of a synthetic letterhead: a header carrying {{AUTHOR_NAME}} and
    {{AUTHOR_EMAIL}}, a footer carrying {{DIRECT_LINE}} and {{FILE_NUMBER}}, an empty body
    ending in a sectPr, and optionally a header logo (so the png content type is already
    declared) and a stray body image relationship (an unstripped signature)."""
    header_rels = ""
    header_logo = ""
    if logo:
        header_rels = ('<Relationship Id="rIdLogo" Type="%s" Target="media/logo.png"/>'
                       % IMAGE_REL)
        header_logo = '<w:r><w:t>[logo rIdLogo]</w:t></w:r>'
    doc_rels = ('<Relationship Id="rIdHeader" Type="%s/header" Target="header3.xml"/>'
                '<Relationship Id="rIdFooter" Type="%s/footer" Target="footer3.xml"/>'
                '<Relationship Id="rIdStyles" Type="%s/styles" Target="styles.xml"/>'
                % (R, R, R))
    if body_image:
        doc_rels += ('<Relationship Id="rId13" Type="%s" Target="media/image1.png"/>'
                     % IMAGE_REL)
    parts = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            + ('<Default Extension="png" ContentType="image/png"/>' if logo or body_image else "")
            + '<Default Extension="rels" ContentType="application/'
              'vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/header3.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
            '<Override PartName="/word/footer3.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '</Types>'),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="%s"><Relationship Id="rId1" Type="%s/officeDocument"'
            ' Target="word/document.xml"/></Relationships>' % (PKG_RELS, R)),
        "word/_rels/document.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="%s">%s</Relationships>' % (PKG_RELS, doc_rels)),
        "word/document.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="%s" xmlns:r="%s"'
            ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
            '<w:body>%s</w:body></w:document>' % (W, R, SECT_PR)),
        "word/header3.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:hdr xmlns:w="%s" xmlns:r="%s"><w:p>%s'
            '<w:r><w:t>{{AUTHOR_NAME}}</w:t></w:r><w:r><w:t>{{AUTHOR_EMAIL}}</w:t></w:r>'
            '</w:p></w:hdr>' % (W, R, header_logo)),
        "word/footer3.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:ftr xmlns:w="%s" xmlns:r="%s"><w:p>'
            '<w:r><w:t>{{DIRECT_LINE}}</w:t></w:r><w:r><w:t>{{FILE_NUMBER}}</w:t></w:r>'
            '</w:p></w:ftr>' % (W, R)),
        "word/styles.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:styles xmlns:w="%s"><w:docDefaults><w:rPrDefault><w:rPr>'
            '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"'
            ' w:cstheme="minorBidi"/><w:lang w:val="en-CA"/></w:rPr></w:rPrDefault>'
            '</w:docDefaults></w:styles>' % W),
    }
    if logo:
        parts["word/_rels/header3.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="%s">%s</Relationships>' % (PKG_RELS, header_rels))
        parts["word/media/logo.png"] = png(8, 2)
    if body_image:
        parts["word/media/image1.png"] = png(5, 1)
    return {name: data if isinstance(data, bytes) else data.encode("utf-8")
            for name, data in parts.items()}


def first_page_template_parts():
    """template_parts plus a first-page header with the four tokens, each in its own run."""
    parts = template_parts()
    runs = "".join("<w:r><w:t>{{%s}}</w:t></w:r>" % t
                   for t in ("AUTHOR_NAME", "AUTHOR_EMAIL", "DIRECT_LINE", "FILE_NUMBER"))
    parts["word/header1.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:hdr xmlns:w="%s" xmlns:r="%s"><w:p>%s</w:p></w:hdr>' % (W, R, runs)).encode("utf-8")
    edit = lambda name, old, new: parts.__setitem__(name, parts[name].decode("utf-8").replace(old, new).encode("utf-8"))
    edit("word/_rels/document.xml.rels", "</Relationships>",
         '<Relationship Id="rIdFirst" Type="%s/header" Target="header1.xml"/></Relationships>' % R)
    edit("[Content_Types].xml", "</Types>",
         '<Override PartName="/word/header1.xml" ContentType="application/'
         'vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>')
    edit("word/document.xml", "<w:sectPr>",
         '<w:sectPr><w:headerReference w:type="first" r:id="rIdFirst"/>')
    edit("word/document.xml", "</w:sectPr>", "<w:titlePg/></w:sectPr>")
    return parts


def write_zip(path, parts):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    return path


def write_config(appdata, config):
    folder = Path(appdata) / "Coclerk"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "coclerk.json").write_text(json.dumps(config), encoding="utf-8")


def write_profile(path, template, roster=ROSTER):
    """A firm profile as practice_data__firm_profile returns it."""
    profile = {"firm_name": FIRM_NAME, "roster": roster, "letterhead": str(template)}
    Path(path).write_text(json.dumps(profile), encoding="utf-8")
    return path


def render(tmp, payload, appdata, profile, name="letter.docx"):
    """Run render_letterhead.py with APPDATA pointed at `appdata`. Returns (process, out)."""
    tmp = Path(tmp)
    payload_path = tmp / (name + ".json")
    payload_path.write_text(json.dumps(payload), encoding="utf-8")
    out = tmp / name
    cmd = [sys.executable, "-B", str(RENDER_LETTERHEAD), str(payload_path),
           "--profile", str(profile), "--out", str(out)]
    env = {**os.environ, "APPDATA": str(appdata), "PYTHONUTF8": "1"}
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return proc, out


def render_synthetic(tmp, payload, name="letter.docx"):
    """Render against a synthetic letterhead and profile, prepared on the staff member's
    machine; must succeed."""
    tmp = Path(tmp)
    appdata = tmp / "appdata"
    write_config(appdata, {"person": STAFF["key"]})
    template = write_zip(tmp / "letterhead.docx", template_parts())
    profile = write_profile(tmp / "profile.json", template)
    proc, out = render(tmp, payload, appdata, profile, name)
    if proc.returncode:
        raise AssertionError("render_letterhead.py failed: " + proc.stderr)
    return out
