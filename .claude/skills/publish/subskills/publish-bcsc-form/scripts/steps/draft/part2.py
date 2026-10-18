"""draft.part2 -- Factual basis (sourced from case data).

Fetches facts from /matter-data, injects them into the subagent prompt.
Subagent drafts paragraphs with per-paragraph pinpoint citations.
Disk-write step: writes to part-2-factual-basis.md in the draft directory.

Citation validation: every paragraph must have a non-empty citation field.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from steps.shared.paths import SUBSTANCE_WORKFLOW, case_data_output_dir

CASE_DATA_FACTS_SCRIPT = (
    Path(__file__).resolve().parents[4]  # skills/
    / "matter-data" / "references" / "scripts" / "get_facts_for_drafting.py"
)

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


def _fetch_facts(ctx: dict) -> list[dict]:
    """Fetch facts from matter-data via get_facts_for_drafting.py.

    Returns list of fact dicts with description, category, citation,
    origin_citation, evidence_count, evidence_citations, position_citations,
    and posture.
    """
    if ctx.get("facts"):
        return ctx["facts"]

    matter_path = ctx.get("matter_path", "")
    if not matter_path:
        return []

    try:
        result = subprocess.run(
            [sys.executable, str(CASE_DATA_FACTS_SCRIPT),
             "--matter-root", matter_path],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return []
        data = json.loads(result.stdout)
        return data.get("facts", [])
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        return []


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("profile_confirmed"):
        return False, "Matter profile must be confirmed before drafting Part 2"
    # Fetch facts and check for emptiness
    facts = _fetch_facts(ctx)
    if not facts and not ctx.get("facts"):
        return False, ("No facts found in the case database for this matter. "
                       "Ensure documents have been ingested via /matter-data "
                       "(extract-facts operation) before drafting Part 2.")
    return True, ""


def build_prompt(ctx: dict) -> str:
    answers = ctx.get("step_answers", [])
    facts = ctx.get("facts") or _fetch_facts(ctx)
    draft_dir = _draft_dir(ctx)

    # If lawyer has confirmed the draft, write to disk
    if answers and answers[-1] and str(answers[-1]).lower() in (
            "yes", "confirmed", "correct", "looks good", "y", "approve"):
        # The draft was confirmed -- retrieve it from ctx and write
        draft_paragraphs = ctx.get("draft_parts", {}).get("part2_pending", [])
        if draft_paragraphs:
            out_path = draft_dir / "part-2-factual-basis.md"
            lines = []
            for p in draft_paragraphs:
                lines.append(p["text"])
                lines.append(f">> {p['citation']}")
                lines.append("")
            out_path.write_text("\n".join(lines), encoding="utf-8")

            return f"""You are a draft agent for Part 2 (Factual Basis). The lawyer confirmed the draft.

