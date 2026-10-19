"""Per-paragraph fingerprints of the Word copies this harness generates, and the
drift check that finds the practitioner's edits to the newest copy before the
next copy is written.

A publish regenerates from the drafting database and the template, so an edit
made in Word to the last " vN" (or a session's patch saved as a new " vN") would
be silently dropped. Each finished run records, per paragraph, the text and a
hash of its text and format. Before the next copy of the same series is written,
the newest copy is compared with the last fingerprint: changed text can be
carried into the drafting database by /draft's on-the-fly revision, and a
format-only change is reported as one that will not carry.

The fingerprints are agent data, so they live in one file in the matter-data
folder (workspace output rule), rewritten in place and keyed by the copy's path
under the draft folder. Nothing here writes to a database.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import zipfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
STORE_NAME = "fingerprints.json"

# Markup Word adds, drops or moves on an ordinary save, changing no visible
# text or format: revision ids, proofing marks, bookmarks, language tags.
_NOISE = {f"{{{W}}}{tag}" for tag in (
    "proofErr", "lastRenderedPageBreak", "bookmarkStart", "bookmarkEnd",
    "lang", "noProof", "rPr")}


def _w(tag: str) -> str:
    return f"{{{W}}}{tag}"


class ManualEdits(RuntimeError):
    """The newest copy of a series differs from what the harness generated."""

    def __init__(self, copies: list[dict]):
        super().__init__("the newest copy holds edits the next copy would drop")
        self.copies = copies


def _canonical(props, drop_mark: bool) -> str:
    """A pPr or rPr element as text, without Word's save noise."""
    if props is None:
        return ""
    props = deepcopy(props)
    noise = _NOISE if drop_mark else _NOISE - {_w("rPr")}
    for node in [n for n in props.iter() if n is not props and n.tag in noise]:
        if node.getparent() is not None:
            node.getparent().remove(node)
    for node in props.iter():
        for attr in list(node.attrib):
            local = etree.QName(attr).localname
            if local.startswith("rsid") or attr.startswith(f"{{{W14}}}"):
                del node.attrib[attr]
    return etree.tostring(props, method="c14n").decode("utf-8")


def _run_text(run) -> str:
    parts = []
    for child in run:
        if child.tag == _w("t"):
            parts.append(child.text or "")
        elif child.tag == _w("tab"):
            parts.append("\t")
        elif child.tag in (_w("br"), _w("cr")):
            parts.append("\n")
    return "".join(parts)


def _paragraph(p) -> list[str]:
    """[text, hash]: the paragraph's text, and a hash of its text and format."""
    # The paragraph mark's own run properties (pPr/rPr) are dropped: Word
    # rewrites them on edits that change nothing visible.
    signature = [_canonical(p.find(_w("pPr")), drop_mark=True)]
    runs: list[list[str]] = []
    for run in p.iter(_w("r")):
        text = _run_text(run)
        if not text:
            continue
        props = _canonical(run.find(_w("rPr")), drop_mark=False)
        if runs and runs[-1][0] == props:
            runs[-1][1] += text
        else:
            runs.append([props, text])
    signature.append(runs)
    text = "".join(t for _, t in runs)
    digest = hashlib.sha256(json.dumps(signature, ensure_ascii=False).encode("utf-8")).hexdigest()
    return [text, digest]


def paragraphs(docx_path: str | Path) -> list[list[str]]:
    """Every body paragraph of a .docx, tables included, in document order."""
    with zipfile.ZipFile(docx_path) as z:
        root = etree.fromstring(z.read("word/document.xml"))
    body = root.find(_w("body"))
    return [_paragraph(p) for p in body.iter(_w("p"))]


def _key(draft_root: Path, path: Path) -> str:
    try:
        return Path(path).relative_to(draft_root).as_posix()
    except ValueError:
        return str(path)


def _load(store: Path | None) -> dict:
    if store is None or not store.is_file():
        return {}
    return json.loads(store.read_bytes().rstrip(b"\x00").decode("utf-8"))


def record(store: Path, draft_root: Path, docx_paths: list[Path]) -> None:
    """Record each generated copy's fingerprint, rewriting the one store file in place."""
    data = _load(store)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for path in docx_paths:
        data[_key(draft_root, path)] = {"recorded": stamp, "paragraphs": paragraphs(path)}
    tmp = store.with_name(f"{store.name}.tmp-{os.getpid()}")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, store)


def compare(generated: list[list[str]], current: list[list[str]]) -> list[dict]:
    """Paragraph-level differences between a fingerprint and a copy.

    kind "text": the paragraph's words differ (generated None: a paragraph
    added; current None: one removed). kind "format": the same words with a
    different format, or an empty paragraph added or removed. paragraph is the
    1-based paragraph number in the current copy, None for a removed one.
    """
    changes: list[dict] = []
    matcher = difflib.SequenceMatcher(
        None, [t for t, _ in generated], [t for t, _ in current], autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                if generated[i1 + k][1] != current[j1 + k][1]:
                    changes.append({"kind": "format", "paragraph": j1 + k + 1,
                                    "text": current[j1 + k][0]})
            continue
        old, new = generated[i1:i2], current[j1:j2]
        for k in range(max(len(old), len(new))):
            before = old[k][0] if k < len(old) else None
            after = new[k][0] if k < len(new) else None
            number = j1 + k + 1 if after is not None else None
            if not (before or "").strip() and not (after or "").strip():
                changes.append({"kind": "format", "paragraph": number, "text": ""})
            else:
                changes.append({"kind": "text", "paragraph": number,
                                "generated": before, "current": after})
    return changes


def drift(store: Path | None, draft_root: Path, folder: Path,
          prefix: str, suffix: str) -> dict | None:
    """Compare the newest copy of one series with the last copy generated.

    The series is "<prefix><suffix>.docx" (v1) and "<prefix> vN<suffix>.docx".
    Returns None when nothing in the series was fingerprinted, or the newest
    copy matches the last fingerprint; otherwise the newest copy, the copy it
    was compared with, and the changes.
    """
    data = _load(store)
    if not data or not folder.is_dir():
        return None
    series = re.compile(r"^%s(?: v(\d+))?%s\.docx$"
                        % (re.escape(prefix), re.escape(suffix)), re.I)
    copies = {}
    for entry in os.listdir(folder):
        match = series.match(entry)
        if match:
            copies[int(match.group(1) or 1)] = folder / entry
    generated = [n for n in copies if _key(draft_root, copies[n]) in data]
    if not generated:
        return None
    newest, last = copies[max(copies)], copies[max(generated)]
    changes = compare(data[_key(draft_root, last)]["paragraphs"], paragraphs(newest))
    if not changes:
        return None
    return {"newest": str(newest), "generated": str(last), "changes": changes}
