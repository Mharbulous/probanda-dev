"""A container content control must never appear in a form's alias map.

`unwrap_sdts` processes content controls innermost-first, so nested mapped
controls do receive their bracket tokens.  If the enclosing control is mapped
too, `_overwrite_text` then writes the container's token into the first text
run and blanks every other run in the block, and the multi-paragraph collapse
deletes every paragraph but one.  The nested tokens vanish with no trace an
output check could see.

Two parsers have to agree on what counts as a container: the lxml guard in
convert.py and the stdlib helper in steps/nt/inspect_tmpl.py, which avoids
lxml on purpose.  One synthetic package pins both -- no matter file is read.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from lxml import etree

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

from convert import (  # noqa: E402
    FORM_33_ALIAS_MAP,
    FORM_CONFIGS,
    convert,
    find_alias_containers,
    unwrap_sdts,
)
from steps.nt import configure, inspect_tmpl  # noqa: E402

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _w(tag: str) -> str:
    return f"{{{W}}}{tag}"


# ---------------------------------------------------------------------------
# The shared synthetic fixture
# ---------------------------------------------------------------------------

CAPTION_ALIASES = (
    "COURT_DETAILS.Caption_originating_par",
    "COURT_DETAILS.Originating_party",
    "COURT_DETAILS.Caption_responding_part",
    "COURT_DETAILS.Responding_party",
)


def _sdt(alias: str, inner: str) -> str:
    return (f'<w:sdt><w:sdtPr><w:alias w:val="{alias}"/></w:sdtPr>'
            f'<w:sdtContent>{inner}</w:sdtContent></w:sdt>')


def _run(text: str) -> str:
    return f'<w:r><w:t>{text}</w:t></w:r>'


def _para(inner: str, jc: str | None = None) -> str:
    ppr = f'<w:pPr><w:jc w:val="{jc}"/></w:pPr>' if jc else ''
    return f'<w:p>{ppr}{inner}</w:p>'


def _document(body: str) -> bytes:
    return (f'<w:document xmlns:w="{W}"><w:body>{body}</w:body>'
            f'</w:document>').encode()


# The style of cause as LEAP exports it: one container wrapping seven
# paragraphs, four of which hold one inline run-level control each.
CAPTION_BODY = (
    _para(_run("BETWEEN"))
    + _para(_sdt(CAPTION_ALIASES[0], _run("Alpha Holdings Ltd.")), "center")
    + _para(_sdt(CAPTION_ALIASES[1], _run("PLAINTIFF")), "right")
    + _para(_run("AND"))
    + _para(_sdt(CAPTION_ALIASES[2], _run("Bravo Services Inc.")), "center")
    + _para(_sdt(CAPTION_ALIASES[3], _run("DEFENDANT")), "right")
    + _para("", "right")
)
CAPTION_DOC = _document(_sdt("c_Heading", CAPTION_BODY))

# outer > mid > leaf, all three mapped.
NESTED_DOC = _document(
    _sdt("outer",
         _para(_run("top"))
         + _para(_sdt("mid",
                      _para(_run("middle"))
                      + _para(_sdt("leaf", _run("bottom")))))))
NESTED_MAP = {"outer": "[OUTER]", "mid": "[MID]", "leaf": "[LEAF]"}

# A container whose descendants are not mapped: collapsing to one token is
# what mapping a container means, and must keep working.
UNMAPPED_KIDS_DOC = _document(
    _sdt("c_Block",
         _para(_sdt("x_One", _run("first")))
         + _para(_sdt("x_Two", _run("second")))))

# No nesting at all.
FLAT_DOC = _document(
    _para(_sdt("COURT_DETAILS.Registry", _run("Vancouver")))
    + _para(_run("plain text")))

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/'
    'content-types">'
    '<Default Extension="rels" ContentType="application/'
    'vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/'
    'vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>').encode()

ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
    'relationships"><Relationship Id="rId1" Type="http://'
    'schemas.openxmlformats.org/officeDocument/2006/relationships/'
    'officeDocument" Target="word/document.xml"/></Relationships>').encode()


def _write_package(path: Path, document_xml: bytes) -> Path:
    """Write the smallest .docx package convert() will accept."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("word/document.xml", document_xml)
    return path


def _paragraphs(root: etree._Element) -> list[tuple[str, str | None]]:
    """Each paragraph as (visible text, justification)."""
    out = []
    for p in root.iter(_w("p")):
        text = "".join(t.text or "" for t in p.iter(_w("t")))
        jc = p.find(f'{_w("pPr")}/{_w("jc")}')
        out.append((text, jc.get(_w("val")) if jc is not None else None))
    return out


