"""asmaff.locate -- find and strictly parse the emitted affidavit-<document_id>.md.

The path is derived from the session's matter-data folder and document id, never taken from the
subagent's reply, so the reply carries no path to confine.
"""
from steps.asmaff.common import parse_affidavit, substance_path

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

def precondition(ctx):
    if not ctx.get("case_data_folder"):
        return False, "asmaff needs the matter-data folder: pass it to harness init with --matter-data-folder."
    path = substance_path(ctx["case_data_folder"], ctx["affidavit_document_id"])
    if not path.is_file():
        return False, (f"{path} not found. Emit it with drafting_forms__emit_affidavit for this "
                       "affidavit's filing (through /draft), then run asmaff again.")
    try:
        parse_affidavit(path)
    except ValueError as e:
        return False, f"{path} is not a valid emitted affidavit: {e}"
    return True, ""

def build_prompt(ctx): return '{"kind":"step_result","data":{"valid":true}}'
def validate(result, ctx): return (result.get("valid") is True, "asmaff locate not confirmed")

def apply(ctx, result):
    path = substance_path(ctx["case_data_folder"], ctx["affidavit_document_id"])
    ctx["affidavit_path"] = str(path)
    ctx["affidavit"] = parse_affidavit(path)
    return ctx
