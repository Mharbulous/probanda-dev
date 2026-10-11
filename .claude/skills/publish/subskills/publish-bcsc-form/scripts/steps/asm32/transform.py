"""asm32.transform -- mechanically create the fill context/body for Form 32.

The caption comes from the emitter's publish sidecar beside form-32.md, never from a Generate run.
A field the fill needs that neither the sidecar nor the frontmatter holds prints as the template's
own placeholder and is listed on the cover (steps/shared/publish_warnings.py).
"""
import json
from pathlib import Path
from steps.asm32.common import parse_form32, transform
from steps.shared.publish_warnings import fill_missing, frontmatter_placeholders, read_sidecar

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

# context key -> (the noa template's placeholder, the cover's name for it, the emitter warning that
# already reports it). The time estimate's hours and minutes come from the frontmatter's time_estimate.
FIELDS = {
    "court_file_number": ("[COURT FILE NUMBER]", "Court file number", None),
    "registry": ("[REGISTRY]", "Registry", None),
    "plaintiff_caption": ("[PLAINTIFF / PETITIONER NAME(S)]", "Style of proceeding, first party", None),
    "plaintiff_role": ("[PLAINTIFF]", "Style of proceeding, first party's role", None),
    "defendant_caption": ("[DEFENDANT / RESPONDENT NAME(S)]", "Style of proceeding, second party", None),
    "defendant_role": ("[DEFENDANT]", "Style of proceeding, second party's role", None),
    "lawyer_name": ("[LAWYER NAME]", "Lawyer's name", None),
    "applicant_names": ("[APPLICANT NAME(S)]", "Name of applicant", None),
    "to_affected_parties": ("[TO AFFECTED PARTIES]", "Parties to be served", None),
    "proposed_hearing": ("[proposed hearing]", "Proposed hearing", "proposed_hearing"),
    "duration_hours": ("[hour(s)]", "Time estimate, hours", "time_estimate"),
    "duration_minutes": ("[minute(s)]", "Time estimate, minutes", "time_estimate"),
}

def precondition(ctx): return (ctx.get("asm32_validated") is True, "asm32.validate must run first")

def build_prompt(ctx):
    path = Path(ctx["asm32_form32_path"]); parsed = parse_form32(path)
    caption, warnings = read_sidecar(path.with_name("form-32-publish.json"))
    additions, body, advisories = transform(parsed, caption)
    context = {**caption, **additions}
    placeholders = frontmatter_placeholders(parsed["front"])
    fill_missing(context, FIELDS, warnings, placeholders)
    # fill_plain requires the party-role contract key; the sidecar sets it once the emitter's party
    # drift gate has passed, and without a sidecar no party name is printed at all.
    context.setdefault("correction_required", [])
    context_path = path.with_name("form-32-context.json")
    body_path = path.with_name("form-32-body.txt")
    context_path.write_text(json.dumps(context, indent=2), encoding="utf-8")
    body_path.write_text(body, encoding="utf-8")
    return json.dumps({"kind":"step_result","data":{"context_path":str(context_path),"body_path":str(body_path),
                                                    "warnings":advisories,"publish_warnings":warnings,
                                                    "placeholders":placeholders}})

def validate(result, ctx):
    ok = Path(result.get("context_path","")).is_file() and Path(result.get("body_path","")).is_file()
    return ok, "asm32 transform outputs missing"

def apply(ctx, result):
    ctx["asm32_context_path"], ctx["asm32_body_path"] = result["context_path"], result["body_path"]
    ctx["asm32_warnings"] = result.get("warnings", [])
    ctx["warnings"] = result.get("publish_warnings", [])
    ctx["placeholders"] = result.get("placeholders", []); return ctx
