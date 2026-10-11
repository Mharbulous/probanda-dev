"""gen.scalars -- Collect form-specific scalar values.

Asks the lawyer for form-specific fields via ask_user sub-loop.
Fields depend on form_id (from generate-form.md Phase 2).
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

max_retries = 2

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["step_result", "ask_user"]},
        "data": {
            "type": "object",
            "properties": {
                "scalars": {"type": "object"},
                "confirmed": {"type": "boolean"},
            },
        },
        "question": {"type": "string"},
        "options": {"type": "array"},
    },
    "required": ["kind"],
}

# The deponent and jurat fields every affidavit needs, whatever its form.
# interpreter_required and affidavit_ordinal are deliberately NOT here: neither
# prescribed affidavit-of-service form carries an interpreter endorsement, and
# R. 22-2(3) excepts an affidavit of service from the top-right identifier
# block that affidavit_ordinal fills.
DEPONENT_FIELDS = [
    ("deponent_name", "Full name of deponent"),
    ("deponent_address", "Civic address of deponent"),
    ("deponent_occupation", "Occupation of deponent (leave blank if not stated)"),
    ("swear_or_affirm", "Does the deponent swear or affirm? (swear/affirm)"),
    ("affidavit_date", "Date the affidavit is being made (e.g. 'April 27, 2026')"),
    ("commissioner_city", "City where the commissioner is located"),
    ("commissioner_name", "Name of the commissioner (leave blank if unknown)"),
]

# An affidavit of service leaves the jurat for the commissioner's stamp, which
# supplies the name; pre-printing one constrains who can commission it.
SERVICE_DEPONENT_FIELDS = [f for f in DEPONENT_FIELDS
                           if f[0] != "commissioner_name"]

# The service facts common to Form 15 and Form 16.
SERVICE_FIELDS = [
    ("person_served", "Full name of the person served"),
    ("service_date", "Date service was effected (e.g. 'August 5, 2026')"),
    ("service_time", "Time of day service was effected (e.g. '2:15 p.m.')"),
    ("filed_documents",
     "Documents served that ARE already filed in this proceeding — a list, each "
     "with a description and its court-stamp date. These are described, not exhibited."),
    ("unfiled_documents",
     "Documents served that are NOT filed in this proceeding — a list, each with a "
     "description. These are attached as lettered exhibits."),
    ("sworn_by_video",
     "Was the affidavit sworn or affirmed by video conference? (yes/no)"),
]

# Form-specific scalar field definitions
FORM_SCALARS = {
    "form-32": {
        "fields": [
            ("proposed_hearing", "Proposed hearing: a date, date range or assize (e.g. 'the week of November 2, 2026', or leave as '[proposed hearing]')"),
            ("duration_hours", "Duration hours (number, as text)"),
            ("duration_minutes", "Duration minutes (number, as text)"),
            ("applicant_names", "Applicant name(s) for this application"),
            ("to_affected_parties", "Names of parties to be served"),
            ("title", "Title of the application (e.g. 'Security for Costs') -- used in output filename"),
            ("associate_judge", "Is this application within associate judge jurisdiction? (yes/no)"),
        ],
    },
    "form-66": {
        "fields": [
            ("time_estimate", "Time estimate for the hearing (e.g. '2 hours', or leave as '[time estimate]')"),
            ("is_judicial_review", "Is this an application for judicial review? (yes/no)"),
            ("title", "Title of the petition (e.g. 'Partition and Sale') -- used in output filename"),
        ],
    },
    "form-123": {
        "fields": [],  # OTSC: all scalars come from matter profile
    },
    "form-1": {
        "fields": [
            ("title", "Title for the output filename (e.g. 'Notice of Civil Claim')"),
        ],
    },
    "form-4": {
        "fields": [
            ("title", "Title for the output filename (e.g. 'Response to Counterclaim')"),
        ],
    },
    "form-17": {
        "fields": [
            ("filed_by", "Party filing the requisition"),
            ("required_text", "Exact order or relief required"),
            ("affidavit_description",
             "Complete affidavit-list entry, following: Affidavit # [number] of "
             "[deponent name], made [date]. Leave blank to retain the manual fields."),
        ],
    },
    "form-8": {
        "fields": [
            ("amount", "Exact costs amount to insert before 'to be assessed'"),
        ],
    },
    "affidavit": {
        "fields": DEPONENT_FIELDS + [
            ("interpreter_required", "Does the deponent require an interpreter? (yes/no, default: no)"),
            ("affidavit_ordinal", "Ordinal of this affidavit by this deponent in this proceeding (1st, 2nd, ...)"),
        ],
    },
    "form-15": {
        "fields": SERVICE_DEPONENT_FIELDS + SERVICE_FIELDS + [
            ("served_party_type",
             "Was the person served an individual or a company? "
             "(individual/company — company service is not yet supported)"),
            ("service_city", "City and country where service was effected"),
            ("identification_method",
             "How was the person served identified? "
             "(known = the deponent knows them; photo_id = photo identification "
             "produced; other = some other means)"),
            ("identification_detail",
             "The identification details: the means of knowledge, the "
             "identification produced, or the other means relied on"),
        ],
    },
    "form-16": {
        "fields": SERVICE_DEPONENT_FIELDS + SERVICE_FIELDS + [
            ("service_method",
             "How was the document served? (leaving / ordinary_mail / fax / email)"),
            ("service_address",
             "The party's address for service (required for leaving and "
             "ordinary_mail; leave blank otherwise)"),
            ("service_fax", "Fax number served to (leave blank unless fax)"),
            ("service_email", "E-mail address served to (leave blank unless email)"),
        ],
    },
}

# Form 16's substituted-service variant. `parties_served` is deliberately
# absent: gen.order extracts it from the entered order so the affidavit mirrors
# the order's own terms rather than the practitioner's recollection of them.
SUBSTITUTED_SERVICE_FIELDS = SERVICE_DEPONENT_FIELDS + [
    ("service_date",
     "Date service was effected under the order (e.g. 'June 10, 2026')"),
    ("service_time",
     "Time of day service was effected (optional — leave blank if not recorded)"),
    ("filed_documents",
     "Documents served that ARE already filed in this proceeding — a list, each "
     "with a description and its court-stamp date. These are described, not "
     "exhibited. The entered order is added automatically; do not list it again."),
    ("unfiled_documents",
     "Documents served that are NOT filed in this proceeding — a list, each with "
     "a description. These are attached as lettered exhibits."),
    ("service_exhibits",
     "Exhibits proving the transmissions themselves — a list, each with a "
     "description (e.g. 'the e-mail sent to the addresses in section 2'). One "
     "exhibit per transmission: a single e-mail to several ordered addresses is "
     "one exhibit. Leave as an empty list if none."),
    ("docs_summary",
     "Short description of the documents served, for the file name "
     "(e.g. 'NOCC and Order')"),
    ("sworn_by_video",
     "Was the affidavit sworn or affirmed by video conference? (yes/no)"),
]


def _fields_for(ctx: dict) -> list[tuple[str, str]]:
    """The scalar fields this session collects."""
    form_id = ctx.get("form_id", "form-32")
    if form_id == "form-16" and ctx.get("service_mode") == "substituted":
        return SUBSTITUTED_SERVICE_FIELDS
    # asmaff takes the deponent and the affidavit number from the emitted
    # file, so neither is asked a second time (#1488).
    if ctx.get("operation") == "asmaff":
        return [f for f in FORM_SCALARS["affidavit"]["fields"]
                if f[0] not in ("deponent_name", "affidavit_ordinal")]
    return FORM_SCALARS.get(form_id, {"fields": []})["fields"]


# Output filenames. Without these, gen.fill falls back to the registry name and
# every Form 15 in a matter is called "Affidavit of Personal Service (Form 15)".
TITLE_TEMPLATES = {
    "form-15": "Affidavit of Personal Service — {person_served}",
    "form-16": "Affidavit of Ordinary Service — {person_served}",
}

# Fields whose value must be one of a fixed set. Anything else is a re-askable
# validation error, never a silent default -- a wrong election here renders
# straight into a filed document.
ENUM_FIELDS = {
    "swear_or_affirm": {"swear", "affirm"},
    "interpreter_required": {"yes", "no"},
    "sworn_by_video": {"yes", "no"},
    "served_party_type": {"individual", "company"},
    "identification_method": {"known", "photo_id", "other"},
    "service_method": {"leaving", "ordinary_mail", "fax", "email"},
}

# Fields carrying a variable-length list, and the keys each entry must have.
LIST_FIELDS = {
    "filed_documents": ("description", "stamp_date"),
    "unfiled_documents": ("description",),
    "service_exhibits": ("description",),
}

# Accepted spellings of the affidavit date. The substituted-service file name
# is dated, so the date must be parseable rather than free text.
_DATE_FORMATS = ("%B %d, %Y", "%b %d, %Y", "%Y-%m-%d")


def _iso_date(value: str) -> str | None:
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(str(value).strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _deponent_tag(name: str) -> str:
    """'Monnie Chen' -> 'ChenM', the firm's file-naming short form."""
    parts = str(name).split()
    if len(parts) < 2:
        return "".join(parts)
    return parts[-1] + parts[0][0]


