"""Build bracket-placeholder templates from flat-text LEAP DOCX exports.

This is the scoped conversion path for Form 17 and Form 8 exports that contain
no SDT content controls. It patches only known text slots and package metadata;
all unrelated OOXML parts are copied unchanged.

Usage:
    python build_flat_templates.py form-17 source.docx output.docx
    python build_flat_templates.py form-8 source.docx output.docx
"""
from __future__ import annotations

import argparse
import copy
import posixpath
import re
import zipfile
from pathlib import Path

from lxml import etree


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XMLSPACE = "{http://www.w3.org/XML/1998/namespace}space"
NS = {"w": W}
GUID = re.compile(
    rb"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    rb"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def wn(tag: str) -> str:
    return f"{{{W}}}{tag}"


def _is_removed_part(name: str) -> bool:
    normalized = name.replace("\\", "/").lstrip("/").lower()
    return (
        normalized.startswith("customxml/")
        or normalized.startswith("word/webextensions/")
        or normalized.startswith("[trash]/")
        or normalized == "docprops/custom.xml"
    )


def _serialize(root: etree._Element) -> bytes:
    return etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    )


def _paragraph_text(paragraph: etree._Element) -> str:
    return "".join(node.text or "" for node in paragraph.iter(wn("t")))


def _set_paragraph_text(paragraph: etree._Element, text: str) -> None:
    """Replace paragraph payload while preserving its paragraph/run formatting."""
    ppr = paragraph.find(wn("pPr"))
    first_run = paragraph.find(f".//{wn('r')}")
    first_rpr = first_run.find(wn("rPr")) if first_run is not None else None
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    run = etree.SubElement(paragraph, wn("r"))
    if first_rpr is not None:
        run.append(copy.deepcopy(first_rpr))
    text_node = etree.SubElement(run, wn("t"))
    text_node.text = text
    if text != text.strip():
        text_node.set(XMLSPACE, "preserve")


def _find_unique(paragraphs: list[etree._Element], prefix: str) -> int:
    matches = [
        index
        for index, paragraph in enumerate(paragraphs)
        if _paragraph_text(paragraph).strip().startswith(prefix)
    ]
    if len(matches) != 1:
        raise ValueError(
            f"Expected exactly one paragraph beginning {prefix!r}; found {matches}"
        )
    return matches[0]


def _patch_caption(paragraphs: list[etree._Element]) -> None:
    if len(paragraphs) < 9:
        raise ValueError("Document is too short to contain the expected caption")
    if (
        _paragraph_text(paragraphs[2]).strip()
        != "In the Supreme Court of British Columbia"
    ):
        raise ValueError("Caption court heading is not in the expected location")
    if _paragraph_text(paragraphs[3]).strip() != "Between":
        raise ValueError("Caption BETWEEN anchor is not in the expected location")
    if _paragraph_text(paragraphs[6]).strip() != "and":
        raise ValueError("Caption AND anchor is not in the expected location")

    replacements = {
        0: "No. [COURT FILE NUMBER]",
        1: "[REGISTRY] Registry",
        4: "[PLAINTIFF / PETITIONER NAME(S)]",
        5: "[PLAINTIFF]",
        7: "[DEFENDANT / RESPONDENT NAME(S)]",
        8: "[DEFENDANT]",
    }
    for index, replacement in replacements.items():
        _set_paragraph_text(paragraphs[index], replacement)


def _patch_form17(document: etree._Element) -> None:
    paragraphs = document.xpath("./w:body//w:p", namespaces=NS)
    _patch_caption(paragraphs)

    replacements = {
        "Filed by:": "Filed by: [FILED BY]",
        "Required:": "Required: [REQUIRED — order or relief sought]",
        "Affidavit #": (
            "Affidavit # [number] of [deponent name], made [mmmm d, yyyy]."
        ),
        "Date:": "Date: [mmmm d, yyyy]",
        "Signature of lawyer for": "Signature of lawyer for [CLIENT NAME]",
    }
    located: dict[str, int] = {}
    for prefix, replacement in replacements.items():
        index = _find_unique(paragraphs, prefix)
        located[prefix] = index
        _set_paragraph_text(paragraphs[index], replacement)

    signature_index = located["Signature of lawyer for"]
    lawyer_index = next(
        (
            index
            for index in range(signature_index + 1, len(paragraphs))
            if _paragraph_text(paragraphs[index]).strip()
        ),
        None,
    )
    if lawyer_index is None:
        raise ValueError("Could not locate the lawyer-name line after the signature")
    _set_paragraph_text(paragraphs[lawyer_index], "[LAWYER NAME]")