EXPECTED_CAPTION = [
    ("BETWEEN", None),
    ("[CAPTION ORIGINATING PARTY]", "center"),
    ("[ORIGINATING PARTY]", "right"),
    ("AND", None),
    ("[CAPTION RESPONDING PARTY]", "center"),
    ("[RESPONDING PARTY]", "right"),
    ("", "right"),
]


class ConverterGuardTests(unittest.TestCase):
    """The lxml guard in convert.py."""

    def test_raises_naming_container_and_every_nested_alias(self):
        root = etree.fromstring(CAPTION_DOC)
        with self.assertRaises(ValueError) as cm:
            unwrap_sdts(root, {**FORM_33_ALIAS_MAP, "c_Heading": "[HEADING]"})
        message = str(cm.exception)
        self.assertIn("c_Heading", message)
        for alias in CAPTION_ALIASES:
            self.assertIn(alias, message)

    def test_tree_is_untouched_after_the_failed_call(self):
        root = etree.fromstring(CAPTION_DOC)
        before = etree.tostring(root)
        with self.assertRaises(ValueError):
            unwrap_sdts(root, {**FORM_33_ALIAS_MAP, "c_Heading": "[HEADING]"})
        self.assertEqual(before, etree.tostring(root))

    def test_three_levels_raise_once_naming_both_containers(self):
        root = etree.fromstring(NESTED_DOC)
        self.assertEqual(
            find_alias_containers(root, NESTED_MAP),
            {"outer": ["mid", "leaf"], "mid": ["leaf"]})
        with self.assertRaises(ValueError) as cm:
            unwrap_sdts(root, NESTED_MAP)
        message = str(cm.exception)
        self.assertIn("'outer' wraps 'mid', 'leaf'", message)
        self.assertIn("'mid' wraps 'leaf'", message)

    def test_mapped_container_with_unmapped_children_still_collapses(self):
        root = etree.fromstring(UNMAPPED_KIDS_DOC)
        unwrapped, replaced = unwrap_sdts(root, {"c_Block": "[BLOCK]"})
        self.assertEqual(replaced, 1)
        self.assertEqual(unwrapped, 3)
        self.assertEqual(_paragraphs(root), [("[BLOCK]", None)])

    def test_unmapped_container_still_fills_its_mapped_descendants(self):
        root = etree.fromstring(CAPTION_DOC)
        unwrap_sdts(root, FORM_33_ALIAS_MAP)
        self.assertEqual(_paragraphs(root), EXPECTED_CAPTION)

    def test_form_33_alias_map_no_longer_maps_the_caption_container(self):
        self.assertNotIn("c_Heading", FORM_33_ALIAS_MAP)


class ConvertFailsClosedTests(unittest.TestCase):
    """convert() aborts before it writes anything."""

    def test_container_in_a_form_config_aborts_with_no_output_file(self):
        config = {**FORM_CONFIGS["form-33"],
                  "alias_map": {**FORM_33_ALIAS_MAP,
                                "c_Heading": "[HEADING]"}}
        with tempfile.TemporaryDirectory() as td:
            src = _write_package(Path(td) / "raw.docx", CAPTION_DOC)
            dst = Path(td) / "out.dotx"
            with mock.patch.dict(FORM_CONFIGS, {"container-test": config}):
                with self.assertRaises(ValueError) as cm:
                    convert(src, dst, "container-test")
            self.assertIn("c_Heading", str(cm.exception))
            self.assertFalse(dst.exists())

    def test_the_shipped_form_33_config_converts_the_caption_intact(self):
        with tempfile.TemporaryDirectory() as td:
            src = _write_package(Path(td) / "raw.docx", CAPTION_DOC)
            dst = Path(td) / "out.dotx"
            convert(src, dst, "form-33")
            with zipfile.ZipFile(dst) as z:
                root = etree.fromstring(z.read("word/document.xml"))
        self.assertEqual(_paragraphs(root), EXPECTED_CAPTION)


