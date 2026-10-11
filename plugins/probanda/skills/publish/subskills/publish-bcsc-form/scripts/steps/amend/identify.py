"""amend.identify -- Identify original document for amendment.

Extracts text via pandoc, splits into paragraphs, presents summary
for lawyer confirmation. Collects filing date and amendment type.

Disk-write step: subagent writes output to session dir, returns path.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent.parent  # scripts/

max_retries = 2

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["step_result", "ask_user"]},
        "data": {
            "type": "object",
            "properties": {
                "output_path": {"type": "string"},
            },
        },
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["kind"],
}


def _fetch_pandoc_output(docx_path: str) -> str | None:
    """Run pandoc -f docx -t plain on a filed pleading."""
    try:
        result = subprocess.run(
            ["pandoc", "-f", "docx", docx_path, "-t", "plain"],
            capture_output=True, text=True, encoding="utf-8", timeout=30,
        )
        if result.returncode != 0:
            return None
        return result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def _split_paragraphs(text: str) -> list[str]:
    """Split pandoc plain text into non-empty paragraphs."""
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def precondition(ctx: dict) -> tuple[bool, str]:
    # The user request must reference a .docx file path.
    # The harness extracts this during classification or the subagent
    # asks for it via ask_user.
    return True, ""


def build_prompt(ctx: dict) -> str:
    """Build the identify step prompt.

    Sub-loop states:
    1. No pandoc output yet -> ask for the .docx path (or extract from user_request)
    2. Pandoc output available, no confirmation -> present paragraphs for confirmation
    3. Paragraphs confirmed, no filing date -> ask for filing date
    4. Filing date provided, no amendment type -> ask for amendment type
    5. All collected -> return final result
    """
    answers = ctx.get("step_answers", [])
    session_dir = ""
    sid = ctx.get("session_id", "")
    if sid:
        from harness import SESSIONS_DIR
        session_dir = str(SESSIONS_DIR / sid)

    pandoc_text = ctx.get("pandoc_text")
    pandoc_paragraphs = ctx.get("pandoc_paragraphs")
    original_path = ctx.get("original_docx_path")
    filing_date = ctx.get("filing_date")
    amendment_type = ctx.get("amendment_type")

    # State 1: Need the .docx path
    if not original_path and not pandoc_text:
        # Try to extract path from user request
        user_req = ctx.get("user_request", "")
        # Check if answers contain a path
        if answers and answers[-1] and answers[-1].strip():
            candidate = answers[-1].strip().strip('"').strip("'")
            if candidate.endswith(".docx"):
                # Try to fetch pandoc output
                text = _fetch_pandoc_output(candidate)
                if text:
                    ctx["original_docx_path"] = candidate
                    ctx["pandoc_text"] = text
                    ctx["pandoc_paragraphs"] = _split_paragraphs(text)
                    # Fall through to state 2
                    pandoc_text = text
                    pandoc_paragraphs = ctx["pandoc_paragraphs"]
                    original_path = candidate
                else:
                    return f"""You are an amendment identification agent.

The path provided could not be read: "{candidate}"

Ask the user for the correct path to the filed pleading (.docx).