def _patch_form8(document: etree._Element) -> None:
    paragraphs = document.xpath("./w:body//w:p", namespaces=NS)
    _patch_caption(paragraphs)

    damages_index = _find_unique(paragraphs, "THIS COURT ORDERS")
    costs_index = _find_unique(paragraphs, "THIS COURT FURTHER ORDERS")
    assessment_index = _find_unique(paragraphs, "to be assessed.")
    if assessment_index != costs_index + 2:
        raise ValueError(
            "Expected exactly one amount paragraph between the costs clause and "
            "its 'to be assessed' continuation"
        )

    _set_paragraph_text(
        paragraphs[damages_index],
        "THIS COURT ORDERS that the Defendant, [DEFENDANT], pay to the "
        "Plaintiff damages to be assessed;",
    )
    _set_paragraph_text(
        paragraphs[costs_index],
        "THIS COURT FURTHER ORDERS that the Defendant [DEFENDANT] pay to the "
        "Plaintiff",
    )
    _set_paragraph_text(paragraphs[costs_index + 1], "[AMOUNT]")
    _set_paragraph_text(paragraphs[assessment_index], "to be assessed.")


def _clear_stale_footer_stamps(members: dict[str, bytes]) -> None:
    for name in list(members):
        if not name.startswith("word/footer") or not name.endswith(".xml"):
            continue
        root = etree.fromstring(members[name])
        changed = False
        for paragraph in root.iter(wn("p")):
            if _paragraph_text(paragraph).strip().lower().startswith("last updated:"):
                _set_paragraph_text(paragraph, "")
                changed = True
        if changed:
            members[name] = _serialize(root)


def _strip_content_type_overrides(members: dict[str, bytes]) -> None:
    root = etree.fromstring(members["[Content_Types].xml"])
    for child in list(root):
        part_name = child.get("PartName", "")
        if part_name and _is_removed_part(part_name):
            root.remove(child)
    members["[Content_Types].xml"] = _serialize(root)


def _relationship_target_removed(rel_part: str, target: str, rel_type: str) -> bool:
    target_lower = target.replace("\\", "/").lower()
    type_lower = rel_type.lower()
    if any(
        token in target_lower
        for token in ("customxml/", "webextensions/", "docprops/custom.xml")
    ):
        return True
    if any(
        token in type_lower
        for token in ("/customxml", "/webextension", "/custom-properties")
    ):
        return True

    # Resolve ordinary relative targets so future exports cannot hide a removed
    # part behind another number of `..` segments.
    rel_dir = posixpath.dirname(rel_part)
    if rel_dir.endswith("/_rels"):
        rel_dir = rel_dir[: -len("/_rels")]
    resolved = posixpath.normpath(posixpath.join(rel_dir, target_lower))
    return _is_removed_part(resolved)


def _strip_removed_relationships(members: dict[str, bytes]) -> None:
    rel_names = [name for name in members if name.endswith(".rels")]
    for name in rel_names:
        root = etree.fromstring(members[name])
        changed = False
        for relationship in list(root):
            if _relationship_target_removed(
                name,
                relationship.get("Target", ""),
                relationship.get("Type", ""),
            ):
                root.remove(relationship)
                changed = True
        if changed:
            members[name] = _serialize(root)


def _sanitize_core_properties(members: dict[str, bytes]) -> None:
    root = etree.fromstring(members["docProps/core.xml"])
    empty_names = {"creator", "lastModifiedBy", "lastPrinted"}
    for element in root.iter():
        local = etree.QName(element).localname
        if local in empty_names:
            element.text = ""
        elif local == "revision":
            element.text = "1"
        elif local in {"created", "modified"}:
            element.text = "2000-01-01T00:00:00Z"
    members["docProps/core.xml"] = _serialize(root)


