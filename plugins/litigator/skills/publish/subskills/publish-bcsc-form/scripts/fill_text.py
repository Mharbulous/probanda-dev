"""Split-run placeholder merge, scalar text substitution and the body-paste parser."""
from __future__ import annotations
import re
import sys

from lxml import etree

from fill_ooxml import XMLSPACE, WN, _para_text


# Placeholders that must survive into the output unchanged.
LEAVE_BLANK = {
    '[mmmm d, yyyy]', '[number]', '[deponent name]', '[judge-date]',
    # Affidavit interpreter endorsement (Rule 22-2(7)) — filled only when needed
    '[name]', '[address]', '[occupation]', '[language(s)]',
    # NOCC appendix — optional fields the lawyer fills in Word
    '[CONCISE SUMMARY]', '[OTHER ENACTMENT]',
}


# ---------------------------------------------------------------------------
# Phase 1: merge split-run placeholders
# ---------------------------------------------------------------------------

def merge_split_run_placeholders(para: etree._Element) -> None:
    """Collapse `[` + italic-content + `]` three-run sequences into one run.

    Pattern (confirmed by template inspection):
        <w:r><w:t>[</w:t></w:r>
        <w:r><w:rPr><w:i/></w:rPr><w:t>label</w:t></w:r>
        <w:r><w:t>]</w:t></w:r>

    After merge, the first run carries `[label]` and the other two are removed.
    Mutates para in place; loops until no more merges are possible.
    """
    while True:
        runs = [c for c in para if c.tag == WN('r')]
        merged = False
        for i in range(len(runs) - 2):
            r0, r1, r2 = runs[i], runs[i + 1], runs[i + 2]
            t0 = r0.find(WN('t'))
            t1 = r1.find(WN('t'))
            t2 = r2.find(WN('t'))
            if t0 is None or t1 is None or t2 is None:
                continue
            if t0.text != '[' or t2.text != ']':
                continue
            rpr1 = r1.find(WN('rPr'))
            if rpr1 is None or rpr1.find(WN('i')) is None:
                continue
            # Merge
            t0.text = f'[{t1.text}]'
            para.remove(r1)
            para.remove(r2)
            merged = True
            break  # restart after tree mutation
        if not merged:
            break


# ---------------------------------------------------------------------------
# Phase 2: scalar substitution
# ---------------------------------------------------------------------------

def substitute_text(body: etree._Element, subs: dict[str, str]) -> None:
    """Walk all <w:t> elements; substitute placeholders not in LEAVE_BLANK.

    An exact-full-run match is handled first (fast path). A placeholder
    embedded in a longer run -- e.g. 'No. [COURT FILE NUMBER]' -- is then
    caught by a substring pass, longest key first so overlapping keys can't
    misfire on a shorter substring. Keys that never matched anywhere in the
    document are reported on stderr instead of silently dropped.
    """
    applied: set[str] = set()
    keys_longest_first = sorted(subs, key=len, reverse=True)

    for t_el in body.iter(WN('t')):
        if not t_el.text or t_el.text in LEAVE_BLANK:
            continue
        if t_el.text in subs:
            applied.add(t_el.text)
            t_el.text = subs[t_el.text]
        else:
            for key in keys_longest_first:
                if key in LEAVE_BLANK or key not in t_el.text:
                    continue
                t_el.text = t_el.text.replace(key, subs[key])
                applied.add(key)
        if t_el.text != t_el.text.strip():
            t_el.set(XMLSPACE, 'preserve')

    for key in subs:
        if key not in applied:
            print(f"WARNING: substitution key never matched: {key}",
                  file=sys.stderr)


def substitute_form33_position_sentences(body: etree._Element,
                                         subs: dict[str, str]) -> None:
    """Replace the Form 33 position and hearing-date sentences, which span Word
    runs. A replacement of None removes the paragraph."""
    keys = [key for key in subs if key.startswith(
        'The application respondent(s)')]
    for key in keys:
        replacement = subs.pop(key)
        for para in body.iter(WN('p')):
            if _para_text(para) != key:
                continue
            if replacement is None:
                para.getparent().remove(para)
                break
            for child in list(para):
                if child.tag != WN('pPr'):
                    para.remove(child)
            run = etree.SubElement(para, WN('r'))
            etree.SubElement(run, WN('t')).text = replacement
            break
        else:
            print(f"WARNING: substitution key never matched: {key}",
                  file=sys.stderr)


# ---------------------------------------------------------------------------
# Body paste parser
# ---------------------------------------------------------------------------

def parse_body(body_text: str) -> dict[str, list[str]]:
    """Parse === PART N: TITLE === paste format into lists of paragraph strings."""
    parts: dict[str, list[str]] = {}
    current_part: str | None = None
    current_lines: list[str] = []

    for raw_line in body_text.splitlines():
        line = raw_line.strip()
        # Normalize smart quotes
        line = (line
                .replace('‘', "'").replace('’', "'")
                .replace('“', '"').replace('”', '"'))

        m = re.match(r'^===\s*PART\s+(\d+)', line, re.IGNORECASE)
        if m:
            if current_part is not None:
                parts[f'part{current_part}'] = current_lines
            current_part = m.group(1)
            current_lines = []
            continue

        if current_part is None or not line:
            continue

        # Part 4: strip "- " list prefix
        if current_part == '4' and line.startswith('- '):
            line = line[2:]

        current_lines.append(line)

    if current_part is not None:
        parts[f'part{current_part}'] = current_lines

    return parts
