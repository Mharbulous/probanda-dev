"""asm.assemble_body -- Merge substance files into body format.

Reads part-*.md files from the draft directory and assembles them into
the === PART N: TITLE === format expected by fill_plain.py's parse_body().
Disk-write step: writes assembled body to the session/draft directory.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from steps.shared.paths import SUBSTANCE_WORKFLOW, case_data_output_dir

max_retries = 1

PART_HEADERS = {
    "part-1-orders-sought.md": "=== PART 1: ORDER(S) SOUGHT ===",
    "part-2-factual-basis.md": "=== PART 2: FACTUAL BASIS ===",
    "part-3-legal-basis.md": "=== PART 3: LEGAL BASIS ===",
    "part-4-material-relied-on.md": "=== PART 4: MATERIAL TO BE RELIED ON ===",
}

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "body_path": {"type": "string"},
                "part_count": {"type": "integer"},
                "warnings": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["body_path", "part_count"],
        },
    },
    "required": ["kind", "data"],
}


def _draft_dir(ctx: dict) -> Path:
    """The substance folder is a constant per matter -- same as the reader's."""
    matter_path = ctx.get("matter_path", "")
    if not matter_path:
        raise RuntimeError(
            "matter_path is not set — publish-bcsc-form writes into a client "
            "matter and cannot run without one.")
    return case_data_output_dir(
        matter_path, ctx.get("case_data_folder", ""), SUBSTANCE_WORKFLOW)


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("asm_found_parts"):
        return False, "asm.locate_inputs must run first"
    return True, ""


def build_prompt(ctx: dict) -> str:
    draft_dir = _draft_dir(ctx)
    found_parts = ctx.get("asm_found_parts", [])
    missing_parts = ctx.get("asm_missing_parts", [])

    # Assemble the body text in Python (deterministic, not LLM work)
    sections = []
    warnings = []
    part_count = 0

    for filename, header in PART_HEADERS.items():
        part_path = draft_dir / filename
        if part_path.exists():
            content = part_path.read_text(encoding="utf-8").strip()
            sections.append(f"{header}\n\n{content}")
            part_count += 1
        else:
            # Include header with no content for missing parts
            sections.append(header)
            if filename not in missing_parts:
                warnings.append(f"Part file {filename} is empty in assembled output.")

    body_text = "\n\n".join(sections) + "\n"

    # Write to disk (case_data_output_dir already created draft_dir)
    body_path = draft_dir / "body.txt"
    body_path.write_text(body_text, encoding="utf-8")

    warnings_json = json.dumps(warnings + (
        [f"Missing parts: {', '.join(missing_parts)}"] if missing_parts else []
    ))

    return f"""You are an assembly agent for a BC Supreme Court form.

The substance files have been assembled into the body format required by fill_plain.py. The assembled body has been written to disk.

## Assembly Summary
- Parts assembled: {part_count} of 4
- Body written to: {body_path}
- Missing parts: {json.dumps(missing_parts)}

Return the result:
{{"kind": "step_result", "data": {{"body_path": "{body_path}", "part_count": {part_count}, "warnings": {warnings_json}}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    body_path = result.get("body_path", "")
    if not body_path:
        return False, "body_path is required"
    if not Path(body_path).exists():
        return False, f"Body file does not exist: {body_path}"
    part_count = result.get("part_count", 0)
    if part_count == 0:
        return False, "At least one part must be assembled"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["asm_body_path"] = result["body_path"]
    ctx["asm_part_count"] = result["part_count"]
    ctx["asm_body_warnings"] = result.get("warnings", [])
    return ctx
