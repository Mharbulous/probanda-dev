"""Combined classification -- single subagent call replacing Tiers 1-3.

Mode, form, and operation classification are each self-contained and need
only user_request (+ registry text) -- no tier's output feeds the next
tier's prompt -- so all three can be asked in one shot instead of three
sequential spawns.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent.parent
sys.path.insert(0, str(SCRIPTS)) if str(SCRIPTS) not in sys.path else None

from steps.classify.mode import VALID_MODES
from steps.classify.operation import VALID_OPS

max_retries = 2

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": list(VALID_MODES)},
                "form_id": {"type": "string"},
                "form_name": {"type": "string"},
                "registered": {"type": "boolean"},
                "op_id": {"type": "string", "enum": list(VALID_OPS)},
                "service_mode": {"type": "string",
                                 "enum": ["ordinary", "substituted"]},
                "confidence": {"type": "number", "minimum": 0,
                               "maximum": 1},
                "ambiguous": {"type": "boolean"},
            },
            "required": ["mode", "confidence"],
        },
    },
    "required": ["kind", "data"],
}


def _get_registry():
    from harness import REGISTRY
    return REGISTRY


def precondition(ctx: dict) -> tuple[bool, str]:
    return True, ""


def build_classify_prompt(user_request: str) -> str:
    """Build the combined mode+form+operation classification prompt."""
    registry = _get_registry()
    registry_text = "\n".join(
        f"- **{fid}**: {spec['name']} ({spec['rule']})"
        for fid, spec in registry.items()
    )
    return f"""You are a classification agent for a BC Supreme Court form drafting system.

Given the user's request below, classify it across three dimensions in a single pass.

## Step 1 -- Mode
Classify into exactly one mode:

- **amend**: The user wants to amend a previously filed pleading (mentions amendment, Rule 6-1, amending a filed document).
- **new-template**: The user wants to convert a raw/LEAP-exported template into a bracket-placeholder template (mentions LEAP, raw template, conversion, new form type).
- **regular**: Anything else -- the user wants to draft, generate, or assemble a BC Supreme Court form.

## Step 2 -- Form (only if mode is "regular")
Identify which BC Supreme Court form the user wants.

### Registered Forms (templates ready)
{registry_text}

### Identification Rules
If the user mentions "NOA" or "notice of application", return form-32.
If the user mentions "petition" or "Form 66", return form-66.
If the user mentions "offer to settle costs" or "Form 123", return form-123.
If the user mentions "notice of civil claim", "NOCC", or "Form 1", return form-1.
If the user mentions "response to counterclaim" or "Form 4", return form-4.
If the user mentions "requisition", "requisition – general", or "Form 17", return form-17.
If the user mentions "default judgment", "default judgement", or "Form 8", return form-8.
If the user mentions "affidavit of personal service", "Form 15", or describes service
effected personally (personally served, handed to the person, left with the person),
return form-15.
If the user mentions "affidavit of ordinary service", "Form 16", or describes service at
a party's address for service (mailed to, faxed to, e-mailed to, or left at that
address), return form-16 with service_mode "ordinary".
If the user mentions "affidavit of substituted service", "AOSS", proof of service under a
substituted service order, or describes service effected under a Rule 4-4 order for an
alternative method of service (substituted, substitutional, or alternative service --
e.g. "serve by email and mail per the order"), return form-16 with service_mode
"substituted". Form 16 is the skeleton, modified under Rule 22-3(1) to match the terms of
the order. Do not set ambiguous for this: the routing is settled.
If the user says "affidavit of service" with no indication whether service was personal,
ordinary, or under an order, set ambiguous to true and confidence below 0.8. Never guess
among the three -- they depose to different facts and none can be truthfully completed
for another's mode of service.
If the user wants an affidavit that goes beyond proving service -- for example a combined
narrative of service attempts supporting a further application -- return affidavit
(Form 109), not form-16.
If the user mentions "affidavit" in any other sense, return affidavit.

If the user's request refers to a BC Supreme Court form NOT listed above, identify it
by its official form number. Use the form_id format "form-NN" (e.g., "form-33" for
Application Response). Set "registered" to false. Set "form_name" to the official
name (e.g., "Application Response (Form 33)").

For registered forms, set "registered" to true and use the form_name from the registry.

## Step 3 -- Operation (only if mode is "regular")
Classify the user's request into exactly one operation:

- **generate**: The user wants a blank form with proceedings info filled but substantive body sections untouched. Keywords: "blank form", "just the header", "generate", "fill out proceedings info".
- **draft**: The user wants substantive content drafted in markdown for review. Keywords: "draft substance", "draft parts", "write the content".
- **assemble**: The user wants to merge previously drafted substance into a form template. Keywords: "assemble", "merge", "combine substance into form".
- **none**: The user wants the full pipeline (generate + draft + assemble). Keywords: no specific operation mentioned, or "draft a [form]" without specifying which phase.

## User Request
{user_request}

## Response Format
Return ONLY a JSON object:
{{"kind": "step_result", "data": {{"mode": "<amend|new-template|regular>", "form_id": "<form-id, only if mode is regular>", "form_name": "<official name, only if mode is regular>", "registered": <true|false, only if mode is regular>, "op_id": "<generate|draft|assemble|none, only if mode is regular>", "service_mode": "<ordinary|substituted, only if form_id is form-16>", "confidence": <0.0-1.0>, "ambiguous": <true|false>}}}}

If mode is "amend" or "new-template", omit form_id, form_name, registered, and op_id entirely.
Omit service_mode unless form_id is form-16.
If you are uncertain about any dimension, set ambiguous to true and confidence below 0.8.
If you can tell the service was made under an order but cannot tell which methods the
order ordered, that is NOT ambiguity -- the order-ingestion step reads the order. Return
form-16 with service_mode "substituted".

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def build_prompt(ctx: dict) -> str:
    return build_classify_prompt(ctx["user_request"])


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    from steps.classify.mode import validate as validate_mode
    ok, err = validate_mode(result, ctx)
    if not ok:
        return False, err
    if result["mode"] == "regular":
        from steps.classify.form import validate as validate_form
        ok, err = validate_form(result, ctx)
        if not ok:
            return False, err
        from steps.classify.operation import validate as validate_op
        ok, err = validate_op(result, ctx)
        if not ok:
            return False, err
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["mode"] = result["mode"]
    if result["mode"] == "regular":
        ctx["form_id"] = result["form_id"]
        ctx["form_name"] = result.get("form_name", "")
        ctx["form_registered"] = result.get("registered", True)
        ctx["operation"] = result["op_id"]
    return ctx