Return the confirmed result:
{{"kind": "step_result", "data": {{"paragraphs": {json.dumps(draft_paragraphs)}, "output_path": "{out_path}", "confirmed": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # Format facts for injection into prompt
    facts_text = ""
    for i, fact in enumerate(facts, 1):
        desc = fact.get("description", str(fact))
        posture = fact.get("posture", "unknown")
        source = fact.get("citation") or fact.get("origin_citation") or ""
        category = fact.get("category", "")
        evidence_ct = fact.get("evidence_count", 0)
        evidence_citations = fact.get("evidence_citations") or []
        position_citations = fact.get("position_citations") or []

        posture_note = ""
        if posture == "agreed":
            posture_note = " [AGREED]"
        elif posture == "admitted":
            posture_note = " [ADMITTED]"
        elif posture == "not_denied":
            posture_note = " [NOT DENIED]"
        elif posture == "disputed":
            posture_note = " [DISPUTED]"
        elif posture == "claimed":
            posture_note = " [CLAIMED]"
        elif posture == "unclaimed":
            posture_note = " [UNCLAIMED]"

        evidence_note = f" ({evidence_ct} evidence item{'s' if evidence_ct != 1 else ''})" if evidence_ct else " (no evidence linked)"

        facts_text += f"{i}. [{category or 'general'}]{posture_note} {desc}"
        if source:
            facts_text += f"\n   > Citation: {source}"
        if evidence_citations:
            evidence_refs = [
                item.get("citation") if isinstance(item, dict) else str(item)
                for item in evidence_citations
            ]
            evidence_refs = [ref for ref in evidence_refs if ref]
            if evidence_refs:
                facts_text += "\n   > Evidence: " + "; ".join(evidence_refs)
        if position_citations:
            position_refs = []
            for item in position_citations:
                if isinstance(item, dict):
                    ref = item.get("citation")
                    position = item.get("position")
                    qualification = item.get("qualification")
                    label = " / ".join(part for part in (position, qualification) if part)
                    if ref and label:
                        position_refs.append(f"{label}: {ref}")
                    elif ref:
                        position_refs.append(ref)
                else:
                    position_refs.append(str(item))
            position_refs = [ref for ref in position_refs if ref]
            if position_refs:
                facts_text += "\n   > Positions: " + "; ".join(position_refs)
        facts_text += f"\n   {evidence_note}\n\n"

    if not facts_text:
        facts_text = "(No facts available)"

    # Check if we already have a pending draft awaiting confirmation
    pending = ctx.get("draft_parts", {}).get("part2_pending")
    if pending:
        # Present the draft for confirmation
        display = ""
        for i, p in enumerate(pending, 1):
            display += f"{i}. {p['text']}\n   > {p['citation']}\n\n"

        return f"""You are a draft agent for Part 2 (Factual Basis).

The draft has been prepared. Present it to the lawyer for confirmation.

## Draft Part 2
{display}

Return:
{{"kind": "ask_user", "question": "Here is the Part 2 (Factual Basis) draft:\\n\\n{display.replace(chr(10), chr(92) + 'n')}Does this look correct?", "options": ["Yes", "No, I need to make changes"]}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # Initial prompt: draft paragraphs from injected facts
    return f"""You are a drafting agent for Part 2 (Factual Basis) of a BC Supreme Court Notice of Application.

Draft factual paragraphs using ONLY the following facts. Do not use training knowledge or any information not provided below.

## Injected Facts
{facts_text}

## Instructions
- Draft one numbered paragraph per distinct factual allegation.
- Focus on facts that: (a) satisfy the legal test for the relief sought, (b) establish jurisdiction or standing, (c) frame the key chronological narrative.
- Prioritize DISPUTED facts -- these are the facts that must be established by evidence.
- AGREED, ADMITTED, and NOT DENIED facts may be stated briefly with their posture noted where useful.
- CLAIMED or UNCLAIMED facts need evidence support before being used as proof.
- After each paragraph, include a pinpoint citation from the Citation or Evidence line. If no citation is provided for a fact, use the fact's category and description to construct a reference like "See [category context]".
- Every paragraph MUST have a non-empty citation.

## Response Format
Return a JSON object:
{{"kind": "step_result", "data": {{"paragraphs": [
  {{"text": "The plaintiff commenced this action on...", "citation": "Statement of Claim, para. 1"}},
  {{"text": "On or about March 15, 2024...", "citation": "Affidavit of Jane Chen, Exhibit A"}}
]}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt.
- Every paragraph MUST include a non-empty "citation" field. Empty citations will be rejected."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    paragraphs = result.get("paragraphs")
    if paragraphs is None:
        return True, ""  # May be an ask_user or pending state
    if not isinstance(paragraphs, list):
        return False, "paragraphs must be a list"
    if len(paragraphs) == 0:
        return False, "Part 2 must contain at least one paragraph"
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
                           f"Every Part 2 paragraph requires a pinpoint citation.")
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    paragraphs = result.get("paragraphs")
    if paragraphs is None:
        return ctx
    draft_parts = ctx.get("draft_parts", {})
    if result.get("confirmed"):
        draft_parts["part2"] = paragraphs
        draft_parts.pop("part2_pending", None)
        if "output_path" in result:
            ctx["part2_path"] = result["output_path"]
    else:
        # Store as pending for lawyer confirmation
        draft_parts["part2_pending"] = paragraphs
        ctx["_stay_on_step"] = True
    ctx["draft_parts"] = draft_parts
    # Store paragraph count for Part 3 numbering continuity
    ctx["part2_paragraph_count"] = len(paragraphs)
    return ctx
