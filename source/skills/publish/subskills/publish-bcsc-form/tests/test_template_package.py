"""Package-level integrity of the form templates.

A .docx/.dotx is an OPC package: every relationship must resolve to a part
that exists, every content-type override must name a real part, and every
part must have a declared content type.  Word rejects the whole file when
any of these fails, which no document-level assertion can see.

It also pins what a template must not carry: LEAP vendor parts and the local
identifiers (document variables, document ids) that fill() would copy into
every filed document.  SanitizeTemplateTests covers the script that removes them.
"""
from __future__ import annotations

import posixpath
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from lxml import etree


SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sanitize_template import sanitize  # noqa: E402
from test_caption_contract import RENDER_CONTEXT  # noqa: E402
from test_leave_blank_contract import _plain_forms, _render  # noqa: E402

TEMPLATES = tuple(sorted((SKILL_ROOT / "templates").iterdir()))
# Lower-case: part names are compared case-insensitively, as _is_removed_part does.
VENDOR_PREFIXES = ("customxml/", "word/webextensions/", "[trash]/")
IDENTIFIER_TAGS = {"docVars", "docVar", "docId"}
LEAK_TOKENS = ("LEAPTempPath", "LEAPUniqueCode", "C:\\Users\\")

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DOCUMENT = f'<w:document xmlns:w="{W}"><w:body><w:p/></w:body></w:document>'.encode()
STYLES = f'<w:styles xmlns:w="{W}"/>'.encode()
SETTINGS = (
    f'<w:settings xmlns:w="{W}" '
    'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">'
    '<w:zoom w:percent="100"/>'
    '<w:docVars><w:docVar w:name="LEAPTempPath" '
    'w:val="C:\\Users\\someone\\AppData\\Local\\Temp"/>'
    '<w:docVar w:name="LEAPUniqueCode" '
    'w:val="{00000000-0000-0000-0000-000000000000}"/></w:docVars>'
    '<w15:docId w15:val="{00000000-0000-0000-0000-000000000000}"/>'
    "</w:settings>"
).encode()
CONTENT_TYPES = (
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>'
    '<Override PartName="/docProps/custom.xml" ContentType="application/xml"/>'
    "</Types>"
).encode()
DOCUMENT_RELS = (
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Target="styles.xml" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>'
    '<Relationship Id="rId2" Target="../customXml/item1.xml" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"/>'
    "</Relationships>"
).encode()


def _members(package: zipfile.ZipFile) -> set[str]:
    return set(package.namelist())


def _dangling_relationships(package: zipfile.ZipFile) -> list[str]:
    names = _members(package)
    dangling = []
    for name in sorted(n for n in names if n.endswith(".rels")):
        root = etree.fromstring(package.read(name))
        directory = posixpath.dirname(name)
        if directory.endswith("/_rels"):
            directory = directory[: -len("/_rels")]
        elif directory == "_rels":
            directory = ""
        for relationship in root:
            target = relationship.get("Target", "")
            if relationship.get("TargetMode", "") == "External" or target.startswith("http"):
                continue
            resolved = posixpath.normpath(posixpath.join(directory, target)).lstrip("/")
            if resolved not in names:
                dangling.append(f"{name} -> {resolved}")
    return dangling


def _content_type_gaps(package: zipfile.ZipFile) -> tuple[list[str], list[str]]:
    names = _members(package)
    root = etree.fromstring(package.read("[Content_Types].xml"))
    defaults: set[str] = set()
    overrides: set[str] = set()
    for child in root:
        tag = etree.QName(child).localname
        if tag == "Default":
            defaults.add((child.get("Extension") or "").lower())
        elif tag == "Override":
            overrides.add((child.get("PartName") or "").lstrip("/"))
    stray = sorted(part for part in overrides if part not in names)
    uncovered = sorted(
        name
        for name in names
        if name != "[Content_Types].xml"
        and not name.endswith(".rels")
        and name not in overrides
        and ("." not in name or name.rsplit(".", 1)[-1].lower() not in defaults)
    )
    return stray, uncovered


def _vendor_members(package: zipfile.ZipFile) -> list[str]:
    return sorted(
        name
        for name in package.namelist()
        if name.lower() == "docprops/custom.xml"
        or name.lower().startswith(VENDOR_PREFIXES)
    )


def _settings_identifiers(package: zipfile.ZipFile) -> list[str]:
    if "word/settings.xml" not in package.namelist():
        return []
    root = etree.fromstring(package.read("word/settings.xml"))
    found = {etree.QName(element).localname for element in root.iter(etree.Element)}
    return sorted(found & IDENTIFIER_TAGS)


