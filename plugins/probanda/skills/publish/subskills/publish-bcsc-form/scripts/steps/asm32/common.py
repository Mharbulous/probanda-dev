"""Strict parser/transform helpers for the Form 32 markdown subset.

references/assembly-input-contract.md is SSOT. Mirrors asm33/common.py's discipline
with the Form 32 part mapping (Parts 2/3/4; Part 1 rendered from frontmatter) and
the hearing-scalar bridge into the registered `noa` template's preamble fields.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

PARTS = ("Part 2", "Part 3", "Part 4")
PARA = re.compile(r"^(\d+)\. (.+)$")
ITALIC = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
FRONT_KEYS = {"proposed_hearing", "hearing_place", "registry",
              "time_estimate", "associate_judge", "orders", "pure_law_confirmed"}
REQUIRED_FRONT = ("proposed_hearing", "hearing_place", "registry",
                  "time_estimate", "associate_judge", "orders")

# Optional keys from B.C. Reg. 105/2026's Form 32 (assembly-input-contract.md).
FRONT_KEYS |= {"to_parties", "appendix_types"}
JSON_KEYS = {"orders", "pure_law_confirmed", "to_parties", "appendix_types"}
# The Appendix's application-type boxes in the form's order, less its last box,
# "none of the above", which an empty appendix_types list checks.
APPENDIX_TYPES = (
    "discovery: comply with demand for documents",
    "discovery: production of additional documents",
    "other matters concerning document discovery",
    "extend oral discovery",
    "other matter concerning oral discovery",
    "amend pleadings",
    "add/change parties",
    "summary judgment",
    "summary trial",
    "service",
    "mediation",
    "adjournments",
    "proceedings at trial",
    "case plan orders: amend",
    "case plan orders: other",
    "experts",
)


def _check_names(value, what: str) -> None:
    if (not isinstance(value, list) or not value
            or not all(isinstance(n, str) and n.strip() for n in value)):
        raise ValueError(f"{what} must be a non-empty array of names: {value!r}")


def _join_names(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def parse_form32(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("form-32.md must start with --- frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("form-32.md frontmatter has no closing ---") from exc
    front: dict = {}
    for line in lines[1:end]:
        if not line.strip():
            continue
        if ": " not in line:
            raise ValueError(f"malformed frontmatter line: {line!r}")
        key, raw = line.split(": ", 1)
        if key in front or key not in FRONT_KEYS:
            raise ValueError(f"unknown/duplicate frontmatter key: {key}")
        if key in JSON_KEYS:
            try:
                front[key] = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{key} must be JSON-compatible YAML") from exc
        else:
            front[key] = raw
    for key in REQUIRED_FRONT:
        if key not in front:
            raise ValueError(f"missing frontmatter key: {key}")
    # A bracketed placeholder is the lenient emitter's: the jurisdiction is not yet determined.
    if front["associate_judge"] not in ("yes", "no") and not re.fullmatch(r"\[[^\]\n]+\]", front["associate_judge"]):
        raise ValueError(f"associate_judge must be yes, no or a bracketed placeholder: {front['associate_judge']!r}")
    if not isinstance(front["orders"], list) or not front["orders"]:
        raise ValueError("orders must be a non-empty array")
    for order in front["orders"]:
        if not isinstance(order, dict) or not {"order", "text"} <= set(order) <= {"order", "text", "against"}:
            raise ValueError("each order must have order and text, and may have against")
        if not isinstance(order["order"], int):
            raise ValueError(f"order number must be an integer: {order!r}")
        if not isinstance(order["text"], str) or not order["text"].strip():
            raise ValueError(f"order text must be a non-empty string: {order!r}")
        if "against" in order:
            _check_names(order["against"], f"order {order['order']} against")
    if "to_parties" in front:
        _check_names(front["to_parties"], "to_parties")
    if "appendix_types" in front:
        types = front["appendix_types"]
        if (not isinstance(types, list) or len(set(types)) != len(types)
                or any(t not in APPENDIX_TYPES for t in types)):
            raise ValueError(f"appendix_types must be distinct Appendix box labels: {types!r}")

    sections: dict = {part: [] for part in PARTS}
    current = None
    expected = 1                             # numbering continuous across Parts 2-3
    for raw in lines[end + 1:]:
        line = raw.rstrip()
        if not line:
            continue
        if line.startswith("## "):
            name = line[3:]
            if name not in PARTS or sections[name]:
                raise ValueError(f"invalid/duplicate heading: {line}")
            # enforce Part 2 -> Part 3 -> Part 4 order
            if PARTS.index(name) != len([p for p in PARTS if sections[p]]):
                raise ValueError(f"parts out of order: {line}")
            current = name
            continue
        if current is None:
            raise ValueError(f"content before Part 2: {line}")
        if line.startswith(("###", "- ")) and current != "Part 4":
            raise ValueError(f"disallowed markdown: {line}")
        if re.search(r"\*\*|__|\[[^]]+\]\(|^\s{2,}[-*+] |^\|", line):
            raise ValueError(f"disallowed markdown: {line}")
        if current == "Part 4":
            if line == "Nil.":
                sections[current].append(line)
            elif not line.startswith("- "):
                raise ValueError(f"Part 4 must be a flat dash list: {line}")
            else:
                sections[current].append(line[2:])
            continue
        if line == "Nil.":
            sections[current].append(line)
            continue
        if line.startswith(("> ", ">> ")):      # excerpt / citation line
            sections[current].append(line)
            continue
        match = PARA.match(line)
        if not match or int(match.group(1)) != expected:
            raise ValueError(
                f"paragraph numbering must be continuous; expected {expected}: {line}")
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
    if sections["Part 2"] == ["Nil."] and not front.get("pure_law_confirmed", False):
        raise ValueError("Part 2 Nil requires pure_law_confirmed: true")
    return {"front": front, "sections": sections}


def _split_estimate(time_estimate: str) -> tuple[str | None, str | None]:
    """"2 hours"->("2","0"); "1 hour 30 minutes"->("1","30"); "45 minutes"->("0","45")."""
    h = re.search(r"(\d+)\s*h(?:ou)?r", time_estimate, re.I)
    mi = re.search(r"(\d+)\s*min", time_estimate, re.I)
    hours = h.group(1) if h else None
    minutes = mi.group(1) if mi else None
    if hours is None and minutes is None:
        return None, None
    return (hours or "0"), (minutes or "0")


def _estimate_hours(time_estimate: str) -> float | None:
    hh, mm = _split_estimate(time_estimate)
    if hh is None and mm is None:
        return None
    return int(hh) + int(mm) / 60.0


def _order_text(order: dict) -> str:
    """The order's text, naming the parties it is sought against when the
    entry carries them: "An order for costs (against A and B)."."""
    text = order["text"]
    if "against" not in order:
        return text
    stem, end = (text[:-1], text[-1]) if text[-1] in ".;:," else (text, "")
    return f"{stem} (against {_join_names(order['against'])}){end}"


def transform(parsed: dict, base: dict) -> tuple[dict, str, list[str]]:
    """Return (additions, body_text, warnings). `additions` is merged onto the
    base Generate context; body_text is the === PART N === paste for fill_plain."""
    front, sections = parsed["front"], parsed["sections"]
    orders = front["orders"]
    part1 = [_order_text(o) for o in sorted(orders, key=lambda o: o["order"])]
    body = []
    for number, title, part_lines in (
        (1, "ORDER(S) SOUGHT", part1),
        (2, "FACTUAL BASIS", sections["Part 2"]),
        (3, "LEGAL BASIS", sections["Part 3"]),
        (4, "MATERIAL TO BE RELIED ON", sections["Part 4"]),
    ):
        body.append(f"=== PART {number}: {title} ===")
        body.extend(part_lines)
        body.append("")

    # Bridge the frontmatter hearing scalars into the noa template's
    # preamble fields ([proposed hearing]/[time estimate]/[COURT ADDRESS ...])
    # and the style of proceeding's [REGISTRY].
    hours, minutes = _split_estimate(front["time_estimate"])
    additions = {
        "proposed_hearing": front["proposed_hearing"],
        # The courthouse address fills the TAKE NOTICE sentence; the bare registry
        # name fills the style of proceeding, where build_subs adds " Registry".
        "court_location": front["hearing_place"],
        "registry": front["registry"],
        # fill_plain.build_subs defaults a missing value to "yes"; the frontmatter always states it.
        "associate_judge": front["associate_judge"],
    }
    # The "To:" line and the Appendix boxes, when form-32.md names them.
    if "to_parties" in front:
        additions["to_affected_parties"] = _join_names(front["to_parties"])
    if "appendix_types" in front:
        additions["appendix_types"] = front["appendix_types"]
    if hours is not None:
        additions["duration_hours"] = hours
        additions["duration_minutes"] = minutes
    else:
        if base.get("duration_hours") is not None:
            additions["duration_hours"] = base["duration_hours"]
        if base.get("duration_minutes") is not None:
            additions["duration_minutes"] = base["duration_minutes"]

    warnings = []
    est = _estimate_hours(front["time_estimate"])
    if est is not None and est > 2:
        warnings.append(
            "time_estimate exceeds 2 hours: Rule 8-1(16) written-argument "
            "obligations apply (advisory only)")
    words = sum(len(x.split()) for x in
                part1 + sections["Part 2"] + sections["Part 3"])
    if words > 4500:
        warnings.append(
            "Form 32 may exceed the Rule 8-1(4) 10-page cap; "
            "assemble-time estimate is warning only")
    return additions, "\n".join(body).rstrip() + "\n", warnings


def required_scalars_present(context: dict) -> tuple[bool, list[str]]:
    """The noa template's build_subs() reads these by direct access; a missing
    key would KeyError deep in fill. Surface it here instead."""
    needed = ("applicant_names", "to_affected_parties", "proposed_hearing",
              "duration_hours", "duration_minutes",
              "associate_judge")
    missing = [k for k in needed if not context.get(k)]
    return (not missing), missing
