"""gen.matter_profile -- Fetch and confirm matter profile.

Fetches the matter profile from /matter-data, checks for gaps,
presents to lawyer for confirmation via ask_user sub-loop.
The subagent formats the profile and returns it. The harness
then emits ask_user so the lawyer confirms.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from steps.shared.firm import config_path, firm_context_fields

# The two forms whose templates carry the address-for-service block.
FIRM_FORMS = ("form-1", "form-4")

max_retries = 2

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["step_result", "ask_user"]},
        "data": {
            "type": "object",
            "properties": {
                "profile_summary": {"type": "string"},
                "context_fields": {"type": "object"},
                "confirmed": {"type": "boolean"},
                "profile": {"type": "object"},
            },
        },
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["kind"],
}

def _resolve_full_lawyer_name(short_name: str, parties: list[dict]) -> str:
    if not short_name or ' ' in short_name:
        return short_name
    for p in parties:
        lawyer = p.get('lawyer_name', '')
        if lawyer and lawyer.split()[0] == short_name:
            return lawyer
    return short_name


def _caption_fields_from_role_groups(proceeding: dict) -> dict:
    """Map the validated /matter-data role groups onto the template blocks."""
    if (
        "valid_role_groups" not in proceeding
        or "correction_required" not in proceeding
    ):
        raise RuntimeError(
            "Validated party-role profile is unavailable; run /matter-data "
            "proceedings-profile before rendering."
        )
    if proceeding["correction_required"]:
        raise RuntimeError(
            "Party-role correction required; run /matter-data "
            "proceedings-profile before rendering."
        )

    groups = proceeding["valid_role_groups"]

    def caption(group: dict) -> str:
        return "\n".join(
            party["name"].upper()
            for party in group.get("parties", [])
        )

    def is_counterclaim(group: dict) -> bool:
        return "counterclaim" in (
            f"{group.get('role', '')} {group.get('role_label', '')}".casefold()
        )

    def role_label(group: dict) -> str:
        if is_counterclaim(group):
            plural = len(group.get("parties", [])) != 1
            return (
                "Defendants by way of counterclaim"
                if plural
                else "Defendant by way of counterclaim"
            )
        label = " ".join(str(group.get("role_label", "")).split())
        return label[:1].upper() + label[1:].lower()

    def party_key(party: dict) -> tuple[str, object]:
        party_id = party.get("party_id")
        if party_id is not None:
            return "id", party_id
        return "name", " ".join(str(party.get("name", "")).casefold().split())

    rendered_groups = groups[:2]
    represented = {
        party_key(party)
        for group in rendered_groups
        for party in group.get("parties", [])
    }
    additional_groups = []
    for group in groups[2:]:
        if is_counterclaim(group):
            parties = group.get("parties", [])
            new_parties = [
                party for party in parties if party_key(party) not in represented
            ]
            if len(new_parties) != len(parties):
                print(
                    "WARNING: removed already-captioned parties from a "
                    "counterclaim caption group; Rule 3-4(3) preserves their "
                    "existing plaintiff/defendant identification.",
                    file=sys.stderr,
                )
            if parties and not new_parties:
                continue
            group = {**group, "parties": new_parties}
        group_keys = {party_key(party) for party in group.get("parties", [])}
        additional_groups.append(group)
        represented.update(group_keys)

    first = groups[0] if groups else {}
    second = groups[1] if len(groups) > 1 else {}
    return {
        "plaintiff_caption": caption(first),
        "plaintiff_role": role_label(first),
        "defendant_caption": caption(second),
        "defendant_role": role_label(second),
        "additional_captions": [
            {
                "caption": caption(group),
                "role_label": role_label(group),
            }
            for group in additional_groups
        ],
        "correction_required": [],
    }


def _role_integrity_problem(profile: dict) -> str | None:
    proceedings = profile.get("proceedings", [])
    if not proceedings:
        return (
            "The validated party-role profile is unavailable. Run "
            "/matter-data profile, then try again."
        )
    for proceeding in proceedings:
        if (
            "valid_role_groups" not in proceeding
            or "correction_required" not in proceeding
        ):
            return (
                "The validated party-role profile is unavailable. Run "
                "/matter-data proceedings-profile, then try again."
            )
        if proceeding["correction_required"]:
            return (
                "Party-role correction required. Run /matter-data "
                "proceedings-profile's confirmed correction path, then try again."
            )
    return None


def _parties_for_display(proceeding: dict) -> list[dict]:
    if proceeding.get("parties"):
        return proceeding["parties"]
    return [
        {**party, "role": group["role"]}
        for group in proceeding.get("valid_role_groups", [])
        for party in group.get("parties", [])
    ]


def precondition(ctx: dict) -> tuple[bool, str]:
    return True, ""


def build_prompt(ctx: dict) -> str:
    """Build the matter profile step prompt.

    If profile is not yet fetched, the harness fetches it first and
    stores in ctx.profile. If step_answers contains a confirmation,
    we include it.
    """
    # Extract matter_path from step_answers if not yet set
    if not ctx.get("matter_path"):
        answers = ctx.get("step_answers", [])
        for ans in answers:
            if ans and isinstance(ans, str) and ans.strip().lower() not in (
                "yes", "y", "confirmed", "correct", "looks good",
                "no", "n", "no, i need to make corrections",
            ):
                candidate = ans.strip()
                if Path(candidate).is_dir():
                    ctx["matter_path"] = candidate
                    break

    profile = ctx.get("profile")
    if not profile:
        if ctx.get("matter_path"):
            matter_path = json.dumps(ctx["matter_path"])
            return f"""You are a matter profile retrieval agent for a BC Supreme Court form drafting system.

