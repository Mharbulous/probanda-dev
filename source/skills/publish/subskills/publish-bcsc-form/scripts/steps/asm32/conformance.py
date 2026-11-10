"""Form 32 conformance checks, run by shared.verify after an asm32 fill.

The form's identity file (publish/references/CAN/BC/BCSC/Documents/
notice-of-application.md) lists, under "Form instructions", each bracketed
instruction of Form 32 as substituted by B.C. Reg. 105/2026 with the id of
the check that proves the output meets it. Every check the table names runs
here, and each failure is one warning string: verify records it, never halts.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from steps.asm32.common import APPENDIX_TYPES, parse_form32

# scripts/steps/asm32/ is five levels below the /publish skill folder.
IDENTITY_FILE = (Path(__file__).resolve().parents[5] / "references" / "CAN" / "BC"
                 / "BCSC" / "Documents" / "notice-of-application.md")
CHECK_CELL = re.compile(r"^\|[^|]*\|\s*`([a-z0-9_]+)`\s*\|", re.M)
AFFIDAVIT_LINE = re.compile(r"^Affidavit (#\S+ )?of .+, made [A-Z][a-z]+ \d{1,2}, \d{4}$")
JURISDICTION = ("This matter is within the jurisdiction of an associate judge.",
                "This matter is not within the jurisdiction of an associate judge.")
COURT_BOX = "To be completed by the court only:"
APPENDIX = "APPENDIX"


def _line(lines: list[str], test) -> str | None:
    return next((line for line in lines if test(line)), None)


def _to_line(lines, parsed, context):
    line = _line(lines, lambda l: l.startswith("To:"))
    if line is None or not line[3:].strip() or "[" in line:
        return ["Form 32: the To: line names no party or person affected."]
    return []


def _time_estimate(lines, parsed, context):
    line = _line(lines, lambda l: "that the application will take" in l) or ""
    if "[" in line or "hour(s)" in line or "minute(s)" in line:
        return ["Form 32: the time estimate is not stated as a time."]
    return []


def _proposed_hearing(lines, parsed, context):
    line = _line(lines, lambda l: "that the matter will be heard on" in l) or ""
    if "[" in line:
        return ["Form 32: no proposed hearing date, date range or assize is stated; "
                "fill [proposed hearing] in Word."]
    return []


def _associate_judge(lines, parsed, context):
    if sum(line in JURISDICTION for line in lines) != 1:
        return ["Form 32: the notice does not state exactly one associate-judge "
                "jurisdiction sentence."]
    return []


def _party_names(parsed, context) -> list[str]:
    names = list(parsed["front"].get("to_parties", []))
    for key in ("plaintiff_caption", "defendant_caption"):
        names += [n.strip() for n in str(context.get(key) or "").splitlines() if n.strip()]
    return [n.lower() for n in names]


def _part1_against(lines, parsed, context):
    names = _party_names(parsed, context)
    return [f"Form 32 Part 1, order {o['order']}: names no party against whom it is sought."
            for o in sorted(parsed["front"]["orders"], key=lambda o: o["order"])
            if "against" not in o and not any(n in o["text"].lower() for n in names)]


def _part4_affidavits(lines, parsed, context):
    warnings = []
    for item in parsed["sections"]["Part 4"]:
        if not (item.startswith("Affidavit ") or ", made " in item) or AFFIDAVIT_LINE.match(item):
            continue
        if item.endswith(", made [date]"):
            warnings.append(f"Form 32 Part 4: \"{item}\" has no made date; fill [date] in Word.")
        else:
            warnings.append(f"Form 32 Part 4: \"{item}\" does not identify the affidavit as "
                            "\"Affidavit #<n> of <name>, made <date>\".")
    return warnings


def _court_box(lines, parsed, context):
    if COURT_BOX not in lines:
        return ["Form 32: the \"To be completed by the court only\" box is missing."]
    start = lines.index(COURT_BOX)
    end = lines.index(APPENDIX, start) if APPENDIX in lines[start:] else len(lines)
    if any("[" in line for line in lines[start:end]):
        return ["Form 32: the court-only box carries a bracketed prompt."]
    return []


def _appendix(lines, parsed, context):
    if APPENDIX not in lines:
        return ["Form 32: the Appendix is missing."]
    boxes = [line for line in lines[lines.index(APPENDIX):] if line[:1] in ("☐", "☒")]
    labels = [line[1:] for line in boxes]
    warnings = [f"Form 32 Appendix: the box \"{label}\" is missing."
                for label in (*APPENDIX_TYPES, "none of the above") if label not in labels]
    if not any(line.startswith("☒") for line in boxes):
        warnings.append("Form 32 Appendix: no application-type box is checked; "
                        "check the application type(s) in Word.")
    return warnings


def _none(lines, parsed, context):
    return []


# `placeholder`: verify's residual-placeholder check covers it. `grammar`:
# asm32.validate enforces it. `template`: the conformed template's own layout.
# `counsel`: counsel's drafting, which no check can prove.
CHECKS = {
    "to_line": _to_line,
    "time_estimate": _time_estimate,
    "proposed_hearing": _proposed_hearing,
    "associate_judge": _associate_judge,
    "part1_against": _part1_against,
    "part4_affidavits": _part4_affidavits,
    "court_box": _court_box,
    "appendix": _appendix,
    "placeholder": _none,
    "grammar": _none,
    "template": _none,
    "counsel": _none,
}


def run(output_text: str, ctx: dict) -> list[str]:
    """Warnings for the assembled Form 32 whose text (one line per paragraph)
    is `output_text`, from the checks the identity file's table names."""
    section = IDENTITY_FILE.read_text(encoding="utf-8").split("## Form instructions", 1)[1]
    section = section.split("\n## ", 1)[0]
    lines = [line.strip() for line in output_text.splitlines()]
    parsed = parse_form32(Path(ctx["asm32_form32_path"]))
    context = json.loads(Path(ctx["asm32_context_path"]).read_bytes().rstrip(b"\x00").decode("utf-8"))
    warnings: list[str] = []
    for check in dict.fromkeys(CHECK_CELL.findall(section)):
        if check not in CHECKS:
            warnings.append(f"Form 32: the identity file names an unknown check `{check}`.")
            continue
        warnings += CHECKS[check](lines, parsed, context)
    return warnings
