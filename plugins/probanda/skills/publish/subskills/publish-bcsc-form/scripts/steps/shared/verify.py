"""shared.verify -- Run verify.py on filled output.

Runs the existing verify.py script on the filled document.
After a Generate fill the subagent receives the verification output and
assesses pass/fail. After an Assemble fill the check is set arithmetic, so the
harness computes the result in-process; it warns and never halts, because the
file already exists.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# verify.py is /publish's shared script, four levels above scripts/.
VERIFY_SCRIPT = Path(__file__).resolve().parents[5] / "scripts" / "verify.py"

max_retries = 0  # verify is deterministic — retry would produce identical output

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
            },
            "required": ["passed", "warnings", "summary"],
        },
    },
    "required": ["kind", "data"],
}


def _run_verify(output_path: str) -> str:
    """Run verify.py and return its stdout."""
    try:
        result = subprocess.run(
            [sys.executable, str(VERIFY_SCRIPT), output_path],
            capture_output=True, text=True, timeout=60,
        )
        return result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return "ERROR: verify.py timed out after 60s"
    except OSError as e:
        return f"ERROR: could not run verify.py: {e}"


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("output_path"):
        return False, "No output file to verify"
    p = Path(ctx["output_path"])
    if not p.exists():
        return False, f"Output file does not exist: {ctx['output_path']}"
    return True, ""


def _detect_phase(ctx: dict) -> str:
    """Determine if this verify runs after generate or after assemble."""
    seq = ctx.get("sequence", "")
    idx = ctx.get("step_index", 0)
    from harness import ASSEMBLY_FILLS, SEQUENCES
    steps = SEQUENCES.get(seq, [])
    if idx > 0 and idx <= len(steps):
        prev_step = steps[idx - 1]
        if prev_step in ASSEMBLY_FILLS:
            return "assemble"
    return "generate"


def computed(ctx: dict) -> bool:
    return _detect_phase(ctx) == "assemble"


def _assemble_result(ctx: dict) -> str:
    """Assemble-phase verify, computed: only the template's own tokens count as
    placeholders, so a bracket from body text (a law-report year) is not one."""
    import importlib.util
    from harness import REGISTRY, SKILL_ROOT
    spec = importlib.util.spec_from_file_location("publish_verify", VERIFY_SCRIPT)
    verify = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verify)
    template = SKILL_ROOT / REGISTRY[ctx["form_id"]]["template"]
    vocabulary = set(verify.PLACEHOLDER_RX.findall(verify.docx_text(template)))
    output = Path(ctx["output_path"])
    warnings = (verify.check_mc_ignorable(output)
                + verify.check_filled(verify.docx_text(output), vocabulary))
    # Form 32's conformance checks, named by its identity file's table.
    if ctx["form_id"] == "form-32" and ctx.get("asm32_form32_path"):
        from steps.asm32.conformance import run as form32_conformance
        warnings += form32_conformance(verify.docx_text(output), ctx)
    summary = (f"{len(warnings)} verification warning(s); the document is not final."
               if warnings else "No residual template placeholders or structural warnings.")
    return json.dumps({"kind": "step_result",
                       "data": {"passed": not warnings, "warnings": warnings,
                                "summary": summary}})


def build_prompt(ctx: dict) -> str:
    phase = _detect_phase(ctx)
    if phase == "assemble":
        return _assemble_result(ctx)
    output_path = ctx.get("output_path", "")
    verify_output = _run_verify(output_path)

    phase_rules = """
- **This is a GENERATE-phase verification.** Content instruction placeholders (e.g. [CONCISE SUMMARY], [OTHER ENACTMENT], [Select an item...], [Set out...]) are EXPECTED to survive — they will be filled in the draft+assemble phases. Only flag proceedings-level placeholders (party names, court file number, registry, etc.) as failures."""

    return f"""You are a verification agent for a BC Supreme Court form drafting system.

The filled document has been verified by verify.py. Review the output below and determine whether the document passed verification.

## Verification Output
{verify_output}

## Document Path
{output_path}

## Phase
This verification runs after the **{phase}** phase.

## Rules
- If the output contains only "OK" lines and no "WARN" lines, the document passed.
- If there are WARN lines about residual placeholders, check if they are in the known leave-blank set (like [mmmm d, yyyy], [number], [judge-date], [deponent name], [CONCISE SUMMARY], [OTHER ENACTMENT]). Leave-blank warnings are acceptable. A [FIRM ADDRESS], [FIRM EMAIL] or [FIRM FAX] token is NOT a leave-blank: those are filled from the firm block in coclerk.json, so a surviving one is a failure.
- If there are WARN lines about actual unfilled placeholders that should have been substituted, the document failed.
- ZWSP warnings are failures.
- mc:Ignorable warnings are failures.{phase_rules}

Return:
{{"kind": "step_result", "data": {{"passed": <true|false>, "warnings": [<list of warning strings>], "summary": "<one sentence summary>"}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if "passed" not in result:
        return False, "Result must include 'passed' boolean"
    if not isinstance(result.get("warnings", []), list):
        return False, "'warnings' must be a list"
    # Assemble phase: the file exists, so a failed check is a warning that
    # apply() records and the done payload reports, never a halt.
    if not result["passed"] and _detect_phase(ctx) != "assemble":
        return False, f"Verification failed: {result.get('summary', 'no summary')}"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["verify_passed"] = result["passed"]
    ctx["verify_warnings"] = result.get("warnings", [])
    ctx["verify_summary"] = result.get("summary", "")
    return ctx
