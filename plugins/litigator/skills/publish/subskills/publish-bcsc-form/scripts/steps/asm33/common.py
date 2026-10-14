"""Strict parser/transform helpers for the Form 33 markdown subset."""
from __future__ import annotations

import json
import re
from pathlib import Path

PARTS = ("Part 4", "Part 5", "Part 6")
PARA = re.compile(r"^(\d+)\. (.+)$")
ITALIC = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")


def parse_form33(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("form-33.md must start with --- frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("form-33.md frontmatter has no closing ---") from exc
    front = {}
    for line in lines[1:end]:
        if not line.strip():
            continue
        if ": " not in line:
            raise ValueError(f"malformed frontmatter line: {line!r}")
        key, raw = line.split(": ", 1)
        if key in front or key not in {"notice_filed", "time_estimate", "orders", "pure_law_confirmed"}:
            raise ValueError(f"unknown/duplicate frontmatter key: {key}")
        if key in {"orders", "pure_law_confirmed"}:
            try:
                front[key] = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{key} must be JSON-compatible YAML") from exc
        else:
            front[key] = raw
    for key in ("notice_filed", "time_estimate", "orders"):
        if key not in front:
            raise ValueError(f"missing frontmatter key: {key}")
    if not isinstance(front["orders"], list) or not front["orders"]:
        raise ValueError("orders must be a non-empty array")
    for order in front["orders"]:
        if set(order) != {"order", "position", "terms"}:
            raise ValueError("each order must have exactly order, position, terms")
        if order["position"] not in {"consent", "oppose", "no-position"}:
            raise ValueError(f"invalid order position: {order['position']}")

    sections = {part: [] for part in PARTS}
    current = None
    expected = 1
    for raw in lines[end + 1:]:
        line = raw.rstrip()
        if not line:
            continue
        if line.startswith("## "):
            name = line[3:]
            if name not in PARTS or sections[name]:
                raise ValueError(f"invalid/duplicate heading: {line}")
            current = name
            continue
        if current is None:
            raise ValueError(f"content before Part 4: {line}")
        if line.startswith(("###", "- ")) and current != "Part 6":
            raise ValueError(f"disallowed markdown: {line}")
        if re.search(r"\*\*|__|\[[^]]+\]\(|^\s{2,}[-*+] |^\|", line):
            raise ValueError(f"disallowed markdown: {line}")
        if current == "Part 6":
            if line == "Nil.":
                sections[current].append(line)
            elif not line.startswith("- "):
                raise ValueError(f"Part 6 must be a flat dash list: {line}")
            else:
                sections[current].append(line[2:])
            continue
        if line == "Nil.":
            sections[current].append(line)
            continue
        if line.startswith("> "):
            sections[current].append(line)
            continue
        match = PARA.match(line)
        if not match or int(match.group(1)) != expected:
            raise ValueError(f"paragraph numbering must be continuous; expected {expected}: {line}")
        text_part = match.group(2)
        stripped = ITALIC.sub("", text_part)
        if "*" in stripped:
            raise ValueError(f"malformed/disallowed italics: {line}")
        for ref in re.findall(r"\bparagraph (\d+)\b", text_part, re.I):
            if int(ref) >= expected:
                raise ValueError(f"forward paragraph reference from {expected} to {ref}")
        sections[current].append(text_part)
        expected += 1

    for part in PARTS:
        if not sections[part]:
            sections[part] = ["Nil."]
    if sections["Part 4"] == ["Nil."] and not front.get("pure_law_confirmed", False):
        raise ValueError("Part 4 Nil requires pure_law_confirmed: true")
    return {"front": front, "sections": sections}


def transform(parsed: dict) -> tuple[dict, str, list[str]]:
    front, sections = parsed["front"], parsed["sections"]
    orders = front["orders"]
    consent = [o for o in orders if o["position"] == "consent"]
    oppose = [str(o["order"]) for o in orders if o["position"] == "oppose"]
    no_pos = [str(o["order"]) for o in orders if o["position"] == "no-position"]
    part1 = [o["terms"] or f"Order {o['order']}" for o in consent] or ["Nil."]
    body = []
    for number, title, lines in (
        (1, "ORDER(S) CONSENTED TO", part1),
        (4, "FACTUAL BASIS", sections["Part 4"]),
        (5, "LEGAL BASIS", sections["Part 5"]),
        (6, "MATERIAL TO BE RELIED ON", sections["Part 6"]),
    ):
        body.append(f"=== PART {number}: {title} ===")
        body.extend(lines)
        body.append("")
    context = {
        "notice_filed": front["notice_filed"],
        "time_estimate": front["time_estimate"],
        "opposed_order_numbers": ", ".join(oppose) if oppose else "Nil",
        "no_position_order_numbers": ", ".join(no_pos) if no_pos else "Nil",
    }
    warnings = []
    words = sum(len(x.split()) for x in sections["Part 4"] + sections["Part 5"])
    if words > 4500:
        warnings.append("Form 33 may exceed 10 pages; assemble-time estimate is warning only")
    return context, "\n".join(body).rstrip() + "\n", warnings
