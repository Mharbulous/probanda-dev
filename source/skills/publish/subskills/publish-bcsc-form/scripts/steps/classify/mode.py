"""Tier 1 -- Mode classification.

Classifies user request into: amend | new-template | regular.
Amend and new-template short-circuit (skip Tiers 2-3).
"""
from __future__ import annotations

VALID_MODES = {"amend", "new-template", "regular"}

max_retries = 1

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": list(VALID_MODES)},
                "confidence": {"type": "number", "minimum": 0,
                               "maximum": 1},
                "ambiguous": {"type": "boolean"},
            },
            "required": ["mode", "confidence"],
        },
    },
    "required": ["kind", "data"],
}


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    mode = result.get("mode")
    if mode not in VALID_MODES:
        return False, f"Invalid mode '{mode}'. Must be one of: {VALID_MODES}"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["mode"] = result["mode"]
    return ctx
