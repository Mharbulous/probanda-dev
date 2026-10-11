"""asm32.validate -- hard validate the Form 32 markdown subset (BTA § 14)."""
from pathlib import Path
from steps.asm32.common import parse_form32

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

def precondition(ctx): return (bool(ctx.get("asm32_form32_path")), "asm32.locate must run first")
def build_prompt(ctx):
    parsed = parse_form32(Path(ctx["asm32_form32_path"]))
    return '{"kind":"step_result","data":{"valid":true,"order_count":%d}}' % len(parsed["front"]["orders"])
def validate(result, ctx): return (result.get("valid") is True, "Form 32 validation failed")
def apply(ctx, result): ctx["asm32_validated"] = True; return ctx
