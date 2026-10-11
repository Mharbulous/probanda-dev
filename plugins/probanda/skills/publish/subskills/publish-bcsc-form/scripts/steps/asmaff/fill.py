"""asmaff.fill -- fill affidavit.dotx from the parsed emitted file and the collected scalars.

The deponent and the ordinal come from the emitted file, not from gen.scalars, so the affidavit
number is asked once (by /draft's recipe) and has one source.
"""
import re
import sys
from pathlib import Path

from steps.asmaff.common import ordinal
from steps.shared.paths import write_deliverables

SCRIPTS = Path(__file__).resolve().parents[2]  # scripts/

max_retries = 0  # computed: a retry would compute the same result
def computed(ctx): return True
response_schema = {"type":"object","properties":{"kind":{"const":"step_result"},"data":{"type":"object"}},"required":["kind","data"]}

def precondition(ctx):
    if not ctx.get("affidavit"): return False, "asmaff.locate must run first"
    return (bool(ctx.get("scalars")), "Scalars must be collected before fill")
def build_prompt(ctx): return '{"kind":"step_result","data":{"ready":true}}'
def validate(result, ctx): return (result.get("ready") is True, "asmaff fill not ready")
def apply(ctx, result): return ctx

def calls_script(ctx):
    from harness import REGISTRY, SKILL_ROOT
    affidavit = ctx["affidavit"]
    context = dict(ctx["scalars"], deponent_name=affidavit["deponent"],
                   affidavit_ordinal=ordinal(affidavit["affidavit_number"]),
                   affidavit_paragraphs=affidavit["paragraphs"])
    sys.path.insert(0, str(SCRIPTS))
    from fill_plain import fill
    title = f"Affidavit #{affidavit['affidavit_number']} of {affidavit['deponent']}"
    if not ctx.get("out_name") and re.search(r'[\\/:*?"<>|]', title):
        raise RuntimeError(f"The deponent's name cannot be used in a file name: {affidavit['deponent']!r}. "
                           "Pass --out-name with the affidavit's /file-naming stem to harness init instead.")
    [(out_path, prior)] = write_deliverables(
        ctx, title, lambda paths: fill(
            SKILL_ROOT / REGISTRY["affidavit"]["template"], context, "", paths[0], form="affidavit"))
    if not out_path.exists():
        raise RuntimeError(f"fill produced no output: {out_path}")
    ctx["output_path"] = str(out_path)
    ctx["versioned_from"] = str(prior) if prior else None
