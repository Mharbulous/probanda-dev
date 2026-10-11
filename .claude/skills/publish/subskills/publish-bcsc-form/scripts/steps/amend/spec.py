"""amend.spec -- Produce amendments spec JSON for amend.py.

Takes proposed amendments from amend.propose and produces the precise
JSON spec consumed by amend.py. Validates every find/after value
against ctx.pandoc_paragraphs using amend.py's 3-tier matching.

Disk-write step: writes spec to session dir, returns path.
max_retries = 3 (large structured output; incremental fixes expected).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

max_retries = 3

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "const": "step_result"},
        "data": {
            "type": "object",
            "properties": {
                "output_path": {"type": "string"},
            },
            "required": ["output_path"],
        },
    },
    "required": ["kind", "data"],
}


def _normalize(text: str) -> str:
    """Collapse whitespace and normalize smart quotes/dashes.

    Mirrors amend.py _normalize() for matching parity.
    """
    text = (text
            .replace('\u2018', "'").replace('\u2019', "'")
            .replace('\u201c', '"').replace('\u201d', '"')
            .replace('\u2013', '-').replace('\u2014', '-'))
    return re.sub(r'\s+', ' ', text).strip()


def _find_paragraph_match(find_text: str,
                          paragraphs: list[str]) -> tuple[bool, str]:
    """Check if find_text matches exactly one paragraph via 3-tier match.

    Returns (matched, error_msg). Uses same tiers as amend.py:
      1. Exact match
      2. Normalized match
      3. Normalized substring match
    """
    norm_find = _normalize(find_text)

    # Tier 1: exact
    exact = [p for p in paragraphs if p == find_text]
    if len(exact) == 1:
        return True, ""
    if len(exact) > 1:
        return False, (f"Ambiguous: {len(exact)} paragraphs match exactly. "
                       f"Use more specific text.")

    # Tier 2: normalized
    normed = [p for p in paragraphs if _normalize(p) == norm_find]
    if len(normed) == 1:
        return True, ""
    if len(normed) > 1:
        return False, (f"Ambiguous: {len(normed)} paragraphs match "
                       f"(normalized).")

    # Tier 3: substring
    substr = [p for p in paragraphs if norm_find in _normalize(p)]
    if len(substr) == 1:
        return True, ""
    if len(substr) > 1:
        return False, (f"Ambiguous: {len(substr)} paragraphs contain this "
                       f"as substring.")

    # No match -- find closest for reference snippet
    from difflib import get_close_matches
    close = get_close_matches(norm_find,
                              [_normalize(p) for p in paragraphs],
                              n=1, cutoff=0.4)
    hint = f" Closest match: '{close[0][:80]}...'" if close else ""
    return False, f"No paragraph matches this text.{hint}"


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("proposed_amendments"):
        return False, "Amendments must be proposed before generating spec"
    if not ctx.get("pandoc_paragraphs"):
        return False, "Pandoc paragraphs required for spec validation"
    if not ctx.get("filing_date"):
        return False, "Filing date required for spec"
    return True, ""


def build_prompt(ctx: dict) -> str:
    amendments = ctx.get("proposed_amendments", [])
    paragraphs = ctx.get("pandoc_paragraphs", [])
    filing_date = ctx.get("filing_date", "")
    session_dir = ""
    sid = ctx.get("session_id", "")
    if sid:
        from harness import SESSIONS_DIR
        session_dir = str(SESSIONS_DIR / sid)

    numbered_paras = "\n".join(
        f"{i+1}. {p}" for i, p in enumerate(paragraphs)
    )

    amendments_json = json.dumps(amendments, indent=2, ensure_ascii=False)

    output_path = f"{session_dir}/amend.spec_output.json"

    return f"""You are an amendment spec agent for a BC Supreme Court form drafting system.

Produce the precise JSON amendments spec for amend.py from the proposed amendments below.

## Filing Date
{filing_date}

## Proposed Amendments
{amendments_json}

## Source Paragraphs (from pandoc extraction)
{numbered_paras}

## Spec Format
The output must be a JSON object with this structure:
{{
  "filing_date": "{filing_date}",
  "amendments": [
    {{"type": "replace", "find": "<exact text from paragraphs above>", "replacement": "<new text>"}},
    {{"type": "delete_paragraph", "find": "<exact paragraph text from above>"}},
    {{"type": "insert_paragraph", "after": "<exact anchor text from above>", "text": "<new paragraph>"}}
  ]
}}

## CRITICAL RULES
1. Every `find` and `after` value MUST be copied character-for-character from the Source Paragraphs above.
2. Do NOT paraphrase, re-punctuate, or normalize whitespace in find/after values.
3. If a proposed amendment references a paragraph by number, use the FULL text of that paragraph as the `find` value.
4. The spec must match what amend.py expects (see types: replace, delete_paragraph, insert_paragraph).

## Instructions
1. Build the spec JSON following the format above.
2. Write it to: {output_path}
3. Return only the path.

Return:
{{"kind": "step_result", "data": {{"output_path": "{output_path}"}}}}

## Constraints
- You MUST use the Write tool to save the spec JSON to the output path above.
- Then return ONLY the JSON result object.
- Do not call Read, Bash, Grep, or Glob — only Write."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    output_path = result.get("output_path", "")
    if not output_path:
        return False, "Missing output_path"

    p = Path(output_path)
    if not p.exists():
        return False, f"Output file not found at {output_path}"

    try:
        spec = json.loads(p.read_bytes().rstrip(b"\x00").decode("utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        return False, f"Cannot read spec file: {e}"

    if not spec.get("filing_date"):
        return False, "Spec missing 'filing_date'"

    amendments = spec.get("amendments", [])
    if not amendments:
        return False, "Spec has no amendments"

    paragraphs = ctx.get("pandoc_paragraphs", [])
    errors = []

    for i, a in enumerate(amendments):
        atype = a.get("type")
        if atype not in ("replace", "delete_paragraph", "insert_paragraph"):
            errors.append(f"Amendment {i+1}: invalid type '{atype}'")
            continue

        if atype in ("replace", "delete_paragraph"):
            find_text = a.get("find", "")
            if not find_text:
                errors.append(f"Amendment {i+1} ({atype}): missing 'find'")
                continue
            ok, err = _find_paragraph_match(find_text, paragraphs)
            if not ok:
                errors.append(
                    f"Amendment {i+1} ({atype}): find text mismatch -- {err}")

        if atype == "replace" and not a.get("replacement"):
            errors.append(f"Amendment {i+1} (replace): missing 'replacement'")

        if atype == "insert_paragraph":
            after_text = a.get("after", "")
            if not after_text:
                errors.append(
                    f"Amendment {i+1} (insert_paragraph): missing 'after'")
                continue
            ok, err = _find_paragraph_match(after_text, paragraphs)
            if not ok:
                errors.append(
                    f"Amendment {i+1} (insert_paragraph): "
                    f"after text mismatch -- {err}")
            if not a.get("text"):
                errors.append(
                    f"Amendment {i+1} (insert_paragraph): missing 'text'")

    if errors:
        return False, "; ".join(errors)

    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    output_path = result.get("output_path", "")
    if output_path:
        ctx["amendments_spec_path"] = output_path
    return ctx
