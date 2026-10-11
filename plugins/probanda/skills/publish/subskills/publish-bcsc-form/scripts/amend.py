"""Amend a filed pleading per BC Supreme Court Rule 6-1.

Produces a marked-up version (strikethrough deletions, underlined insertions)
for filing and an optional clean version with amendments accepted.

Usage:
    python amend.py --original <filed.docx> --amendments <spec.json> \
        --out <amended.docx> [--clean <clean.docx>]
"""
from __future__ import annotations
import argparse
import copy
import difflib
import json
import re
import sys
import zipfile
from pathlib import Path

from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XMLSPACE = '{http://www.w3.org/XML/1998/namespace}space'


def WN(tag: str) -> str:
    return f'{{{W}}}{tag}'


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def _normalize(text: str) -> str:
    """Collapse whitespace and normalize smart quotes/dashes for fuzzy matching."""
    text = (text
            .replace('\u2018', "'").replace('\u2019', "'")
            .replace('\u201c', '"').replace('\u201d', '"')
            .replace('\u2013', '-').replace('\u2014', '-'))
    return re.sub(r'\s+', ' ', text).strip()


def _para_text(para: etree._Element) -> str:
    return ''.join(t.text or '' for t in para.iter(WN('t')))


# ---------------------------------------------------------------------------
# Paragraph finder — 3-tier match
# ---------------------------------------------------------------------------

def _find_paragraph(body: etree._Element, find_text: str) -> etree._Element:
    """Locate a single paragraph by text. Raises ValueError on 0 or 2+ matches.

    Match tiers:
      1. Exact text match
      2. Normalized match (collapsed whitespace, smart quotes)
      3. Normalized substring match
    """
    paras = list(body.iter(WN('p')))
    norm_find = _normalize(find_text)

    # Tier 1: exact
    exact = [p for p in paras if _para_text(p) == find_text]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise ValueError(
            f"Ambiguous match: {len(exact)} paragraphs match exactly: {find_text!r}")

    # Tier 2: normalized
    normed = [p for p in paras if _normalize(_para_text(p)) == norm_find]
    if len(normed) == 1:
        return normed[0]
    if len(normed) > 1:
        raise ValueError(
            f"Ambiguous match: {len(normed)} paragraphs match (normalized): {find_text!r}")

    # Tier 3: substring
    substr = [p for p in paras if norm_find in _normalize(_para_text(p))]
    if len(substr) == 1:
        return substr[0]
    if len(substr) > 1:
        raise ValueError(
            f"Ambiguous match: {len(substr)} paragraphs contain (substring): {find_text!r}")

    raise ValueError(f"No paragraph found matching: {find_text!r}")


# ---------------------------------------------------------------------------
# Run formatting helpers
# ---------------------------------------------------------------------------

def _ensure_rpr(run: etree._Element) -> etree._Element:
    """Get or create <w:rPr> as first child of run."""
    rpr = run.find(WN('rPr'))
    if rpr is None:
        rpr = etree.SubElement(run, WN('rPr'))
        run.insert(0, rpr)
    return rpr


def _apply_deletion_fmt(run: etree._Element) -> None:
    """Add strikethrough + gray color to run (preserves existing rPr props)."""
    rpr = _ensure_rpr(run)
    if rpr.find(WN('strike')) is None:
        etree.SubElement(rpr, WN('strike'))
    color = rpr.find(WN('color'))
    if color is None:
        color = etree.SubElement(rpr, WN('color'))
    color.set(WN('val'), '808080')


def _apply_insertion_fmt(run: etree._Element) -> None:
    """Add gray underline to run (preserves existing rPr props)."""
    rpr = _ensure_rpr(run)
    u = rpr.find(WN('u'))
    if u is None:
        u = etree.SubElement(rpr, WN('u'))
    u.set(WN('val'), 'single')
    u.set(WN('color'), '808080')


# ---------------------------------------------------------------------------
# Word-level diff helpers
# ---------------------------------------------------------------------------

def _extract_word_runs(para: etree._Element) -> list[tuple[str, etree._Element | None]]:
    """Map each word to its source run's rPr (for formatting preservation).

    Returns list of (word, rPr_element_or_None).
    """
    result: list[tuple[str, etree._Element | None]] = []
    for run in para.iter(WN('r')):
        rpr = run.find(WN('rPr'))
        for t_el in run.iter(WN('t')):
            text = t_el.text or ''
            for word in text.split():
                result.append((word, copy.deepcopy(rpr) if rpr is not None else None))
    return result


