"""The publish warnings of the strict asm32/asm33 paths (references/assembly-input-contract.md,
"Publish sidecar").

A warning is {"kind": "missing_datum" | "unmet_criterion" | "other", "field_or_id", "message"}. The
emitter's sidecar brings its own, asm32/asm33 add one for each caption field they print as a
placeholder, and the residual-placeholder scan adds the rest. Together they are the document's
NOT FINAL cover page (fill_cover.py) and the done payload's `warnings`.
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

# A whole frontmatter value that is a bracketed placeholder the emitter printed for missing data.
PLACEHOLDER = re.compile(r"^\[[^\]\n]+\]$")
# A law-report year in square brackets, as in "[1903] A.C. 1": a citation, never a placeholder.
LAW_REPORT_YEAR = re.compile(r"^\[\d{4}\]$")

# /publish's shared verify.py, four levels above scripts/, which owns the placeholder pattern
# and the leave-blank set.
_VERIFY_SCRIPT = Path(__file__).resolve().parents[5] / "scripts" / "verify.py"
_verify = None


def verify_module():
    """/publish's verify.py, loaded once."""
    global _verify
    if _verify is None:
        spec = importlib.util.spec_from_file_location("publish_verify", _VERIFY_SCRIPT)
        _verify = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_verify)
    return _verify


def missing_datum(field: str, message: str) -> dict:
    return {"kind": "missing_datum", "field_or_id": field, "message": message}


def other(field: str, message: str) -> dict:
    return {"kind": "other", "field_or_id": field, "message": message}


def read_sidecar(path: Path) -> tuple[dict, list[dict]]:
    """The sidecar's caption and warnings. A missing sidecar halts nothing: the caption fields
    then print placeholders, and this says why. A sidecar that is not the emitter's JSON raises."""
    if not path.is_file():
        return {}, [missing_datum(
            "publish_sidecar",
            f"The emitter's {path.name} was not found beside the form, so the caption shows placeholders. "
            "Emit the form again with its case-data folder, then publish again.")]
    data = json.loads(path.read_bytes().rstrip(b"\x00").decode("utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("caption"), dict) or not isinstance(data.get("warnings"), list):
        raise ValueError(f"{path} is not the emitter's publish sidecar: it needs a caption object and a warnings list")
    return data["caption"], data["warnings"]


def frontmatter_placeholders(front: dict) -> list[str]:
    """The placeholders the emitter printed in the frontmatter, which its warnings already report."""
    return [v for v in front.values() if isinstance(v, str) and PLACEHOLDER.match(v)]


def fill_missing(context: dict, fields: dict, warnings: list[dict], placeholders: list[str]) -> None:
    """Print each missing field as its template placeholder and report it once.

    fields maps a context key to (placeholder, what the cover calls it, the emitter warning's
    field_or_id that already reports it, or None).
    """
    reported = {w.get("field_or_id") for w in warnings}
    for key, (placeholder, label, reported_as) in fields.items():
        if context.get(key):
            continue
        context[key] = placeholder
        placeholders.append(placeholder)
        if reported_as is None or reported_as not in reported:
            warnings.append(missing_datum(key, f"{label}: not recorded. The form shows {placeholder}."))


def residual_warnings(docx_path: Path, body_path: Path | None, known: list[dict],
                      placeholders: list[str]) -> list[dict]:
    """Every unfilled placeholder left in the document that no warning reports yet.

    Not a placeholder: a leave-blank token, a law-report year such as [1903], a bracketed token
    inside a quoted ("> ") line of the assembled body, and one already named in a warning (which
    covers the cover page's own lines).
    """
    v = verify_module()
    text = v.docx_text(docx_path)
    quoted = ""
    if body_path is not None and body_path.is_file():
        quoted = "\n".join(line for line in body_path.read_text(encoding="utf-8").splitlines()
                           if line.startswith("> "))
    named = "\n".join(str(w.get("message", "")) for w in known)
    found = []
    for token in dict.fromkeys(m.group() for m in v.PLACEHOLDER_RX.finditer(text)):
        if (token in v.LEAVE_BLANK or LAW_REPORT_YEAR.match(token) or token in placeholders
                or token in quoted or token in named):
            continue
        found.append(other("verify", f"Unfilled placeholder {token} remains in the document."))
    if "​" in text and "zero-width space" not in named:
        found.append(other("verify", "A zero-width space remains in the document."))
    return found
