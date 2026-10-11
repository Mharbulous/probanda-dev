"""Tier 2 -- Form identification.

Identifies which BC Supreme Court form the user wants.
Only reached for 'regular' mode.
"""
from __future__ import annotations

max_retries = 1

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "form_id": {"type": "string"},
                "form_name": {"type": "string"},
                "confidence": {"type": "number"},
                "ambiguous": {"type": "boolean"},
                "registered": {"type": "boolean"},
            },
            "required": ["form_id", "form_name", "confidence", "registered"],
        },
    },
    "required": ["kind", "data"],
}


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    form_id = result.get("form_id")
    if not form_id:
        return False, "form_id must be non-empty"
    if not result.get("form_name"):
        return False, "form_name must be non-empty"
    import re
    if form_id not in ("affidavit",) and not re.match(r"^form-\d+$", form_id):
        return False, (f"form_id '{form_id}' must match 'form-NN' format "
                       f"or be 'affidavit'")
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["form_id"] = result["form_id"]
    ctx["form_name"] = result.get("form_name", "")
    ctx["form_registered"] = result.get("registered", True)
    return ctx
