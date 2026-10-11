"""amend.run -- Execute amend.py and verify the output.

Calls amend.py with the original document, amendments spec, and output
paths. Then runs verify.py on the result. The subagent confirms readiness;
the actual work happens in calls_script.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from steps.shared.paths import write_deliverables

SCRIPTS = Path(__file__).resolve().parent.parent.parent  # scripts/
AMEND_SCRIPT = SCRIPTS / "amend.py"
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
                "ready": {"type": "boolean"},
            },
            "required": ["ready"],
        },
    },
    "required": ["kind", "data"],
}


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("amendments_spec_path"):
        return False, "Amendments spec must be produced before running amend.py"
    spec_path = Path(ctx["amendments_spec_path"])
    if not spec_path.exists():
        return False, f"Amendments spec not found at {spec_path}"
    if not ctx.get("original_docx_path"):
        return False, "Original .docx path required"
    orig = Path(ctx["original_docx_path"])
    if not orig.exists():
        return False, f"Original document not found at {orig}"
    return True, ""


def build_prompt(ctx: dict) -> str:
    original = ctx.get("original_docx_path", "")
    spec_path = ctx.get("amendments_spec_path", "")

    return f"""You are an amendment execution agent.

The amendment spec has been validated and is ready to run.

- Original document: {original}
- Amendments spec: {spec_path}

Confirm that the amendment should proceed.

Return:
{{"kind": "step_result", "data": {{"ready": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if not result.get("ready"):
        return False, "Amend step must confirm readiness"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    return ctx


def calls_script(ctx: dict) -> None:
    """Run amend.py to produce the amended document, then verify."""
    original = Path(ctx["original_docx_path"])
    spec_path = Path(ctx["amendments_spec_path"])
    matter_path = ctx.get("matter_path", "")

    form_name = original.stem  # e.g., "Notice of Civil Claim"

    if not matter_path:
        raise RuntimeError(
            "matter_path is not set — publish-bcsc-form writes into a client "
            "matter and cannot run without one.")

    def run_amend(paths):
        cmd = [
            sys.executable, str(AMEND_SCRIPT),
            "--original", str(original),
            "--amendments", str(spec_path),
            "--out", str(paths[0]),
            "--clean", str(paths[1]),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True,
                                encoding="utf-8")
        if result.returncode != 0:
            raise RuntimeError(
                f"amend.py failed (exit {result.returncode}):\n"
                f"{result.stderr}\n{result.stdout}")

    # Bucket 1: the marked-up and clean copies, at the draft folder's root for
    # an individual form or in a package's Writing folder, each versioned in
    # its own series and never over an existing file.
    (out_path, prior), (clean_path, clean_prior) = write_deliverables(
        ctx, f"Amended {form_name}", run_amend, ("", " (clean)"))

    ctx["output_path"] = str(out_path)
    ctx["clean_path"] = str(clean_path)
    ctx["versioned_from"] = str(prior) if prior else None
    ctx["clean_versioned_from"] = str(clean_prior) if clean_prior else None

    # Run verify.py on the marked-up version
    verify_result = subprocess.run(
        [sys.executable, str(VERIFY_SCRIPT), str(out_path)],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    ctx["verify_output"] = verify_result.stdout + verify_result.stderr
    ctx["verify_passed"] = verify_result.returncode == 0
