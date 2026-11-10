"""gen.order -- Read the entered Rule 4-4 order for the substituted-service variant.

The order's terms are the source of truth for sections 1 and 2 of an Affidavit
of Substituted Service: section 2 mirrors the order's own subparagraph
hierarchy so the practitioner can hold the two side by side. This step takes
the entered order, extracts that hierarchy, and echoes it back for
confirmation before any scalar is collected.
"""
from __future__ import annotations

import json

max_retries = 2

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["step_result", "ask_user"]},
        "data": {
            "type": "object",
            "properties": {
                "extraction": {"type": "object"},
                "confirmed": {"type": "boolean"},
            },
        },
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["kind"],
}

AFFIRMATIVE = {"yes", "y", "confirmed", "correct", "looks good", "ok", "okay",
               "that's right", "thats right", "confirm"}

_EXTRACTION_SHAPE = """{"order_document": {"description": "<how the order is described in the affidavit's list of documents served, e.g. 'Order Made after Application pronounced by Associate Judge X permitting substitutional service (the \\"Order\\")'>", "stamp_date": "<the order's court stamp date>"}, "parties_served": [{"name": "<party name exactly as the order names them>", "methods": [{"kind": "<email|ordinary_mail|leaving|fax|custom>", "detail": "<the exact address, number or wording the order specifies>", "addresses": ["<one entry per mailing address the order lists, reproduced exactly, line breaks preserved>"], "ordered": true}]}]}"""


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("profile_confirmed"):
        return False, "Matter profile must be confirmed before reading the order"
    return True, ""


def build_prompt(ctx: dict) -> str:
    answers = [a for a in ctx.get("step_answers", []) if a is not None]
    pending = ctx.get("_order_extraction")

    # --- Round 3b: extraction confirmed -------------------------------------
    if pending is not None and answers and answers[-1].strip().lower() in AFFIRMATIVE:
        return f"""You are an order-ingestion agent. The lawyer has confirmed the extracted terms of the order.

Return the confirmed extraction:
{{"kind": "step_result", "data": {{"extraction": {json.dumps(pending)}, "confirmed": true}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # --- Round 1: ask for the order -----------------------------------------
    if pending is None and not answers:
        return """You are an order-ingestion agent for an Affidavit of Substituted Service.

An affidavit proving service under a Rule 4-4 order can only be drafted from the entered order: its terms are what the affidavit must mirror, party by party and method by method.

Return:
{"kind": "ask_user", "question": "This affidavit proves service under a substituted service order, so I need the entered order. Please give me the path to the entered order (PDF or .docx) in the matter folder.", "options": []}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # --- Round 3a: echo the extraction for confirmation ----------------------
    if pending is not None and not answers:
        shown = json.dumps(pending, indent=2, ensure_ascii=False)
        return f"""You are an order-ingestion agent for an Affidavit of Substituted Service.

Show the lawyer the terms you extracted from the order and ask them to confirm before the affidavit is drafted from them.

{shown}

Return, with the extraction rendered as readable plain text inside the question (one line per party, one line per method, addresses indented):
{{"kind": "ask_user", "question": "<the extracted terms as plain text>\\n\\nDoes this match the order? Reply yes to proceed, or tell me what to change.", "options": []}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""

    # --- Round 2: read the order and extract --------------------------------
    correcting = ""
    if pending is not None:
        correcting = f"""
You previously extracted these terms, and the lawyer did NOT confirm them:
{json.dumps(pending, indent=2, ensure_ascii=False)}

The last reply below is their correction. Apply it.
"""
    reply_block = "\n\n".join(f"--- reply {i + 1} ---\n{a}"
                             for i, a in enumerate(answers))

    return f"""You are an order-ingestion agent for an Affidavit of Substituted Service.

Read the entered Rule 4-4 order the lawyer identified below and extract the terms the affidavit must mirror.

## The lawyer's reply, verbatim
{reply_block}
{correcting}
## Rules
- Read the order. If the path does not resolve to a readable file, do not guess: return an ask_user naming the path you tried.
- List the parties in the order's own party order, and under each party the ordered methods in the order's own sequence.
- Reproduce every address, e-mail address, fax number and method wording EXACTLY as the order spells it, including spelling and punctuation. This affidavit is checked against the order term by term.
- Use kind "custom" for a method outside the four Form 16 branches (for example posting at an address, or a message through a social media account), and put the order's own wording in detail. Service by advertisement is Form 10 under Rule 4-4(3): if the order permits advertisement, say so in an ask_user rather than extracting it as a method.
- "addresses" is only for a method that lists more than a single destination, such as ordinary mail to several mailing addresses. Omit it otherwise.
- Extract only what the order ordered. Do not add courtesy copies or anything the lawyer mentioned but the order does not require -- those are collected later.

Return:
{{"kind": "step_result", "data": {{"extraction": {_EXTRACTION_SHAPE}, "confirmed": false}}}}

## Constraints
- Read only the order file. Do not write files, and do not call any other tool."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    extraction = result.get("extraction")
    if extraction is None:
        return False, "Result must include an extraction"
    if not isinstance(extraction, dict):
        return False, "extraction must be an object"

    order_doc = extraction.get("order_document")
    if not isinstance(order_doc, dict) or not order_doc.get("description"):
        return False, ("extraction.order_document needs a description: Rule "
                       "4-4(2) requires the entered order to be served with "
                       "the document, so it is one of the documents served.")
    if not order_doc.get("stamp_date"):
        return False, ("extraction.order_document needs the order's court "
                       "stamp date — a filed document is described by its "
                       "stamp date rather than exhibited.")

    parties = extraction.get("parties_served")
    if not isinstance(parties, list) or not parties:
        return False, "extraction.parties_served must list at least one party"
    for i, party in enumerate(parties):
        if not isinstance(party, dict) or not party.get("name"):
            return False, f"parties_served[{i}] needs a name"
        methods = party.get("methods")
        if not isinstance(methods, list) or not methods:
            return False, (f"{party.get('name')} has no methods; every party "
                           f"the order names carries the methods ordered for them")
        for j, method in enumerate(methods):
            kind = str(method.get("kind", "")).strip().lower()
            if kind not in ("email", "ordinary_mail", "leaving", "fax", "custom"):
                return False, (f"{party['name']} method {j + 1}: kind "
                               f"{method.get('kind')!r} is not one of email, "
                               f"ordinary_mail, leaving, fax, custom")
            if not str(method.get("detail", "")).strip() and not method.get("addresses"):
                return False, (f"{party['name']} method {j + 1} has no detail "
                               f"and no addresses")
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    if not result.get("confirmed"):
        # Extracted but not yet shown to the lawyer -- stay on this step so
        # build_prompt runs the confirmation round.
        ctx["_order_extraction"] = result["extraction"]
        ctx["_stay_on_step"] = True
        return ctx

    extraction = result["extraction"]
    ctx["order_extraction"] = extraction
    scalars = dict(ctx.get("scalars", {}))
    scalars["parties_served"] = extraction["parties_served"]
    ctx["scalars"] = scalars
    ctx.pop("_order_extraction", None)
    return ctx
