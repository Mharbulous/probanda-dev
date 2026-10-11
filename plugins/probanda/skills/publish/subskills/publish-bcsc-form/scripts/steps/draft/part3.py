"""draft.part3 -- Legal basis (sourced from 6. LAW/ folder).

Fetches legal authority from the matter's 6. LAW/ directory, injects
file contents into the subagent prompt. If the folder is empty, switches
to a warn template. Paragraph numbering continues from Part 2.

Disk-write step: writes to part-3-legal-basis.md.
"""
from __future__ import annotations

import json
from pathlib import Path

from steps.shared.paths import SUBSTANCE_WORKFLOW, case_data_output_dir

max_retries = 3  # Large structured output; citation fixes are incremental

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["step_result", "ask_user"]},
        "data": {
            "type": "object",
            "properties": {
                "paragraphs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "citation": {"type": "string"},
                        },
                        "required": ["text", "citation"],
                    },
                },
                "output_path": {"type": "string"},
                "confirmed": {"type": "boolean"},
                "warning": {"type": "string"},
            },
        },
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["kind"],
}


def _draft_dir(ctx: dict) -> Path:
    matter_path = ctx.get("matter_path", "")
    if not matter_path:
        raise RuntimeError(
            "matter_path is not set — publish-bcsc-form writes into a client "
            "matter and cannot run without one.")
    return case_data_output_dir(
        matter_path, ctx.get("case_data_folder", ""), SUBSTANCE_WORKFLOW)


def _fetch_law_folder(ctx: dict) -> dict[str, str]:
    """Read all files from the matter's 6. LAW/ directory.

    Returns a dict of {filename: content} for each file in the folder.
    Returns empty dict if the folder is empty or missing.
    """
    matter_path = ctx.get("matter_path", "")
    if not matter_path:
        return {}
    law_dir = Path(matter_path) / "6. LAW"
    if not law_dir.exists() or not law_dir.is_dir():
        return {}
    documents = {}
    for f in sorted(law_dir.iterdir()):
        if f.is_file() and not f.name.startswith("."):
            try:
                documents[f.name] = f.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                documents[f.name] = f"(Could not read file: {f.name})"
    return documents


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("profile_confirmed"):
        return False, "Matter profile must be confirmed before drafting Part 3"
    # Part 3 does NOT hard-halt on empty law folder -- it switches to warn mode
    return True, ""


def build_prompt(ctx: dict) -> str:
    answers = ctx.get("step_answers", [])
    law_docs = _fetch_law_folder(ctx)
    draft_dir = _draft_dir(ctx)
    starting_para = ctx.get("part2_paragraph_count", 0) + 1

    # If lawyer has confirmed the draft, write to disk
    if answers and answers[-1] and str(answers[-1]).lower() in (
            "yes", "confirmed", "correct", "looks good", "y", "approve"):
        draft_paragraphs = ctx.get("draft_parts", {}).get("part3_pending", [])
        if draft_paragraphs:
            out_path = draft_dir / "part-3-legal-basis.md"
            lines = []
            for p in draft_paragraphs:
                lines.append(f"{p['text']} See: {p['citation']}")
                lines.append("")
            out_path.write_text("\n".join(lines), encoding="utf-8")

            return f"""You are a draft agent for Part 3 (Legal Basis). The lawyer confirmed the draft.

Return the confirmed result:
{{"kind": "step_result", "data": {{"paragraphs": {json.dumps(draft_paragraphs)}, "output_path": "{out_path}", "confirmed": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # WARN TEMPLATE: empty law folder
    if not law_docs:
        out_path = draft_dir / "part-3-legal-basis.md"
        out_path.write_text(
            "(Part 3 placeholder -- 6. LAW/ folder is empty. "
            "Add legal authority documents and re-run Draft.)\n",
            encoding="utf-8",
        )
        return f"""You are a draft agent for Part 3 (Legal Basis) of a BC Supreme Court form.

The matter's 6. LAW/ folder is empty or missing. Legal authority documents must be placed in that folder before Part 3 can be drafted. Do NOT draft legal argument from training knowledge.

A placeholder file has been written to: {out_path}