def _sanitize_app_properties(members: dict[str, bytes]) -> None:
    root = etree.fromstring(members["docProps/app.xml"])
    zero_names = {
        "Pages",
        "Words",
        "Characters",
        "Lines",
        "Paragraphs",
        "CharactersWithSpaces",
        "Notes",
        "Slides",
        "HiddenSlides",
        "MMClips",
    }
    empty_names = {"Company", "Manager", "HyperlinkBase"}
    for element in root.iter():
        local = etree.QName(element).localname
        if local in zero_names:
            element.text = "0"
        elif local in empty_names:
            element.text = ""
    members["docProps/app.xml"] = _serialize(root)


def _sanitize_settings(members: dict[str, bytes]) -> None:
    root = etree.fromstring(members["word/settings.xml"])
    for element in list(root.iter()):
        if etree.QName(element).localname not in {"docVars", "docId"}:
            continue
        parent = element.getparent()
        if parent is not None:
            parent.remove(element)
    members["word/settings.xml"] = _serialize(root)


def _sanitize_theme(members: dict[str, bytes]) -> None:
    name = "word/theme/theme1.xml"
    if name not in members:
        return
    root = etree.fromstring(members[name])
    for child in list(root):
        if etree.QName(child).localname == "extLst":
            root.remove(child)
    members[name] = _serialize(root)


def _validate_package(members: dict[str, bytes], form: str) -> None:
    removed = [name for name in members if _is_removed_part(name)]
    if removed:
        raise ValueError(f"Removed package parts survived: {removed}")

    forbidden_tokens = (b"customXml", b"webextensions", b"docProps/custom.xml")
    for name, data in members.items():
        if name.endswith(".rels") or name == "[Content_Types].xml":
            if any(token.lower() in data.lower() for token in forbidden_tokens):
                raise ValueError(f"Removed-part reference survived in {name}")
        if name.endswith(".xml") and b"\xe2\x80\x8b" in data:
            raise ValueError(f"Zero-width space survived in {name}")
        if name.endswith(".xml") and GUID.search(data):
            raise ValueError(f"GUID survived in {name}")
        if name.endswith(".xml") and any(token in data for token in (
                b"LEAPTempPath", b"LEAPUniqueCode", b"C:\\Users\\")):
            raise ValueError(f"Personal/vendor setting survived in {name}")

    document_text = _paragraph_text(etree.fromstring(members["word/document.xml"]))
    common = {
        "[COURT FILE NUMBER]",
        "[REGISTRY]",
        "[PLAINTIFF / PETITIONER NAME(S)]",
        "[DEFENDANT / RESPONDENT NAME(S)]",
    }
    expected = common | (
        {
            "[FILED BY]",
            "[REQUIRED — order or relief sought]",
            "[CLIENT NAME]",
            "[LAWYER NAME]",
        }
        if form == "form-17"
        else {"[AMOUNT]"}
    )
    missing = sorted(value for value in expected if value not in document_text)
    if missing:
        raise ValueError(f"Expected placeholders missing from {form}: {missing}")


def build_template(source: Path, output: Path, form: str) -> None:
    with zipfile.ZipFile(source) as package:
        infos = package.infolist()
        members = {
            info.filename: package.read(info.filename)
            for info in infos
            if not _is_removed_part(info.filename)
        }

    document = etree.fromstring(members["word/document.xml"])
    if form == "form-17":
        _patch_form17(document)
    elif form == "form-8":
        _patch_form8(document)
    else:  # pragma: no cover - argparse prevents this
        raise ValueError(f"Unsupported form: {form}")
    members["word/document.xml"] = _serialize(document)

    _clear_stale_footer_stamps(members)
    _strip_content_type_overrides(members)
    _strip_removed_relationships(members)
    _sanitize_core_properties(members)
    _sanitize_app_properties(members)
    _sanitize_settings(members)
    _sanitize_theme(members)
    _validate_package(members, form)

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    with zipfile.ZipFile(output, "w") as package:
        for info in infos:
            if info.filename not in members:
                continue
            package.writestr(info, members[info.filename])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a clean bracket-placeholder template from a flat LEAP DOCX"
    )
    parser.add_argument("form", choices=("form-17", "form-8"))
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build_template(args.source, args.output, args.form)
    print(f"Written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
