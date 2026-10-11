"""amend.propose -- Discuss amendments with the lawyer.

Conversational sub-loop: lawyer describes changes, subagent identifies
specific text operations (replace, delete_paragraph, insert_paragraph).
Re-spawns per iteration with accumulated amendment list.

Inline return step (per-iteration payloads are small).
Iteration ceiling: 25 (supports 1-20 amendments with discussion room).
"""
from __future__ import annotations

import json

max_retries = 2

# Wide iteration ceiling for open-ended amendment discussion
MAX_ITERATIONS = 25

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["step_result", "ask_user"]},
        "data": {
            "type": "object",
            "properties": {
                "amendments": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string",
                                     "enum": ["replace", "delete_paragraph",
                                              "insert_paragraph"]},
                            "find": {"type": "string"},
                            "after": {"type": "string"},
                            "replacement": {"type": "string"},
                            "text": {"type": "string"},
                            "description": {"type": "string"},
                        },
                        "required": ["type", "description"],
                    },
                },
                "complete": {"type": "boolean"},
            },
        },
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["kind"],
}

VALID_OPS = {"replace", "delete_paragraph", "insert_paragraph"}


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("pandoc_paragraphs"):
        return False, "Pandoc paragraphs must be extracted before proposing amendments"
    if not ctx.get("filing_date"):
        return False, "Filing date must be collected before proposing amendments"
    return True, ""


def build_prompt(ctx: dict) -> str:
    paragraphs = ctx.get("pandoc_paragraphs", [])
    answers = ctx.get("step_answers", [])
    accumulated = ctx.get("proposed_amendments", [])

    numbered_paras = "\n".join(
        f"{i+1}. {p[:150]}{'...' if len(p) > 150 else ''}"
        for i, p in enumerate(paragraphs)
    )

    amendments_so_far = ""
    if accumulated:
        lines = []
        for i, a in enumerate(accumulated):
            lines.append(f"  {i+1}. [{a['type']}] {a['description']}")
        amendments_so_far = "\n".join(lines)

    # Build prior Q&A context for re-spawn
    prior_qa = ""
    if answers:
        qa_lines = []
        for i, ans in enumerate(answers):
            if ans is not None:
                qa_lines.append(f"Lawyer (turn {i+1}): {ans}")
        if qa_lines:
            prior_qa = "\n".join(qa_lines)

    # Check if lawyer said "done" / "that's all" / "confirmed"
    if answers and answers[-1]:
        last = answers[-1].strip().lower()
        done_phrases = ["done", "that's all", "no more", "confirmed",
                        "looks good", "complete", "finished", "yes"]
        if any(phrase in last for phrase in done_phrases) and accumulated:
            # Return completed amendments
            return f"""You are an amendment proposal agent.

The lawyer has confirmed all amendments are listed. Return the final amendment list.

## Accumulated Amendments
{json.dumps(accumulated, indent=2, ensure_ascii=False)}

Return:
{{"kind": "step_result", "data": {{"amendments": {json.dumps(accumulated)}, "complete": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""

    if not accumulated and not prior_qa:
        # First iteration: ask for first amendment
        return f"""You are an amendment proposal agent for a BC Supreme Court form drafting system.

The lawyer wants to amend a filed pleading per Rule 6-1. The original document has been extracted. Help the lawyer identify specific text changes.

## Paragraphs from Original Document
{numbered_paras}

## Amendment Operations
| Operation | Use when |
|-----------|----------|
| `replace` | Word-level changes within a paragraph |
| `delete_paragraph` | Entire paragraph struck out |
| `insert_paragraph` | New paragraph inserted after a specified anchor |

Ask the lawyer to describe the first amendment they want to make.

Return:
{{"kind": "ask_user", "question": "Please describe the first amendment you want to make. Reference paragraph numbers from the list above. I will identify the specific text operation (replace, delete, or insert).", "options": []}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""

    # Subsequent iterations: process latest answer and ask for next
    return f"""You are an amendment proposal agent for a BC Supreme Court form drafting system.

Process the lawyer's latest input and either add it to the amendment list or ask for clarification.

## Paragraphs from Original Document
{numbered_paras}

## Amendments Accumulated So Far
{amendments_so_far if amendments_so_far else "(none yet)"}

## Prior Conversation
{prior_qa if prior_qa else "(first turn)"}

## Amendment Operations
| Operation | Use when |
|-----------|----------|
| `replace` | Word-level changes within a paragraph. Requires `find` (exact text from paragraphs above) and `replacement` (new text). |
| `delete_paragraph` | Entire paragraph struck out. Requires `find` (exact paragraph text). |
| `insert_paragraph` | New paragraph inserted after a specified anchor. Requires `after` (exact anchor text) and `text` (new paragraph content). |

## Instructions
1. Based on the lawyer's latest input, identify the amendment operation type.
2. For `find` and `after` values, use EXACT text from the paragraph list above. Do not paraphrase.
3. Present your understanding of the amendment and ask if it is correct, plus whether there are more amendments.
4. If the lawyer confirms and has more, ask for the next amendment.
5. If the lawyer says they are done, set complete to true and return all accumulated amendments.

**Critical:** `find` and `after` values must be copied from the paragraph text above, not guessed or recalled.

If you need clarification on the lawyer's intent, return an ask_user with your question.
If you understood the amendment, present it for confirmation and ask about next steps.

Return one of:
- {{"kind": "ask_user", "question": "<your question or summary + next prompt>", "options": []}}
- {{"kind": "step_result", "data": {{"amendments": [<all amendments>], "complete": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if result.get("complete"):
        amendments = result.get("amendments", [])
        if not amendments:
            return False, "Completed result must include at least one amendment"
        for i, a in enumerate(amendments):
            if a.get("type") not in VALID_OPS:
                return False, (f"Amendment {i+1}: invalid type '{a.get('type')}'. "
                               f"Must be one of: {VALID_OPS}")
            if a["type"] == "replace":
                if not a.get("find"):
                    return False, f"Amendment {i+1} (replace): missing 'find'"
                if not a.get("replacement"):
                    return False, f"Amendment {i+1} (replace): missing 'replacement'"
            elif a["type"] == "delete_paragraph":
                if not a.get("find"):
                    return False, f"Amendment {i+1} (delete_paragraph): missing 'find'"
            elif a["type"] == "insert_paragraph":
                if not a.get("after"):
                    return False, f"Amendment {i+1} (insert_paragraph): missing 'after'"
                if not a.get("text"):
                    return False, f"Amendment {i+1} (insert_paragraph): missing 'text'"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    if result.get("complete"):
        ctx["proposed_amendments"] = result["amendments"]
    else:
        # Mid-iteration: accumulate any amendments the subagent identified
        # (the harness handles the ask_user routing)
        if result.get("amendments"):
            ctx["proposed_amendments"] = result["amendments"]
    return ctx
