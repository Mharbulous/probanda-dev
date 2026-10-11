"""asm.locate_inputs -- Locate prerequisite files for assembly.

Checks for context.json and part-*.md files in the draft directory.
Hard halt if zero substance files. Warns on partial absence.
"""
from __future__ import annotations

import json
from pathlib import Path

from steps.shared.paths import SUBSTANCE_WORKFLOW, case_data_output_dir

max_retries = 1

EXPECTED_PARTS = [
    "part-1-orders-sought.md",
    "part-2-factual-basis.md",
    "part-3-legal-basis.md",
    "part-4-material-relied-on.md",
]

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "context_path": {"type": "string"},
                "found_parts": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "missing_parts": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "warnings": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["context_path", "found_parts", "missing_parts"],
        },
    },
    "required": ["kind", "data"],
}


def _draft_dir(ctx: dict) -> Path:
    """The substance folder is a constant per matter -- no scan, no baton.

    Both the producer (gen.fill / draft.partN) and this reader resolve to the
    same {case-data folder}/bcsc-form-substance/ path, so the same-session
    handoff is safe by construction.
    """
    matter_path = ctx.get("matter_path", "")
    if not matter_path:
        raise RuntimeError(
            "matter_path is not set — publish-bcsc-form writes into a client "
            "matter and cannot run without one.")
    return case_data_output_dir(
        matter_path, ctx.get("case_data_folder", ""), SUBSTANCE_WORKFLOW)


def precondition(ctx: dict) -> tuple[bool, str]:
    draft_dir = _draft_dir(ctx)

    # Check for context.json
    context_path = draft_dir / "context.json"
    if not context_path.exists():
        # Also check ctx for a stored context_path from gen.fill
        stored = ctx.get("context_path", "")
        if stored and Path(stored).exists():
            pass  # OK, context exists at stored path
        else:
            return False, (
                f"context.json not found in {draft_dir}. "
                "Run Generate form first to create proceedings context."
            )

    # Check for any part-*.md files (hard gate: zero = halt)
    part_files = list(draft_dir.glob("part-*.md"))
    if not part_files:
        return False, (
            f"No substance files (part-*.md) found in {draft_dir}. "
            "Run Draft substance first, or provide content files."
        )

    return True, ""


def build_prompt(ctx: dict) -> str:
    draft_dir = _draft_dir(ctx)
    context_path = draft_dir / "context.json"
    stored_context = ctx.get("context_path", "")

    if context_path.exists():
        ctx_path_str = str(context_path)
    elif stored_context and Path(stored_context).exists():
        ctx_path_str = stored_context
    else:
        ctx_path_str = ""

    # Scan for part files
    found = []
    missing = []
    for part_name in EXPECTED_PARTS:
        if (draft_dir / part_name).exists():
            found.append(part_name)
        else:
            missing.append(part_name)

    warnings = []
    if missing:
        warnings.append(
            f"Missing substance files: {', '.join(missing)}. "
            "These parts will be empty in the assembled form."
        )

    found_str = json.dumps(found)
    missing_str = json.dumps(missing)
    warnings_str = json.dumps(warnings)

    return f"""You are an input locator agent for assembling a BC Supreme Court form.

The following inputs have been located in the draft directory:

## Context File
Path: {ctx_path_str}
Status: {"Found" if ctx_path_str else "NOT FOUND"}

## Substance Files
Found: {found_str}
Missing: {missing_str}

## Warnings
{warnings_str if warnings else "None"}

Return the manifest:
{{"kind": "step_result", "data": {{"context_path": "{ctx_path_str}", "found_parts": {found_str}, "missing_parts": {missing_str}, "warnings": {warnings_str}}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if not result.get("context_path"):
        return False, "context_path is required"
    found = result.get("found_parts", [])
    if not isinstance(found, list):
        return False, "found_parts must be a list"
    if len(found) == 0:
        return False, "At least one substance file must be present"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["asm_context_path"] = result["context_path"]
    ctx["asm_found_parts"] = result["found_parts"]
    ctx["asm_missing_parts"] = result.get("missing_parts", [])
    ctx["asm_warnings"] = result.get("warnings", [])
    return ctx