class InventoryHelperTests(unittest.TestCase):
    """The stdlib helper in steps/nt/inspect_tmpl.py."""

    def test_reports_the_container_with_its_nested_aliases_in_order(self):
        with tempfile.TemporaryDirectory() as td:
            src = _write_package(Path(td) / "raw.docx", CAPTION_DOC)
            self.assertEqual(
                inspect_tmpl._extract_alias_containers(str(src)),
                {"c_Heading": list(CAPTION_ALIASES)})

    def test_reports_nothing_when_no_aliased_control_wraps_another(self):
        with tempfile.TemporaryDirectory() as td:
            src = _write_package(Path(td) / "raw.docx", FLAT_DOC)
            self.assertEqual(
                inspect_tmpl._extract_alias_containers(str(src)), {})

    def test_reports_a_container_whose_children_no_map_mentions(self):
        with tempfile.TemporaryDirectory() as td:
            src = _write_package(Path(td) / "raw.docx", UNMAPPED_KIDS_DOC)
            self.assertEqual(
                inspect_tmpl._extract_alias_containers(str(src)),
                {"c_Block": ["x_One", "x_Two"]})

    def test_both_parsers_agree_on_the_same_fixture(self):
        """One definition of "container", two implementations."""
        for document_xml in (CAPTION_DOC, NESTED_DOC, UNMAPPED_KIDS_DOC,
                             FLAT_DOC):
            with self.subTest(document=document_xml[:64]):
                root = etree.fromstring(document_xml)
                aliases = set()
                for sdt in root.iter(_w("sdt")):
                    pr = sdt.find(_w("sdtPr"))
                    alias = pr.find(_w("alias")) if pr is not None else None
                    if alias is not None and alias.get(_w("val")):
                        aliases.add(alias.get(_w("val")))
                lxml_view = find_alias_containers(
                    root, {a: f"[{a}]" for a in aliases})
                with tempfile.TemporaryDirectory() as td:
                    src = _write_package(Path(td) / "raw.docx", document_xml)
                    stdlib_view = inspect_tmpl._extract_alias_containers(
                        str(src))
                self.assertEqual(lxml_view, stdlib_view)


class ConfigureStepTests(unittest.TestCase):
    """nt.configure refuses a map that names a container."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.raw = _write_package(
            Path(self._tmp.name) / "raw.docx", CAPTION_DOC)
        # sdt_aliases stays the flat list of strings the step already stores.
        self.ctx = {
            "sdt_aliases": ["c_Heading", *CAPTION_ALIASES],
            "form_key": "synthetic",
            "raw_docx_path": str(self.raw),
        }

    def _map(self, **extra):
        base = {a: f"[{a.upper()}]" for a in CAPTION_ALIASES}
        base.update(extra)
        return {"alias_map": base, "leave_blank": []}

    def test_precondition_fails_without_the_raw_file_path(self):
        ctx = {k: v for k, v in self.ctx.items() if k != "raw_docx_path"}
        ok, reason = configure.precondition(ctx)
        self.assertFalse(ok)
        self.assertIn("raw", reason.lower())

    def test_precondition_passes_with_it(self):
        self.assertTrue(configure.precondition(self.ctx)[0])

    def test_validate_rejects_the_container_with_its_nested_aliases(self):
        ok, reason = configure.validate(
            self._map(c_Heading="[HEADING]"), self.ctx)
        self.assertFalse(ok)
        self.assertIn("c_Heading", reason)
        for alias in CAPTION_ALIASES:
            self.assertIn(alias, reason)

    def test_validate_accepts_the_same_map_without_the_container(self):
        self.assertTrue(configure.validate(self._map(), self.ctx)[0])

    def test_validate_accepts_the_container_on_its_own(self):
        result = {"alias_map": {"c_Heading": "[HEADING]"}, "leave_blank": []}
        self.assertTrue(configure.validate(result, self.ctx)[0])

    def test_validate_fails_closed_when_the_raw_path_is_missing(self):
        ctx = {k: v for k, v in self.ctx.items() if k != "raw_docx_path"}
        ok, reason = configure.validate(self._map(), ctx)
        self.assertFalse(ok)
        self.assertIn("raw_docx_path", reason)

    def test_prompt_states_what_the_container_wraps(self):
        prompt = configure.build_prompt(self.ctx)
        self.assertIn("c_Heading", prompt)
        self.assertIn("wraps", prompt)
        for alias in CAPTION_ALIASES:
            self.assertIn(alias, prompt)


class InspectPromptTests(unittest.TestCase):
    def test_prompt_states_what_the_container_wraps(self):
        with tempfile.TemporaryDirectory() as td:
            src = _write_package(Path(td) / "raw.docx", CAPTION_DOC)
            prompt = inspect_tmpl.build_prompt(
                {"raw_docx_path": str(src), "form_key": "synthetic"})
        self.assertIn("c_Heading", prompt)
        self.assertIn("wraps", prompt)
        for alias in CAPTION_ALIASES:
            self.assertIn(alias, prompt)


if __name__ == "__main__":
    unittest.main()
