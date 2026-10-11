"""asm33.transform -- mechanically create fill context/body.

The caption comes from the emitter's publish sidecar beside form-33.md. A caption field it does
not hold prints as the template's own placeholder and is listed on the cover."""
import json
from pathlib import Path
from steps.asm33.common import parse_form33, transform
from steps.shared.publish_warnings import fill_missing, frontmatter_placeholders, read_sidecar

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

# context key -> (the form-33 template's placeholder, the cover's name for it, None: no emitter
# warning reports a caption field).
FIELDS = {
    "court_file_number": ("[COURT FILE NUMBER]", "Court file number", None),
    "registry": ("[REGISTRY]", "Registry", None),
    "plaintiff_caption": ("[CAPTION ORIGINATING PARTY]", "Style of proceeding, first party", None),
    "defendant_caption": ("[CAPTION RESPONDING PARTY]", "Style of proceeding, second party", None),
    "lawyer_name": ("[PERSON ACTING FULL NAME]", "Lawyer's name", None),
}

def precondition(ctx): return (ctx.get("asm33_validated") is True, "asm33.validate must run first")
def build_prompt(ctx):
    path = Path(ctx["asm33_form33_path"]); parsed = parse_form33(path)
    additions, body, advisories = transform(parsed)
    caption, warnings = read_sidecar(path.with_name("form-33-publish.json"))
    context = {**caption, **additions}
    placeholders = frontmatter_placeholders(parsed["front"])
    fill_missing(context, FIELDS, warnings, placeholders)
    context_path, body_path = path.with_name("form-33-context.json"), path.with_name("form-33-body.txt")
    context_path.write_text(json.dumps(context, indent=2), encoding="utf-8")
    body_path.write_text(body, encoding="utf-8")
    return json.dumps({"kind":"step_result","data":{"context_path":str(context_path),"body_path":str(body_path),
                                                    "warnings":advisories,"publish_warnings":warnings,
                                                    "placeholders":placeholders}})
def validate(result, ctx):
    ok = Path(result.get("context_path","")).is_file() and Path(result.get("body_path","")).is_file()
    return ok, "asm33 transform outputs missing"
def apply(ctx, result):
    ctx["asm33_context_path"], ctx["asm33_body_path"] = result["context_path"], result["body_path"]
    ctx["asm33_warnings"] = result.get("warnings", [])
    ctx["warnings"] = result.get("publish_warnings", [])
    ctx["placeholders"] = result.get("placeholders", []); return ctx
