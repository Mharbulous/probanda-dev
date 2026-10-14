"""draft.part1 -- Orders sought (lawyer-provided).

Asks the lawyer to provide the orders sought. Each blank-line-delimited
block becomes one numbered paragraph. Writes to part-1-orders-sought.md.
This is a disk-write step: output goes to the session directory.
"""
from __future__ import annotations

import json
from pathlib import Path

from steps.shared.paths import SUBSTANCE_WORKFLOW, case_data_output_dir

max_retries = 2

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["step_result", "ask_user"]},
        "data": {
            "type": "object",
            "properties": {
                "paragraphs": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "output_path": {"type": "string"},
            },
        },
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["kind"],
}


def _draft_dir(ctx: dict) -> Path:
    """Resolve the substance output directory (constant per matter)."""
    matter_path = ctx.get("matter_path", "")
    if not matter_path:
        raise RuntimeError(
            "matter_path is not set — publish-bcsc-form writes into a client "
            "matter and cannot run without one.")
    return case_data_output_dir(
        matter_path, ctx.get("case_data_folder", ""), SUBSTANCE_WORKFLOW)


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("profile_confirmed"):
        return False, "Matter profile must be confirmed before drafting"
    return True, ""


def build_prompt(ctx: dict) -> str:
    answers = ctx.get("step_answers", [])

    # If the lawyer has provided orders text, write it out
    if answers and answers[-1] and answers[-1] is not None:
        lawyer_text = answers[-1]
        draft_dir = _draft_dir(ctx)
        out_path = draft_dir / "part-1-orders-sought.md"
        out_path.write_text(lawyer_text, encoding="utf-8")

        # Parse into paragraphs (blank-line delimited)
        paragraphs = [
            block.strip()
            for block in lawyer_text.split("\n\n")
            if block.strip()
        ]

        return f"""You are a draft agent for Part 1 (Orders Sought) of a BC Supreme Court form.

The lawyer has provided the orders sought. The content has been written to disk.

Return the confirmation:
{{"kind": "step_result", "data": {{"paragraphs": {json.dumps(paragraphs)}, "output_path": "{out_path}"}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""

    # First invocation: ask the lawyer for the orders sought
    return """You are a draft agent for Part 1 (Orders Sought) of a BC Supreme Court form.

Ask the lawyer to provide the orders sought. Each blank-line-delimited block will become one numbered paragraph in the form.

Return:
{"kind": "ask_user", "question": "Please provide the orders sought for Part 1. Enter each order as a separate paragraph (separated by blank lines). For example:\\n\\n1. An order that...\\n\\n2. An order that...", "options": []}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if "paragraphs" in result:
        if not isinstance(result["paragraphs"], list):
            return False, "paragraphs must be a list"
        if len(result["paragraphs"]) == 0:
            return False, "Part 1 must contain at least one paragraph"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    if "paragraphs" in result:
        draft_parts = ctx.get("draft_parts", {})
        draft_parts["part1"] = result["paragraphs"]
        ctx["draft_parts"] = draft_parts
        if "output_path" in result:
            ctx["part1_path"] = result["output_path"]
    return ctx