def _derive_sworn_or_affirmed(swear_or_affirm: str) -> str:
    """Map the validated swear/affirm election to its jurat form."""
    soa = str(swear_or_affirm).strip().lower()
    if soa == "swear":
        return "SWORN"
    if soa == "affirm":
        return "AFFIRMED"
    raise ValueError(
        f"swear_or_affirm must be 'swear' or 'affirm', got {swear_or_affirm!r}")


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("profile_confirmed"):
        return False, "Matter profile must be confirmed before collecting scalars"
    return True, ""


AFFIRMATIVE = {"yes", "y", "confirmed", "correct", "looks good", "ok", "okay",
               "that's right", "thats right", "confirm"}

_CONSTRAINTS = """## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools."""


def _field_lines(fields: list[tuple[str, str]]) -> list[str]:
    return [f"{i + 1}. {desc}" for i, (_key, desc) in enumerate(fields)]


def build_prompt(ctx: dict) -> str:
    """Collect every scalar in one round, map it, then confirm the mapping.

    Round 1 asks for all fields at once.  Round 2 hands the lawyer's reply back
    to the subagent verbatim to be mapped onto the field keys -- the reply
    otherwise reaches the subagent only as the value of the first key, which is
    useless for mapping.  Round 3 echoes the mapped values for confirmation,
    because no enum check catches an address and an occupation swapped between
    two fields that both render into the opening sentence of a filed document.
    """
    fields = _fields_for(ctx)
    answers = [a for a in ctx.get("step_answers", []) if a is not None]
    pending = ctx.get("_scalar_mapping")

    # No fields to collect -- pass the existing scalars straight through.
    if not fields:
        existing = ctx.get("scalars", {})
        return f"""You are a scalar collection agent. This form has no additional scalar fields to collect.

Return the existing scalars:
{{"kind": "step_result", "data": {{"scalars": {json.dumps(existing)}, "confirmed": true}}}}

{_CONSTRAINTS}"""

    # --- Round 3b: mapping confirmed -- emit the final result ---------------
    if pending is not None and answers and answers[-1].strip().lower() in AFFIRMATIVE:
        return f"""You are a scalar collection agent. The lawyer has confirmed the collected values.

Return the confirmed scalars:
{{"kind": "step_result", "data": {{"scalars": {json.dumps(pending)}, "confirmed": true}}}}

{_CONSTRAINTS}"""

    # --- Round 1: collect ---------------------------------------------------
    if pending is None and not answers:
        lines = _field_lines(fields)
        # The "\\n" below is JSON escaping: this string is interpolated into a
        # JSON literal, where a real newline would be unparseable. The prose
        # section above it renders the same list with real newlines.
        question = "Please provide the following form details:\\n" + "\\n".join(lines)
        prose = "Please provide the following form details:\n" + "\n".join(lines)
        return f"""You are a scalar collection agent for a BC Supreme Court form.

Ask the lawyer for the following information:

{prose}

Return:
{{"kind": "ask_user", "question": "{question}", "options": []}}

{_CONSTRAINTS}"""

    # --- Round 3a: echo the mapping and ask the lawyer to confirm -----------
    if pending is not None and not answers:
        labels = {key: desc for key, desc in fields}
        shown = "\\n".join(
            f"{labels.get(k, k).split(' (')[0]}: {json.dumps(v) if isinstance(v, list) else v}"
            for k, v in pending.items())
        shown_prose = shown.replace("\\n", "\n")
        return f"""You are a scalar collection agent for a BC Supreme Court form.

Show the lawyer the values you mapped and ask them to confirm before the form is filled.

{shown_prose}

Return:
{{"kind": "ask_user", "question": "Here are the values I will put in the form:\\n\\n{shown}\\n\\nIs this correct?", "options": ["Yes", "No, let me correct it"]}}

{_CONSTRAINTS}"""

    # --- Round 2: map the reply (or a correction) onto the field keys -------
    key_list = "\n".join(f"- {key}: {desc}" for key, desc in fields)
    reply_block = "\n\n".join(f"--- reply {i + 1} ---\n{a}" for i, a in enumerate(answers))
    correcting = ""
    if pending is not None:
        correcting = f"""
You previously mapped these values, and the lawyer did NOT confirm them:
{json.dumps(pending, indent=2)}

The last reply above is their correction. Apply it to the mapping above.
"""
    enum_note = "\n".join(
        f"- {key} must be exactly one of {sorted(allowed)} (lower case)"
        for key, allowed in ENUM_FIELDS.items()
        if key in {k for k, _d in fields})
    list_note = "\n".join(
        f"- {key} must be a JSON array of objects, each with keys {sorted(req)}"
        for key, req in LIST_FIELDS.items()
        if key in {k for k, _d in fields})

    return f"""You are a scalar collection agent for a BC Supreme Court form.

The lawyer was asked for the fields below and replied. Map their reply onto the field keys.

## Fields
{key_list}
{correcting}
## The lawyer's reply, verbatim
{reply_block}

## Rules
- Map only what the reply actually says. Never invent, infer, or default a value.
- Include EVERY field key. Where the lawyer said a field is blank, unknown, or not
  applicable, use an empty string "" -- do not omit the key.
{enum_note}
{list_note}
- If any field is missing from the reply, or you cannot tell which field a value belongs to,
  do NOT guess. Return an ask_user naming ONLY the fields still needed:
  {{"kind": "ask_user", "question": "<name only the missing or unclear fields>", "options": []}}

If every field is accounted for, return the mapping:
{{"kind": "step_result", "data": {{"scalars": {{"<key>": "<value>", ...}}, "confirmed": false}}}}

{_CONSTRAINTS}"""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    if "scalars" in result:
        scalars = result["scalars"]
        if not isinstance(scalars, dict):
            return False, "scalars must be a dict"
        fields = _fields_for(ctx)
        if fields:
            expected = [key for key, _desc in fields]
            missing = [key for key in expected if key not in scalars]
            if missing:
                return False, (f"scalars missing keys {missing}; "
                               f"expected exactly: {expected}")
        for key, allowed in ENUM_FIELDS.items():
            if key not in scalars:
                continue
            if str(scalars[key]).strip().lower() not in allowed:
                return False, (
                    f"{key} must be one of {sorted(allowed)}; got "
                    f"{scalars[key]!r}. Re-ask the lawyer for {key} only.")
        for key, required in LIST_FIELDS.items():
            if key not in scalars:
                continue
            value = scalars[key]
            if not isinstance(value, list):
                return False, f"{key} must be a list of objects; got {type(value).__name__}"
            for i, entry in enumerate(value):
                if not isinstance(entry, dict):
                    return False, (f"{key}[{i}] must be an object with keys "
                                   f"{sorted(required)}; got {type(entry).__name__}")
                gaps = [k for k in required if not entry.get(k)]
                if gaps:
                    return False, (f"{key}[{i}] is missing {gaps}. Re-ask the "
                                   f"lawyer for those details only.")

        if str(scalars.get("served_party_type", "")).strip().lower() == "company":
            return False, (
                "Form 15 here covers personal service on an individual only. "
                "Service on a company (Rule 4-3 / Business Corporations Act) is "
                "not yet modelled — tell the lawyer to draft it as a Form 109.")

        companion = {"leaving": "service_address", "ordinary_mail": "service_address",
                     "fax": "service_fax", "email": "service_email"}
        method = str(scalars.get("service_method", "")).strip().lower()
        if method in companion and not scalars.get(companion[method]):
            return False, (f"service_method {method!r} requires "
                           f"{companion[method]}. Re-ask the lawyer for that field only.")

        if scalars.get("identification_method") and not scalars.get("identification_detail"):
            return False, ("identification_method was given without "
                           "identification_detail. Re-ask the lawyer for the "
                           "identification details only.")

        if ctx.get("service_mode") == "substituted":
            if not _iso_date(scalars.get("affidavit_date", "")):
                return False, (
                    "affidavit_date could not be read as a date; the file name "
                    "of an affidavit of substituted service is dated. Re-ask "
                    "the lawyer for the date only, in the form 'August 6, 2026'.")
            if not str(scalars.get("service_date", "")).strip():
                return False, ("service_date is required: the date of each "
                               "deposed act is mandatory. Re-ask the lawyer "
                               "for that field only.")
            if not str(scalars.get("docs_summary", "")).strip():
                return False, ("docs_summary is required for the file name. "
                               "Re-ask the lawyer for that field only.")
    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    if "scalars" in result and not result.get("confirmed"):
        # Mapping produced but not yet shown to the lawyer -- stash it and stay
        # on this step so build_prompt runs the confirmation round.
        ctx["_scalar_mapping"] = result["scalars"]
        ctx["_stay_on_step"] = True
        return ctx

    if "scalars" in result:
        scalars = dict(result["scalars"])
        # Store the normalized election: swear_or_affirm renders verbatim into
        # "[swear or affirm] THAT:" and "[swear or affirm]ing", so "Swear"
        # would reach the filed document as "Swear THAT:".
        for key in ENUM_FIELDS:
            if key in scalars:
                scalars[key] = str(scalars[key]).strip().lower()
        if "swear_or_affirm" in scalars:
            scalars["sworn_or_affirmed"] = _derive_sworn_or_affirmed(
                scalars["swear_or_affirm"])
        if ctx.get("service_mode") == "substituted":
            scalars["service_mode"] = "substituted"
            # Rule 4-4(2) requires the entered order to be served with the
            # document, so it is always one of the documents served. It comes
            # from the order the lawyer already confirmed, not from this reply.
            order_doc = (ctx.get("order_extraction") or {}).get("order_document")
            if order_doc:
                filed = list(scalars.get("filed_documents") or [])
                if not any(order_doc["description"] == d.get("description")
                           for d in filed):
                    filed.append(order_doc)
                scalars["filed_documents"] = filed
            scalars["title"] = (
                f"{_iso_date(scalars['affidavit_date'])} AOSS "
                f"{_deponent_tag(scalars['deponent_name'])} re service of "
                f"{scalars['docs_summary']}")

        title_template = TITLE_TEMPLATES.get(ctx.get("form_id", ""))
        if title_template and not scalars.get("title"):
            scalars["title"] = title_template.format(**scalars)
        # Keep the matter-profile fields already in ctx["scalars"]; the mapping
        # subagent only ever returns the form-specific keys.
        merged = dict(ctx.get("scalars", {}))
        merged.update(scalars)
        ctx["scalars"] = merged
        ctx.pop("_scalar_mapping", None)
    return ctx
