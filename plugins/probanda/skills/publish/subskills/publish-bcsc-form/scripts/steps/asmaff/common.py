"""Strict parser for affidavit-<document_id>.md, the file drafting_forms__emit_affidavit writes.

references/assembly-input-contract.md is SSOT for the grammar. Anything else is refused, never repaired.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

FRONT_KEYS = ("deponent", "affidavit_number", "exhibits")
PARA = re.compile(r"^(\d+)\. (.+)$")
EXHIBIT = re.compile(r'\*\*Exhibit "([A-Z])"\*\*')


def substance_path(case_data_folder: str, document_id: int) -> Path:
    return Path(case_data_folder) / "bcsc-form-substance" / f"affidavit-{document_id}.md"


def parse_affidavit(path: Path) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "---":
        raise ValueError(f"{path.name} must start with --- frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError(f"{path.name} frontmatter has no closing ---") from exc
    front: dict = {}
    for line in lines[1:end]:
        key, sep, raw = line.partition(": ")
        if not sep or key not in FRONT_KEYS or key in front:
            raise ValueError(f"unknown, duplicate or malformed frontmatter line: {line!r}")
        front[key] = raw
    for key in FRONT_KEYS:
        if key not in front:
            raise ValueError(f"missing frontmatter key: {key}")
    if not front["deponent"].strip():
        raise ValueError("deponent is empty")
    if not re.fullmatch(r"[1-9]\d*", front["affidavit_number"]):
        raise ValueError(f"affidavit_number must be a positive integer: {front['affidavit_number']!r}")
    try:
        exhibits = json.loads(front["exhibits"])
    except json.JSONDecodeError as exc:
        raise ValueError("exhibits must be a JSON array") from exc
    if not isinstance(exhibits, list) or any(
            not isinstance(e, dict) or set(e) != {"letter", "label", "file_path"} for e in exhibits):
        raise ValueError("exhibits must be a JSON array of {letter, label, file_path}")
    letters = [e["letter"] for e in exhibits]
    if letters != [chr(ord("A") + i) for i in range(len(letters))]:
        raise ValueError(f"exhibit letters must run A, B, C ... in order: {letters}")

    paragraphs = []
    placed = []
    for line in lines[end + 1:]:
        if not line.strip():
            continue
        match = PARA.match(line)
        if not match or int(match.group(1)) != len(paragraphs) + 1:
            raise ValueError(f"paragraph numbering must be continuous; expected {len(paragraphs) + 1}: {line}")
        text = match.group(2)
        if "**" in EXHIBIT.sub("", text):
            raise ValueError(f"bold is allowed only on an exhibit reference: {line}")
        placed += [m for m in EXHIBIT.findall(text) if m not in placed]
        paragraphs.append(text)
    if not paragraphs:
        raise ValueError(f"{path.name} has no paragraphs")
    if placed != letters:
        raise ValueError(f"exhibit letters placed in the paragraphs {placed} do not match the exhibits list {letters}")
    return {"deponent": front["deponent"], "affidavit_number": int(front["affidavit_number"]),
            "exhibits": exhibits, "paragraphs": paragraphs}


def ordinal(n: int) -> str:
    """1 -> '1st', 12 -> '12th', 22 -> '22nd': the form's "This is the [ORDINAL] affidavit"."""
    suffix = "th" if n % 100 in (11, 12, 13) else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
