"""nt.convert -- Run convert.py to produce bracket-placeholder template.

Calls convert.py with the raw export and form key. The subagent confirms
readiness; the actual conversion happens in calls_script.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent.parent  # scripts/
CONVERT_PY = SCRIPTS / "convert.py"
SKILL_ROOT = SCRIPTS.parent  # publish-bcsc-form/

max_retries = 1

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "ready": {"type": "boolean"},
            },
            "required": ["ready"],
        },
    },
    "required": ["kind", "data"],
}


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("nt_config"):
        return False, "FORM_CONFIGS entry must be configured before conversion"
    if not ctx.get("raw_docx_path"):
        return False, "Raw .docx path required"
    raw = Path(ctx["raw_docx_path"])
    if not raw.exists():
        return False, f"Raw document not found at {raw}"
    if not ctx.get("form_key"):
        return False, "Form key required"
    return True, ""


def build_prompt(ctx: dict) -> str:
    raw_path = ctx.get("raw_docx_path", "")
    form_key = ctx.get("form_key", "")
    config = ctx.get("nt_config", {})
    alias_count = len(config.get("alias_map", {}))

    return f"""You are a template conversion agent.

The FORM_CONFIGS entry has been written to convert.py. Ready to run conversion.

- Raw document: {raw_path}
- Form key: {form_key}
- Alias mappings: {alias_count}

Confirm the conversion should proceed.

Return:
{{"kind": "step_result", "data": {{"ready": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if not result.get("ready"):
        return False, "Convert step must confirm readiness"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    return ctx


def calls_script(ctx: dict) -> None:
    """Run convert.py to produce the bracket-placeholder .dotx."""
    raw_path = ctx["raw_docx_path"]
    form_key = ctx["form_key"]

    # Output to templates/<form_key>.dotx
    output_path = SKILL_ROOT / "templates" / f"{form_key}.dotx"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, str(CONVERT_PY),
        raw_path,
        str(output_path),
        "--form", form_key,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"convert.py failed (exit {result.returncode}):\n"
            f"{result.stderr}\n{result.stdout}")

    ctx["output_path"] = str(output_path)
    ctx["convert_stdout"] = result.stdout
