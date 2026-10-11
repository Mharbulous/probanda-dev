"""asm.fill -- Fill template with context + assembled body.

Calls fill_plain.py with --context and --body to produce the final
filled document with substance content. The harness runs the script
via calls_script after the subagent confirms readiness.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from steps.shared.paths import write_deliverables

HERE = Path(__file__).resolve().parent          # steps/asm/
SCRIPTS = HERE.parent.parent                    # scripts/
SKILL_ROOT = SCRIPTS.parent                     # publish-bcsc-form/

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
    if not ctx.get("asm_body_path"):
        return False, "Assembled body must exist before fill"
    body_path = Path(ctx["asm_body_path"])
    if not body_path.exists():
        return False, f"Body file does not exist: {ctx['asm_body_path']}"
    # Need context.json (from gen.fill or asm.locate_inputs)
    ctx_path = ctx.get("asm_context_path") or ctx.get("context_path", "")
    if not ctx_path or not Path(ctx_path).exists():
        return False, "context.json not found. Run Generate form first."
    return True, ""


def build_prompt(ctx: dict) -> str:
    return f"""You are a fill-readiness agent. The assembled body and context are ready.

Confirm that the form is ready to be filled with substance content.

Return:
{{"kind": "step_result", "data": {{"ready": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if not result.get("ready"):
        return False, "Fill step must confirm readiness"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    return ctx


def calls_script(ctx: dict) -> None:
    """Run fill_plain.py with --context and --body to produce filled document."""
    from harness import REGISTRY, SKILL_ROOT as HR_SKILL_ROOT

    form_id = ctx.get("form_id", "form-32")
    form_spec = REGISTRY.get(form_id, REGISTRY["form-32"])
    template_path = HR_SKILL_ROOT / form_spec["template"]
    fill_form_arg = form_spec["fill_form_arg"]

    # Resolve paths
    context_path = ctx.get("asm_context_path") or ctx.get("context_path", "")
    body_path = ctx.get("asm_body_path", "")

    scalars = ctx.get("scalars") or {}
    matter_path = ctx.get("matter_path", "")
    title = scalars.get("title", form_spec["name"])

    if not matter_path:
        raise RuntimeError(
            "matter_path is not set — publish-bcsc-form writes into a client "
            "matter and cannot run without one.")

    # Load context and body for in-process fill (avoids FUSE truncation)
    context = json.loads(
        Path(context_path).read_bytes().rstrip(b"\x00").decode("utf-8"))
    body_text = Path(body_path).read_text(encoding='utf-8') if body_path else ''

    sys.path.insert(0, str(SCRIPTS))
    from fill_plain import fill
    # Bucket 1: the final .docx, at the draft folder's root for an individual
    # form or in a package's Writing folder, never over an existing file.
    [(out_path, prior)] = write_deliverables(
        ctx, title, lambda paths: fill(
            template_path, context, body_text, paths[0], form=fill_form_arg))

    if not out_path.exists():
        raise RuntimeError(f"fill produced no output: {out_path}")

    ctx["output_path"] = str(out_path)
    ctx["versioned_from"] = str(prior) if prior else None