def _make_run(words: list[str], rpr: etree._Element | None,
              fmt_fn: callable | None = None) -> etree._Element:
    """Create a <w:r> with given words joined by spaces."""
    run = etree.Element(WN('r'))
    if rpr is not None:
        run.append(copy.deepcopy(rpr))
    if fmt_fn is not None:
        fmt_fn(run)
    t = etree.SubElement(run, WN('t'))
    t.text = ' '.join(words)
    t.set(XMLSPACE, 'preserve')
    return run


def _make_space_run(rpr: etree._Element | None) -> etree._Element:
    """Create a run containing a single space (word separator)."""
    run = etree.Element(WN('r'))
    if rpr is not None:
        run.append(copy.deepcopy(rpr))
    t = etree.SubElement(run, WN('t'))
    t.text = ' '
    t.set(XMLSPACE, 'preserve')
    return run


# ---------------------------------------------------------------------------
# Amendment operations
# ---------------------------------------------------------------------------

def replace_paragraph(body: etree._Element, find: str, replacement: str) -> None:
    """Word-level diff: strikethrough deleted words, underline inserted words."""
    para = _find_paragraph(body, find)
    word_rprs = _extract_word_runs(para)
    old_words = [w for w, _ in word_rprs]
    new_words = replacement.split()

    # Build rPr lookup for original words
    rpr_map = {i: rpr for i, (_, rpr) in enumerate(word_rprs)}

    sm = difflib.SequenceMatcher(None, old_words, new_words)

    # Clear all existing runs from the paragraph (keep pPr)
    for run in list(para.iter(WN('r'))):
        para.remove(run)

    runs: list[etree._Element] = []
    first = True

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for idx in range(i1, i2):
                rpr = rpr_map.get(idx)
                if not first:
                    runs.append(_make_space_run(rpr))
                runs.append(_make_run([old_words[idx]], rpr))
                first = False
        elif tag == 'delete':
            for idx in range(i1, i2):
                rpr = rpr_map.get(idx)
                if not first:
                    runs.append(_make_space_run(rpr))
                r = _make_run([old_words[idx]], rpr, _apply_deletion_fmt)
                runs.append(r)
                first = False
        elif tag == 'insert':
            # Use the rPr from the nearest old word (i1 or previous)
            ref_rpr = rpr_map.get(min(i1, len(old_words) - 1))
            for word in new_words[j1:j2]:
                if not first:
                    runs.append(_make_space_run(ref_rpr))
                r = _make_run([word], ref_rpr, _apply_insertion_fmt)
                runs.append(r)
                first = False
        elif tag == 'replace':
            # Deleted old words
            for idx in range(i1, i2):
                rpr = rpr_map.get(idx)
                if not first:
                    runs.append(_make_space_run(rpr))
                r = _make_run([old_words[idx]], rpr, _apply_deletion_fmt)
                runs.append(r)
                first = False
            # Inserted new words
            ref_rpr = rpr_map.get(i1, None)
            for word in new_words[j1:j2]:
                if not first:
                    runs.append(_make_space_run(ref_rpr))
                r = _make_run([word], ref_rpr, _apply_insertion_fmt)
                runs.append(r)
                first = False

    for r in runs:
        para.append(r)


def delete_paragraph(body: etree._Element, find: str) -> None:
    """Strike through all runs in the matching paragraph."""
    para = _find_paragraph(body, find)
    for run in para.iter(WN('r')):
        _apply_deletion_fmt(run)


def insert_paragraph(body: etree._Element, after: str, text: str) -> None:
    """Insert a new paragraph after the anchor, inheriting its pPr."""
    anchor = _find_paragraph(body, after)

    new_p = etree.Element(WN('p'))
    ppr = anchor.find(WN('pPr'))
    if ppr is not None:
        new_p.append(copy.deepcopy(ppr))

    run = etree.SubElement(new_p, WN('r'))
    # Inherit rPr from anchor's first run
    anchor_run = anchor.find(WN('r'))
    if anchor_run is not None:
        anchor_rpr = anchor_run.find(WN('rPr'))
        if anchor_rpr is not None:
            run.append(copy.deepcopy(anchor_rpr))
    _apply_insertion_fmt(run)

    t = etree.SubElement(run, WN('t'))
    t.text = text
    if text != text.strip():
        t.set(XMLSPACE, 'preserve')

    # Insert after anchor
    parent = anchor.getparent()
    idx = list(parent).index(anchor)
    parent.insert(idx + 1, new_p)