Warn the lawyer:
{{"kind": "step_result", "data": {{"paragraphs": [], "output_path": "{out_path}", "warning": "The 6. LAW/ folder is empty. Part 3 has been left as a placeholder. Please add your legal authority documents to the 6. LAW/ folder and re-run Draft substance."}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # Check if we have a pending draft awaiting confirmation
    pending = ctx.get("draft_parts", {}).get("part3_pending")
    if pending:
        display = ""
        for i, p in enumerate(pending, starting_para):
            display += f"{i}. {p['text']} See: {p['citation']}\n\n"

        return f"""You are a draft agent for Part 3 (Legal Basis).

The draft has been prepared. Present it to the lawyer for confirmation.

## Draft Part 3
{display}

Return:
{{"kind": "ask_user", "question": "Here is the Part 3 (Legal Basis) draft:\\n\\n{display.replace(chr(10), chr(92) + 'n')}Does this look correct?", "options": ["Yes", "No, I need to make changes"]}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # DRAFT TEMPLATE: inject law folder contents
    law_text = ""
    for filename, content in law_docs.items():
        law_text += f"\n### {filename}\n{content}\n"

    return f"""You are a drafting agent for Part 3 (Legal Basis) of a BC Supreme Court Notice of Application.

Draft legal basis paragraphs using ONLY the authority documents provided below. Do not use training knowledge. All legal authority must be sourced exclusively from these documents.

**Paragraph numbering starts at {starting_para}** (continuing from Part 2).

## Injected Legal Authority (from 6. LAW/ folder)
{law_text}

## Structure (three sequential blocks)

### Block A -- Sources of authority
Draft a single paragraph identifying the primary authority for the order sought (rule or statute). Follow with one paragraph per alternative source. These are citation-only paragraphs. Each must end with a pinpoint citation.

### Block B -- Legal tests
For each source from Block A, draft one paragraph stating the applicable legal test. Open with an introductory sentence naming the authority, followed by a direct quote stating the test. Each must end with a pinpoint citation.

### Block C -- Similar fact cases
Draft paragraphs discussing cases that applied the legal tests from Block B in factually analogous circumstances. Draw explicit analogies to the facts in Part 2. Each must end with a pinpoint citation.

## Response Format
Return a JSON object:
{{"kind": "step_result", "data": {{"paragraphs": [
  {{"text": "The Court's jurisdiction to grant the order sought...", "citation": "Supreme Court Civil Rules, Rule 8-1(1)"}},
  {{"text": "The test for granting interlocutory relief...", "citation": "Smith v Jones, 2023 BCSC 456 at para 23"}}
]}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt.
- Every paragraph MUST include a non-empty "citation" field. Empty citations will be rejected.
- Do NOT use training knowledge for legal authority. All citations must reference the documents above."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    # Allow warning-only results (empty law folder)
    if result.get("warning") and not result.get("paragraphs"):
        return True, ""
    paragraphs = result.get("paragraphs")
    if paragraphs is None:
        return True, ""  # ask_user or pending state
    if not isinstance(paragraphs, list):
        return False, "paragraphs must be a list"
    # Empty paragraphs OK only when warning is present
    if len(paragraphs) == 0 and not result.get("warning"):
        return False, "Part 3 must contain at least one paragraph (or a warning)"
    # Citation validation (design doc compliance table #13)
    for i, p in enumerate(paragraphs):
        if not isinstance(p, dict):
            return False, f"Paragraph {i} must be an object with 'text' and 'citation'"
        if "text" not in p:
            return False, f"Paragraph {i} missing 'text' field"
        if "citation" not in p:
            return False, f"Paragraph {i} missing 'citation' field"
        if not p["citation"].strip():
            return False, (f"Paragraph {i} has empty citation. "
                           f"Text: '{p['text'][:80]}...' "
                           f"Every Part 3 paragraph requires a pinpoint citation.")
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    paragraphs = result.get("paragraphs")
    draft_parts = ctx.get("draft_parts", {})
    if result.get("warning"):
        draft_parts["part3"] = []
        draft_parts["part3_warning"] = result["warning"]
        if "output_path" in result:
            ctx["part3_path"] = result["output_path"]
    elif paragraphs is not None:
        if result.get("confirmed"):
            draft_parts["part3"] = paragraphs
            draft_parts.pop("part3_pending", None)
            if "output_path" in result:
                ctx["part3_path"] = result["output_path"]
        else:
            draft_parts["part3_pending"] = paragraphs
            ctx["_stay_on_step"] = True
    ctx["draft_parts"] = draft_parts
    return ctx
