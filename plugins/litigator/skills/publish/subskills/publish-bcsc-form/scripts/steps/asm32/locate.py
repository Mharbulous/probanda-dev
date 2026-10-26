"""asm32.locate -- locate form-32.md. Its publish sidecar sits beside it (asm32.transform)."""
import json
from pathlib import Path
from steps.asm.locate_inputs import _draft_dir

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

def _form32_path(ctx):
    path = Path(ctx.get("form32_path", ""))
    return path if path.is_file() else _draft_dir(ctx) / "form-32.md"

def precondition(ctx):
    form32 = _form32_path(ctx)
    if not form32.exists(): return False, f"form-32.md not found in {form32.parent}"
    return True, ""

def build_prompt(ctx):
    return json.dumps({"kind":"step_result","data":{"form32_path":str(_form32_path(ctx))}})

def validate(result, ctx):
    path = Path(result.get("form32_path", ""))
    return (path.is_file(), f"form-32.md not found: {path}")

def apply(ctx, result):
    ctx["asm32_form32_path"] = result["form32_path"]; return ctx