def add_filing_date(body: etree._Element, date: str) -> None:
    """Insert 'Originally filed: {date}' as the first paragraph."""
    p = etree.Element(WN('p'))
    run = etree.SubElement(p, WN('r'))
    rpr = etree.SubElement(run, WN('rPr'))
    etree.SubElement(rpr, WN('i'))
    t = etree.SubElement(run, WN('t'))
    t.text = f'Originally filed: {date}'
    body.insert(0, p)


# ---------------------------------------------------------------------------
# Clean version
# ---------------------------------------------------------------------------

FILING_DATE_PREFIX = 'Originally filed:'


def make_clean(members: dict[str, bytes]) -> dict[str, bytes]:
    """Second pass: remove struck runs, strip underlines, remove filing date annotation."""
    clean = dict(members)
    root = etree.fromstring(clean['word/document.xml'])
    body = root.find(WN('body'))

    # Remove filing date annotation paragraph
    for para in list(body):
        if para.tag == WN('p') and _para_text(para).startswith(FILING_DATE_PREFIX):
            body.remove(para)
            break

    # Process all paragraphs
    paras_to_remove: list[etree._Element] = []
    for para in body.iter(WN('p')):
        runs = list(para.iter(WN('r')))
        all_struck = True
        has_runs = False

        for run in runs:
            rpr = run.find(WN('rPr'))
            has_strike = rpr is not None and rpr.find(WN('strike')) is not None
            has_underline = rpr is not None and rpr.find(WN('u')) is not None

            if has_strike:
                # Mark for removal
                run.getparent().remove(run)
            else:
                all_struck = False
                has_runs = True
                if has_underline and rpr is not None:
                    # Strip insertion underline
                    u = rpr.find(WN('u'))
                    if u is not None:
                        rpr.remove(u)

        # If all runs were struck (entire paragraph deleted), remove paragraph
        if has_runs is False and len(runs) > 0:
            paras_to_remove.append(para)

    for para in paras_to_remove:
        para.getparent().remove(para)

    clean['word/document.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)
    return clean


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def amend(original_path: Path, amendments_path: Path, out_path: Path,
          clean_path: Path | None = None) -> None:
    spec = json.loads(
        amendments_path.read_bytes().rstrip(b"\x00").decode("utf-8"))

    with zipfile.ZipFile(original_path) as zin:
        members = {n: zin.read(n) for n in zin.namelist()}

    root = etree.fromstring(members['word/document.xml'])
    body = root.find(WN('body'))

    # Add filing date annotation
    filing_date = spec.get('filing_date')
    if not filing_date:
        raise ValueError("amendments spec must include 'filing_date'")
    add_filing_date(body, filing_date)

    # Apply amendments
    for i, amendment in enumerate(spec.get('amendments', [])):
        atype = amendment.get('type')
        try:
            if atype == 'replace':
                replace_paragraph(body, amendment['find'], amendment['replacement'])
            elif atype == 'delete_paragraph':
                delete_paragraph(body, amendment['find'])
            elif atype == 'insert_paragraph':
                insert_paragraph(body, amendment['after'], amendment['text'])
            else:
                raise ValueError(f"Unknown amendment type: {atype!r}")
        except (ValueError, KeyError) as e:
            raise ValueError(f"Amendment #{i+1} ({atype}): {e}") from e

    members['word/document.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)

    # Write marked-up version
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)
    print(f"Written (marked-up): {out_path}")

    # Write clean version
    if clean_path is not None:
        clean_members = make_clean(members)
        clean_path.parent.mkdir(parents=True, exist_ok=True)
        if clean_path.exists():
            clean_path.unlink()
        with zipfile.ZipFile(clean_path, 'w', zipfile.ZIP_DEFLATED) as zout:
            for name, data in clean_members.items():
                zout.writestr(name, data)
        print(f"Written (clean): {clean_path}")


def main() -> int:
    p = argparse.ArgumentParser(
        description='Amend a filed pleading per BC Supreme Court Rule 6-1.')
    p.add_argument('--original', required=True, help='Path to the filed pleading (.docx)')
    p.add_argument('--amendments', required=True, help='Path to amendments spec JSON')
    p.add_argument('--out', required=True, help='Output path for marked-up amended pleading')
    p.add_argument('--clean', default=None, help='Output path for clean version (amendments accepted)')
    args = p.parse_args()

    amend(Path(args.original), Path(args.amendments), Path(args.out),
          Path(args.clean) if args.clean else None)
    return 0


if __name__ == '__main__':
    sys.exit(main())
