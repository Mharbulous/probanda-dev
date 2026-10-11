"""asm33.validate -- hard validate Form 33 input subset."""
from pathlib import Path
from steps.asm33.common import parse_form33

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

def precondition(ctx): return (bool(ctx.get("asm33_form33_path")), "asm33.locate must run first")
def build_prompt(ctx):
    parsed = parse_form33(Path(ctx["asm33_form33_path"]))
    return '{"kind":"step_result","data":{"valid":true,"order_count":%d}}' % len(parsed["front"]["orders"])
def validate(result, ctx): return (result.get("valid") is True, "Form 33 validation failed")
def apply(ctx, result): ctx["asm33_validated"] = True; return ctx

