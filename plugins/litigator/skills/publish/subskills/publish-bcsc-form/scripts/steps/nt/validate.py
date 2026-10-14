"""nt.validate -- Validate converted template.

Runs verify.py on the converted .dotx template and assesses the result.
Also reminds the user to open in Word for final visual check.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# verify.py is /publish's shared script, four levels above scripts/.
VERIFY_SCRIPT = Path(__file__).resolve().parents[5] / "scripts" / "verify.py"

max_retries = 1

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "passed": {"type": "boolean"},
                "warnings": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "summary": {"type": "string"},
                "output_path": {"type": "string"},
            },
            "required": ["passed", "warnings", "summary", "output_path"],
        },
    },
    "required": ["kind", "data"],
}


def _run_verify(template_path: str) -> str:
    """Run verify.py on the template and return stdout+stderr."""
    try:
        result = subprocess.run(
            [sys.executable, str(VERIFY_SCRIPT), template_path],
            capture_output=True, text=True, timeout=60,
        )
        return result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return "ERROR: verify.py timed out after 60s"
    except OSError as e:
        return f"ERROR: could not run verify.py: {e}"


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("output_path"):
        return False, "No template to validate"
    p = Path(ctx["output_path"])
    if not p.exists():
        return False, f"Template not found at {ctx['output_path']}"
    return True, ""


def build_prompt(ctx: dict) -> str:
    output_path = ctx.get("output_path", "")
    convert_stdout = ctx.get("convert_stdout", "(no output captured)")
    verify_output = _run_verify(output_path)

    return f"""You are a template validation agent for a BC Supreme Court form drafting system.

The converted template has been verified. Review the outputs below.

## Conversion Output
{convert_stdout}

## Verification Output (verify.py)
{verify_output}

## Template Path
{output_path}

## Validation Rules
- If verify.py reports no residual bracket placeholders (except known leave-blank set), PASSED.
- Any ZWSP warnings = FAIL.
- Any undeclared mc:Ignorable prefixes = FAIL.
- Residual <w:sdt> elements = FAIL.
- If conversion output reports "WARNING", include in warnings.

## Important Reminder
After validation, the user MUST open the .dotx in Word once before committing.
No automated check fully substitutes for visual verification.

If verify.py discovered a new quirk, note it -- the user should append a new technique to `reference/techniques.md`.

Return:
{{"kind": "step_result", "data": {{"passed": <true|false>, "warnings": [<warning strings>], "summary": "<one sentence>", "output_path": "{output_path}"}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if "passed" not in result:
        return False, "Result must include 'passed' boolean"
    if not isinstance(result.get("warnings", []), list):
        return False, "'warnings' must be a list"
    if not result.get("output_path"):
        return False, "Result must include 'output_path'"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["verify_passed"] = result["passed"]
    ctx["verify_warnings"] = result.get("warnings", [])
    ctx["verify_summary"] = result.get("summary", "")
    return ctx