Return:
{{"kind": "ask_user", "question": "I could not read the file at '{candidate}'. Please provide the correct path to the filed pleading (.docx).", "options": []}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""

        if not pandoc_text:
            # Check if user_request contains a .docx path
            import re
            docx_match = re.search(r'["\']?([^"\']+\.docx)["\']?', user_req)
            if docx_match:
                candidate = docx_match.group(1)
                text = _fetch_pandoc_output(candidate)
                if text:
                    ctx["original_docx_path"] = candidate
                    ctx["pandoc_text"] = text
                    ctx["pandoc_paragraphs"] = _split_paragraphs(text)
                    pandoc_text = text
                    pandoc_paragraphs = ctx["pandoc_paragraphs"]
                    original_path = candidate

        if not pandoc_text:
            return """You are an amendment identification agent for a BC Supreme Court form drafting system.

The user wants to amend a previously filed pleading per Rule 6-1. You need the path to the original filed document (.docx).

Return:
{"kind": "ask_user", "question": "Please provide the path to the filed pleading (.docx) that you want to amend.", "options": []}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""

    # State 2: Have pandoc output, need confirmation
    if pandoc_paragraphs and not ctx.get("paragraphs_confirmed"):
        # Check if last answer was confirmation
        if answers and answers[-1] and answers[-1].lower() in (
                "yes", "confirmed", "correct", "looks good", "y"):
            ctx["paragraphs_confirmed"] = True
        else:
            numbered = "\n".join(
                f"{i+1}. {p[:120]}{'...' if len(p) > 120 else ''}"
                for i, p in enumerate(pandoc_paragraphs)
            )
            return f"""You are an amendment identification agent.

Present the following numbered paragraph summary to the lawyer for confirmation.

## Extracted Paragraphs
{numbered}

## Original Document
{original_path}

Ask the lawyer to confirm these paragraphs are correct.

Return:
{{"kind": "ask_user", "question": "I extracted {len(pandoc_paragraphs)} paragraphs from the filed pleading:\\n\\n{numbered}\\n\\nIs this correct?", "options": ["Yes", "No, there are issues"]}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""

    # State 3: Paragraphs confirmed, need filing date
    if not filing_date:
        if answers and answers[-1] and not ctx.get("paragraphs_confirmed") is False:
            # Check if latest answer is a date (not a yes/no)
            last = answers[-1].strip()
            if last.lower() not in ("yes", "no", "confirmed", "correct",
                                     "looks good", "y", "n"):
                ctx["filing_date"] = last
                filing_date = last

        if not filing_date:
            return f"""You are an amendment identification agent.

The paragraphs have been confirmed. Now collect the filing date of the original pleading.
This is mandatory per Rule 6-1(2)(b) -- the amended pleading must state the date it was originally filed.

Return:
{{"kind": "ask_user", "question": "What is the filing date of the original pleading? (mandatory per Rule 6-1(2)(b) -- e.g., 'March 15, 2025')", "options": []}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""

    # State 4: Have filing date, need amendment type
    if not amendment_type:
        if answers and answers[-1]:
            last = answers[-1].strip().lower()
            if "pre" in last or "6-1(1)(a)" in last or "before" in last:
                ctx["amendment_type"] = "pre-trial"
                amendment_type = "pre-trial"
            elif "post" in last or "6-1(1)(b)" in last or "after" in last or "leave" in last:
                ctx["amendment_type"] = "post-trial-notice"
                amendment_type = "post-trial-notice"

        if not amendment_type:
            return f"""You are an amendment identification agent.

Collect the amendment type. Rule 6-1 distinguishes:
- **pre-trial** (Rule 6-1(1)(a)): No leave needed. Can amend any time before trial date set.
- **post-trial-notice** (Rule 6-1(1)(b)): Needs leave of court or consent of all parties.

Return:
{{"kind": "ask_user", "question": "What type of amendment is this?", "options": ["Pre-trial (Rule 6-1(1)(a)) -- no leave needed", "Post-trial-notice (Rule 6-1(1)(b)) -- needs leave or consent"]}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""

    # State 5: All collected -- write output to disk directly and return path
    output = {
        "original_path": original_path,
        "filing_date": filing_date,
        "amendment_type": amendment_type,
        "paragraph_count": len(pandoc_paragraphs),
        "paragraphs": pandoc_paragraphs,
    }
    output_json = json.dumps(output, indent=2, ensure_ascii=False)
    out_file = Path(session_dir) / "amend.identify_output.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(output_json, encoding="utf-8")

    return f"""You are an amendment identification agent.

All information has been collected and saved to disk.

Return:
{{"kind": "step_result", "data": {{"output_path": "{out_file}"}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    # For disk-write steps, check the file exists
    output_path = result.get("output_path")
    if output_path:
        p = Path(output_path)
        if not p.exists():
            return False, f"Output file not found at {output_path}"
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            return False, f"Cannot read output file: {e}"
        if "paragraphs" not in data:
            return False, "Output missing 'paragraphs' key"
        if "filing_date" not in data or not data["filing_date"]:
            return False, "Output missing 'filing_date'"
        if "original_path" not in data or not data["original_path"]:
            return False, "Output missing 'original_path'"
        return True, ""
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    output_path = result.get("output_path")
    if output_path:
        data = json.loads(Path(output_path).read_text(encoding="utf-8"))
        ctx["pandoc_paragraphs"] = data["paragraphs"]
        ctx["pandoc_text"] = "\n\n".join(data["paragraphs"])
        ctx["original_docx_path"] = data["original_path"]
        ctx["filing_date"] = data["filing_date"]
        ctx["amendment_type"] = data.get("amendment_type", "pre-trial")
    return ctx