def _leaked_tokens(package: zipfile.ZipFile) -> list[str]:
    leaks = []
    for name in package.namelist():
        if name.endswith((".xml", ".rels")):
            data = package.read(name).lower()
            leaks += [
                f"{name}: {token}"
                for token in LEAK_TOKENS
                if token.lower().encode() in data
            ]
    return leaks


def _vendor_package_members(settings: bytes | None) -> dict[str, bytes]:
    members = {
        "[Content_Types].xml": CONTENT_TYPES,
        "word/_rels/document.xml.rels": DOCUMENT_RELS,
        "word/document.xml": DOCUMENT,
        "word/styles.xml": STYLES,
        "customXml/item1.xml": b"<x/>",
        "docProps/custom.xml": b"<x/>",
    }
    if settings is not None:
        members["word/settings.xml"] = settings
    return members


def _write_package(directory: Path, members: dict[str, bytes]) -> Path:
    path = directory / "template.dotx"
    with zipfile.ZipFile(path, "w") as package:
        for name, data in members.items():
            package.writestr(name, data)
    return path


class TemplatePackageTests(unittest.TestCase):
    def test_every_relationship_resolves_to_a_part_that_exists(self) -> None:
        for path in TEMPLATES:
            with self.subTest(template=path.name), zipfile.ZipFile(path) as package:
                self.assertEqual([], _dangling_relationships(package))

    def test_every_part_has_a_content_type_and_no_override_is_stray(self) -> None:
        for path in TEMPLATES:
            with self.subTest(template=path.name), zipfile.ZipFile(path) as package:
                stray, uncovered = _content_type_gaps(package)
                self.assertEqual([], stray)
                self.assertEqual([], uncovered)

    def test_templates_carry_no_vendor_parts(self) -> None:
        """convert.py has stripped these since 6ae43bf, so a template that
        carries them was converted before that commit and never re-converted."""
        for path in TEMPLATES:
            with self.subTest(template=path.name), zipfile.ZipFile(path) as package:
                self.assertEqual([], _vendor_members(package))

    def test_templates_carry_no_document_variables_or_ids(self) -> None:
        for path in TEMPLATES:
            with self.subTest(template=path.name), zipfile.ZipFile(path) as package:
                self.assertEqual([], _settings_identifiers(package))

    def test_templates_leak_no_local_identifiers(self) -> None:
        for path in TEMPLATES:
            with self.subTest(template=path.name), zipfile.ZipFile(path) as package:
                self.assertEqual([], _leaked_tokens(package))

    def test_rendered_documents_inherit_no_vendor_parts_or_local_identifiers(self) -> None:
        """fill() copies template members through, so the template is the fix point."""
        with tempfile.TemporaryDirectory() as temporary:
            for form_id, spec in _plain_forms():
                with self.subTest(form=form_id):
                    output = _render(form_id, spec, dict(RENDER_CONTEXT), Path(temporary))
                    with zipfile.ZipFile(output) as package:
                        self.assertEqual([], _vendor_members(package))
                        self.assertEqual([], _settings_identifiers(package))
                        self.assertEqual([], _leaked_tokens(package))


class SanitizeTemplateTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)

    def test_strips_vendor_parts_and_settings_identifiers_but_not_body_or_styles(self) -> None:
        path = _write_package(self.directory, _vendor_package_members(SETTINGS))
        sanitize(path)
        with zipfile.ZipFile(path) as package:
            self.assertEqual([], _vendor_members(package))
            self.assertEqual([], _settings_identifiers(package))
            self.assertEqual([], _leaked_tokens(package))
            self.assertEqual([], _dangling_relationships(package))
            self.assertEqual(([], []), _content_type_gaps(package))
            self.assertIn(b"<w:zoom", package.read("word/settings.xml"))
            self.assertEqual(DOCUMENT, package.read("word/document.xml"))
            self.assertEqual(STYLES, package.read("word/styles.xml"))

    def test_accepts_a_package_with_no_settings_part(self) -> None:
        path = _write_package(self.directory, _vendor_package_members(None))
        sanitize(path)
        with zipfile.ZipFile(path) as package:
            self.assertNotIn("word/settings.xml", package.namelist())
            self.assertEqual([], _vendor_members(package))

    def test_rejects_a_malformed_settings_part_and_leaves_the_file_untouched(self) -> None:
        path = _write_package(self.directory, _vendor_package_members(b"<w:settings"))
        before = path.read_bytes()
        with self.assertRaises(etree.XMLSyntaxError):
            sanitize(path)
        self.assertEqual(before, path.read_bytes())


if __name__ == "__main__":
    unittest.main()