Invoke `/matter-data`'s `profile` operation for this matter folder:
{matter_path}

That operation must delegate proceedings completeness to `proceedings-profile`. Use the delegated operation's returned `valid_role_groups` in its returned canonical order and with its returned count-aware `role_label` values. Preserve its complete `correction_required` set. Do not reconstruct, filter, relabel, or reorder either section.

Return:
{{"kind": "step_result", "data": {{"profile": {{"matter_metadata": {{}}, "gaps": [], "proceedings": [{{"court": "", "registry": "", "file_number": "", "courthouse_address": "", "valid_role_groups": [], "correction_required": []}}]}}}}}}

Replace the empty values with the exact `/matter-data` result.

## Constraints
- Invoke `/matter-data` `profile` and its delegated `proceedings-profile`; do not read or query matter-data files directly.
- Return ONLY the JSON object specified above."""

        return """You are a matter profile agent for a BC Supreme Court form drafting system.

The matter profile could not be fetched automatically. Ask the user to provide the matter folder path.

Return:
{"kind": "ask_user", "question": "I could not locate the matter profile. Please provide the path to the matter folder.", "options": []}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    role_integrity_problem = _role_integrity_problem(profile)
    if role_integrity_problem:
        return f"""You are a matter profile agent for a BC Supreme Court form drafting system.

The matter profile is not renderable: {role_integrity_problem}

Return:
{{"kind": "ask_user", "question": "{role_integrity_problem}", "options": []}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # Check for gaps
    gaps = profile.get("gaps", [])
    if gaps:
        gap_list = "\n".join(f"  - {g}" for g in gaps)
        return f"""You are a matter profile agent for a BC Supreme Court form drafting system.

The matter profile has gaps that must be filled before proceeding. Report these gaps to the user.

## Gaps Found
{gap_list}

