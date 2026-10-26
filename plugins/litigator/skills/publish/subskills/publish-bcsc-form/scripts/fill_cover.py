"""The NOT FINAL cover page of a published Form 32 or 33 (references/assembly-input-contract.md,
"Publish sidecar").

asm32.fill and asm33.fill put it in front of the filled form whenever a warning exists: a page of
its own, in a section of its own, listing (1) the missing information, (2) the completion criteria
unmet or skipped, with the pre-filing gate's open steps, and (3) every other warning. The cover is
derived from the warnings and never stored as substance. Deleting its section leaves the form as
filled, numbered from page 1.
"""
from __future__ import annotations

import copy
import os
import zipfile
from pathlib import Path

from lxml import etree

from fill_ooxml import WN, XMLSPACE

HEADING = "NOT FINAL - DO NOT FILE"
INTRO = ("This document is not final. Each item below is still open. "
         "Signing and filing it are your decision.")
LISTS = (
    ("missing_datum", "Missing information"),
    ("unmet_criterion", "Completion criteria unmet or skipped"),
    ("other", "Other warnings"),
)
# A section's own header and footer, and its different-first-page switch, stay with the form.
_FORM_ONLY = ("headerReference", "footerReference", "titlePg", "pgNumType")
# CT_SectPr children that follow w:pgNumType, so a new one is inserted before the first of them.
_AFTER_PGNUMTYPE = ("cols", "formProt", "vAlign", "noEndnote", "titlePg", "textDirection",
                    "bidi", "rtlGutter", "docGrid", "printerSettings", "sectPrChange")


def _para(text: str, bold: bool = False, size_half_points: int | None = None,
          center: bool = False) -> etree._Element:
    p = etree.Element(WN("p"))
    if center:
        ppr = etree.SubElement(p, WN("pPr"))
        etree.SubElement(ppr, WN("jc")).set(WN("val"), "center")
    r = etree.SubElement(p, WN("r"))
    if bold or size_half_points:
        rpr = etree.SubElement(r, WN("rPr"))
        if bold:
            etree.SubElement(rpr, WN("b"))
        if size_half_points:
            etree.SubElement(rpr, WN("sz")).set(WN("val"), str(size_half_points))
    t = etree.SubElement(r, WN("t"))
    t.text = text
    t.set(XMLSPACE, "preserve")
    return p


def cover_paragraphs(warnings: list[dict]) -> list[etree._Element]:
    """The cover's paragraphs: the heading, then each numbered list, "None." where it is empty.
    A warning of an unknown kind is listed with the other warnings."""
    known = {kind for kind, _ in LISTS}
    paras = [_para(HEADING, bold=True, size_half_points=32, center=True), _para(INTRO)]
    for n, (kind, title) in enumerate(LISTS, 1):
        items = [str(w.get("message", "")) for w in warnings
                 if (w.get("kind") if w.get("kind") in known else "other") == kind]
        paras.append(_para(f"{n}. {title}", bold=True))
        paras.extend([_para(f"{n}.{i} {m}") for i, m in enumerate(items, 1)] or [_para("None.")])
    return paras


def add_cover(docx_path: Path, warnings: list[dict]) -> bool:
    """Put the cover in front of the form in docx_path, rewriting that file. False, and the file
    untouched, when there is no warning."""
    if not warnings:
        return False
    with zipfile.ZipFile(docx_path) as z:
        members = {n: z.read(n) for n in z.namelist()}
    root = etree.fromstring(members["word/document.xml"])
    body = root.find(WN("body"))
    form_sect = body.find(WN("sectPr"))

    paras = cover_paragraphs(warnings)
    # The cover's section ends at its last paragraph: the form's page set-up, without its header,
    # footer and page numbering, so the form starts on a new page.
    cover_sect = copy.deepcopy(form_sect)
    for child in list(cover_sect):
        if etree.QName(child).localname in _FORM_ONLY:
            cover_sect.remove(child)
    last = paras[-1]
    ppr = last.find(WN("pPr"))
    if ppr is None:
        ppr = etree.Element(WN("pPr"))
        last.insert(0, ppr)
    ppr.append(cover_sect)
    for i, p in enumerate(paras):
        body.insert(i, p)

    # The form numbers its own pages from 1.
    pg = form_sect.find(WN("pgNumType"))
    if pg is None:
        pg = etree.Element(WN("pgNumType"))
        follower = next((c for c in form_sect if etree.QName(c).localname in _AFTER_PGNUMTYPE), None)
        if follower is None:
            form_sect.append(pg)
        else:
            follower.addprevious(pg)
    pg.set(WN("start"), "1")

    members["word/document.xml"] = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True)
    # The file is the one the fill just wrote, so it is replaced, through a temporary sibling.
    tmp = docx_path.with_name(f"~{docx_path.stem}.cover.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)
    os.replace(tmp, docx_path)
    return True
