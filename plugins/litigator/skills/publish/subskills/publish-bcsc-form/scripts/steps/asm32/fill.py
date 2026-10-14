"""asm32.fill -- fill the Form 32 (noa) template from transformed inputs, then put the NOT FINAL
cover page in front of it while any warning stands."""
import json
from pathlib import Path
from steps.asm.fill import calls_script as _asm_fill
from steps.shared.publish_warnings import residual_warnings

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

def precondition(ctx):
    ok = Path(ctx.get("asm32_context_path","")).is_file() and Path(ctx.get("asm32_body_path","")).is_file()
    return ok, "asm32.transform must run first"
def build_prompt(ctx): return '{"kind":"step_result","data":{"ready":true}}'
def validate(result, ctx): return (result.get("ready") is True, "asm32 fill not ready")
def apply(ctx, result): return ctx
def calls_script(ctx):
    ctx["form_id"] = "form-32"
    ctx["asm_context_path"] = ctx["asm32_context_path"]
    ctx["asm_body_path"] = ctx["asm32_body_path"]
    # An asm32 session carries no Generate scalars; name the .docx from the caption's title.
    title = json.loads(Path(ctx["asm32_context_path"]).read_bytes().rstrip(b"\x00").decode("utf-8")).get("title")
    ctx["scalars"] = ctx.get("scalars") or ({"title": title} if title else {})
    _asm_fill(ctx)
    out = Path(ctx["output_path"])
    # The cover lists every unfilled placeholder too, so the scan runs before it is added.
    warnings = ctx.get("warnings", [])
    warnings += residual_warnings(out, Path(ctx["asm32_body_path"]), warnings, ctx.get("placeholders", []))
    ctx["warnings"] = warnings
    from fill_cover import add_cover
    ctx["cover"] = add_cover(out, warnings)
    # Assemble-for-verification: render the assembled DOCX, report the true
    # page count (Rule 8-1(4)), the cover included when there is one, and
    # extract the tail for a truthful G6 preview.
    from steps.shared.render import render_to_pdf, extract_form32_tail
    pdf_path, page_count = render_to_pdf(out)
    ctx["pdf_path"] = str(pdf_path)
    ctx["page_count"] = page_count
    ctx["tail_text"] = extract_form32_tail(out)