Return:
{{"kind": "ask_user", "question": "The matter profile has gaps that must be filled before I can proceed:\\n{gap_list}\\n\\nPlease run the matter-data profile operation to fill these gaps, then try again.", "options": []}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # Forms 1 and 4 carry the address-for-service block, which is filled from
    # the firm block in probanda.json. Stall here rather than at fill time, so
    # the lawyer fixes the config before confirming a profile.
    firm_fields = firm_context_fields() if ctx.get("form_id") in FIRM_FORMS else {}
    if ctx.get("form_id") in FIRM_FORMS and not firm_fields.get("firm_address"):
        return f"""You are a matter profile agent for a BC Supreme Court form drafting system.

This form carries an address-for-service block, and the firm details that fill it are missing.

Return:
{{"kind": "ask_user", "question": "This form needs the firm's address for service, which is not configured. Add a \\"firm\\" block to {json.dumps(str(config_path()))[1:-1]} with the keys \\"address\\", \\"email\\" and \\"fax\\" (leave a value empty if the firm has none), then try again.", "options": []}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # Profile is complete -- format for confirmation
    answers = ctx.get("step_answers", [])
    if answers and answers[-1] and answers[-1].lower() in ("yes", "confirmed", "correct", "looks good", "y"):
        # Already confirmed by user
        proceedings = profile.get("proceedings", [])
        proc = proceedings[0] if proceedings else {}
        parties = _parties_for_display(proc)
        caption_fields = _caption_fields_from_role_groups(proc)
        metadata = profile.get("matter_metadata", {})

        context_fields = {
            "court_file_number": proc.get("file_number", ""),
            "registry": proc.get("registry", ""),
            "court_location": proc.get("courthouse_address", ""),
            **caption_fields,
            "client_name": profile.get(
                "client_name", metadata.get("client_name", "")
            ),
            "lawyer_name": _resolve_full_lawyer_name(
                profile.get(
                    "filing_lawyer_name",
                    metadata.get("filing_lawyer_name", ""),
                ),
                parties,
            ),
            **firm_fields,
        }

        return f"""You are a matter profile agent. The lawyer has confirmed the profile is correct.

Return the confirmed profile data:
{{"kind": "step_result", "data": {{"profile_summary": "Profile confirmed.", "context_fields": {json.dumps(context_fields)}, "confirmed": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # Format profile for display and ask for confirmation
    proceedings = profile.get("proceedings", [])
    proc = proceedings[0] if proceedings else {}
    parties = _parties_for_display(proc)
    metadata = profile.get("matter_metadata", {})

    party_lines = []
    for p in parties:
        party_lines.append(f"  {p['name']} ({p['role']})")

    summary = f"""Matter: {profile.get('short_name', metadata.get('short_name', metadata.get('matter_id', 'Unknown')))}
Client: {profile.get('client_name', metadata.get('client_name', 'Unknown'))}
Filing Lawyer: {profile.get('filing_lawyer_name', metadata.get('filing_lawyer_name', 'Unknown'))}
Court: {proc.get('court', 'Unknown')}
Registry: {proc.get('registry', 'Unknown')}
File Number: {proc.get('file_number', 'Unknown')}
Courthouse: {proc.get('courthouse_address', 'Unknown')}
Parties:
{chr(10).join(party_lines)}"""

    return f"""You are a matter profile agent for a BC Supreme Court form drafting system.

Present the following matter profile to the lawyer for confirmation.

## Matter Profile
{summary}

Ask the lawyer to confirm this is correct. Return:
{{"kind": "ask_user", "question": "Here is the matter profile I will use:\\n\\n{summary}\\n\\nIs this correct?", "options": ["Yes", "No, I need to make corrections"]}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    profile = result.get("profile")
    if profile is None and not result.get("confirmed"):
        return False, "Result must include a profile or confirmed context"
    if profile is not None:
        if (
            not isinstance(profile, dict)
            or not isinstance(profile.get("proceedings"), list)
            or not profile["proceedings"]
        ):
            return False, "Profile must include at least one proceeding"
        problem = _role_integrity_problem(profile)
        if problem and "correction required" not in problem.lower():
            return False, problem
    if result.get("confirmed"):
        if not result.get("context_fields"):
            return False, "Confirmed result must include context_fields"
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    if result.get("profile") is not None and not result.get("confirmed"):
        ctx["profile"] = result["profile"]
        ctx["_stay_on_step"] = True
        return ctx
    if result.get("confirmed"):
        ctx["profile_confirmed"] = True
        ctx["scalars"] = ctx.get("scalars") or {}
        ctx["scalars"].update(result["context_fields"])
        # Persist matter_path and profile for downstream steps.
        # build_prompt() sets these in memory but they're lost when
        # ctx reloads from disk — extract from step_answers here.
        if not ctx.get("matter_path"):
            skip = {"yes", "y", "confirmed", "correct", "looks good",
                    "no", "n", "no, i need to make corrections"}
            for ans in ctx.get("step_answers", []):
                if ans and isinstance(ans, str) and ans.strip().lower() not in skip:
                    candidate = ans.strip()
                    if Path(candidate).is_dir():
                        ctx["matter_path"] = candidate
                        break
    return ctx
