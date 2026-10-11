"""gen.fill -- Fill template with scalars (no body content).

Calls fill_plain.py to produce the blank form. The harness runs the
script via calls_script after the subagent confirms readiness.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from steps.shared.paths import (
    SUBSTANCE_WORKFLOW,
    case_data_output_dir,
    write_deliverables,
)

HERE = Path(__file__).resolve().parent          # steps/gen/
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
    if not ctx.get("profile_confirmed"):
        return False, "Profile must be confirmed before fill"
    if not ctx.get("scalars"):
        return False, "Scalars must be collected before fill"
    return True, ""


def build_prompt(ctx: dict) -> str:
    return f"""You are a fill-readiness agent. The matter profile is confirmed and all scalar fields are collected.

Confirm that the form is ready to be filled.

Return:
{{"kind": "step_result", "data": {{"ready": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if not result.get("ready"):
        return False, "Fill step must confirm readiness"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    # Prepare output paths -- fill script runs via calls_script
    return ctx


def calls_script(ctx: dict) -> None:
    """Run fill_plain.py to produce the filled document."""
    from harness import REGISTRY, SKILL_ROOT as HR_SKILL_ROOT

    form_id = ctx.get("form_id", "form-32")
    form_spec = REGISTRY.get(form_id, REGISTRY["form-32"])
    template_path = HR_SKILL_ROOT / form_spec["template"]
    fill_form_arg = form_spec["fill_form_arg"]

    scalars = ctx.get("scalars", {})
    matter_path = ctx.get("matter_path", "")
    title = scalars.get("title", form_spec["name"])

    if not matter_path:
        raise RuntimeError(
            "matter_path is not set — publish-bcsc-form writes into a client "
            "matter and cannot run without one.")
    mp = Path(matter_path)
    if not mp.is_absolute() or not mp.is_dir():
        raise RuntimeError(
            f"matter_path is not an absolute existing directory: "
            f"{matter_path!r} — translate Windows paths to the sandbox "
            f"mount before use")

    # Bucket 2: context.json lives with the substance parts, so assembly reads
    # the base context and the part files from the same folder.
    context_path = case_data_output_dir(
        mp, ctx.get("case_data_folder", ""), SUBSTANCE_WORKFLOW) / "context.json"
    context_path.write_text(
        json.dumps(scalars, indent=2, ensure_ascii=False), encoding="utf-8")

    # In-process fill (avoids FUSE truncation of subprocess scripts)
    sys.path.insert(0, str(SCRIPTS))
    from fill_plain import build_compliance_table, fill, is_substituted_service
    # Bucket 1: the final .docx, at the draft folder's root for an individual
    # form or in a package's Writing folder, never over an existing file.
    [(out_path, prior)] = write_deliverables(
        ctx, title, lambda paths: fill(
            template_path, scalars, '', paths[0], form=fill_form_arg))

    if not out_path.exists():
        raise RuntimeError(f"fill produced no output: {out_path}")

    # The order ↔ affidavit comparison travels back in the completion payload,
    # for the practitioner to check in chat. It is never written into the file.
    if fill_form_arg == 'aos' and is_substituted_service(scalars):
        ctx["compliance_table"] = build_compliance_table(scalars)

    ctx["output_path"] = str(out_path)
    ctx["versioned_from"] = str(prior) if prior else None
    ctx["context_path"] = str(context_path)
