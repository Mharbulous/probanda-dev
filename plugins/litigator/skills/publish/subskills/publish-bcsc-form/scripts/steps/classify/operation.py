"""Tier 3 -- Operation classification.

Classifies: generate | draft | assemble | none (-> full pipeline).
Only reached for regular-mode forms without a dedicated workflow.
"""
from __future__ import annotations

VALID_OPS = {"generate", "draft", "assemble", "none"}

max_retries = 1

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "op_id": {"type": "string",
                          "enum": list(VALID_OPS)},
                "confidence": {"type": "number"},
                "ambiguous": {"type": "boolean"},
            },
            "required": ["op_id", "confidence"],
        },
    },
    "required": ["kind", "data"],
}


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    op = result.get("op_id")
    if op not in VALID_OPS:
        return False, f"Invalid op_id '{op}'. Must be one of: {VALID_OPS}"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["operation"] = result["op_id"]
    return ctx
