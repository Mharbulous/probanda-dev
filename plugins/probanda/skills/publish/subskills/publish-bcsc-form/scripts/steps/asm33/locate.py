"""asm33.locate -- locate form-33.md. Its publish sidecar sits beside it (asm33.transform)."""
from pathlib import Path
from steps.asm.locate_inputs import _draft_dir

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

def precondition(ctx):
    root = Path(ctx.get("form33_path", ""))
    if root.is_file(): return True, ""
    draft = _draft_dir(ctx)
    return ((draft / "form-33.md").exists(), f"form-33.md not found in {draft}")

def build_prompt(ctx):
    path = Path(ctx.get("form33_path", ""))
    if not path.is_file(): path = _draft_dir(ctx) / "form-33.md"
    return '{"kind":"step_result","data":{"form33_path":' + repr(str(path)).replace("'", '"') + '}}'

def validate(result, ctx):
    path = Path(result.get("form33_path", "")); return (path.is_file(), f"form-33.md not found: {path}")

def apply(ctx, result): ctx["asm33_form33_path"] = result["form33_path"]; return ctx

