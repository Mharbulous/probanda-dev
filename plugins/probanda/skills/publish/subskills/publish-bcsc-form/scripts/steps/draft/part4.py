"""draft.part4 -- Material to be relied on (lawyer-provided).

Asks the lawyer to list the material to be relied on. Each line becomes
one numbered affidavit entry. Writes to part-4-material-relied-on.md.
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
                "entries": {
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
    matter_path = ctx.get("matter_path", "")
    if not matter_path:
        raise RuntimeError(
            "matter_path is not set — publish-bcsc-form writes into a client "
            "matter and cannot run without one.")
    return case_data_output_dir(
        matter_path, ctx.get("case_data_folder", ""), SUBSTANCE_WORKFLOW)


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("profile_confirmed"):
        return False, "Matter profile must be confirmed before drafting Part 4"
    return True, ""


def build_prompt(ctx: dict) -> str:
    answers = ctx.get("step_answers", [])

    # If the lawyer has provided the material list, write it out
    if answers and answers[-1] and answers[-1] is not None:
        lawyer_text = answers[-1]
        draft_dir = _draft_dir(ctx)
        out_path = draft_dir / "part-4-material-relied-on.md"

        # Parse entries: each non-empty line is one entry
        # Strip leading "- " if present (fill_plain.py also strips these)
        entries = []
        for line in lawyer_text.strip().splitlines():
            line = line.strip()
            if line:
                if line.startswith("- "):
                    line = line[2:]
                entries.append(line)

        # Write with "- " prefix for consistency with reference doc
        out_path.write_text(
            "\n".join(f"- {e}" for e in entries) + "\n",
            encoding="utf-8",
        )

        return f"""You are a draft agent for Part 4 (Material to Be Relied On).

The lawyer has provided the material list. The content has been written to disk.

Return the confirmation:
{{"kind": "step_result", "data": {{"entries": {json.dumps(entries)}, "output_path": "{out_path}"}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # First invocation: ask the lawyer for the material list
    return """You are a draft agent for Part 4 (Material to Be Relied On) of a BC Supreme Court form.

Ask the lawyer to list the affidavits and other material to be relied on. Each line becomes one numbered entry in the form.

Return:
{"kind": "ask_user", "question": "Please list the material to be relied on for Part 4. Enter each item on a separate line, optionally prefixed with '- '. For example:\\n\\n- Affidavit #1 of Jane Chen made April 15, 2026\\n- Affidavit #1 of John Smith made April 20, 2026", "options": []}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if "entries" in result:
        if not isinstance(result["entries"], list):
            return False, "entries must be a list"
        if len(result["entries"]) == 0:
            return False, "Part 4 must list at least one item of material"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    if "entries" in result:
        draft_parts = ctx.get("draft_parts", {})
        draft_parts["part4"] = result["entries"]
        ctx["draft_parts"] = draft_parts
        if "output_path" in result:
            ctx["part4_path"] = result["output_path"]
    return ctx
