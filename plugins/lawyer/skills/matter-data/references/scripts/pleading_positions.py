"""Deterministic helpers for pleading-response position extraction."""

import re


FACT_VALUES = {"claim", "admit", "deny", "not_admit", "no_position"}
POSITION_BASES = {
    None,
    "outside_knowledge",
    "strict_proof",
    "insufficient_particulars",
    "directed_to_other_party",
    "qualified",
    "other",
}
RELIEF_VALUES = {"seek", "consent", "oppose", "no_position"}
# A stance on a pleading is recognised by its shape, not by a word. "consent"
# counts only as the verb "consent(s) to", so "Consent Order" and "the consent
# of" never match.
_PARAGRAPH = r"\b(?:sub)?para(?:graph)?s?\.?\s*\d+"
_STANCE_VERB = (
    r"\b(?:admits?|den(?:y|ies)|takes? no position|consents?\s+to|opposes?|"
    r"incorporates?|adopts?)\b"
)
_SAME_SENTENCE = r"[^.;]{0,60}?"
# Unmistakable: a stance verb whose object is a numbered pleading paragraph,
# active ("admits paragraph 4") or passive ("paragraph 4 is denied").
PLAIN_STANCE = re.compile(
    _STANCE_VERB + _SAME_SENTENCE + _PARAGRAPH
    + r"|" + _PARAGRAPH + r"[^.;]{0,40}?\b(?:is|are)\s+(?:not\s+)?"
    r"(?:admitted|denied|opposed|adopted|incorporated)\b",
    re.IGNORECASE,
)
# Possibly a stance: a bare paragraph reference, non-admission wording, or a
# stance verb whose object is a pleading or an allegation.
RESIDUAL_STANCE = re.compile(
    _PARAGRAPH
    + r"|\b(?:not admit|no knowledge|outside (?:its|their|his|her) knowledge|"
    r"strict proof|takes? no position)\b"
    r"|" + _STANCE_VERB + _SAME_SENTENCE
    + r"\b(?:allegations?|pleadings?|notice of civil claim|response to civil "
    r"claim|counterclaim|third party notice|petition|notice of application|"
    r"application response)\b",
    re.IGNORECASE,
)
RESIDUAL_NOTE = (
    "UNCONFIRMED: possible pleading stance or paragraph reference; "
    "confirm this is a fact"
)
LOCATOR = re.compile(
    r"^(?:paras?\.?\s*)?(\d+)(?:\(([a-z0-9]+)\))?"
    r"(?:\s*[-–—]\s*(\d+)(?:\(([a-z0-9]+)\))?)?$",
    re.IGNORECASE,
)


class ExtractionError(ValueError):
    pass


def _locator_parts(locator):
    match = LOCATOR.match(locator.strip())
    if not match:
        raise ExtractionError(f"unparseable locator: {locator}")
    start, start_sub, end, end_sub = match.groups()
    return int(start), start_sub, int(end) if end else None, end_sub


def locator_sort_key(locator):
    start, sub, _end, _end_sub = _locator_parts(locator)
    return start, sub or ""


def resolve_fact_positions(
    references,
    answered_facts,
    parties,
    value,
    source_locator,
    position_basis=None,
    qualification=None,
):
    if value not in FACT_VALUES:
        raise ExtractionError(f"invalid factual position: {value}")
    if position_basis not in POSITION_BASES:
        raise ExtractionError(f"invalid position basis: {position_basis}")

    resolved = []
    unresolved = []
    for reference in references:
        start, start_sub, end, end_sub = _locator_parts(reference)
        matches = []
        for fact in answered_facts:
            try:
                number, sub, _unused_end, _unused_sub = _locator_parts(
                    fact["source_locator"]
                )
            except ExtractionError:
                # A fact located by a non-numbered-paragraph locator (¶N from a
                # rendered docx/eml body, or hdr) can never be the target of a
                # "paragraph N" reference — skip it rather than aborting
                # resolution of the whole document. The reference's own
                # locator (parsed above) still fails closed on unparseable
                # input.
                continue
            if end is None:
                if number == start and (start_sub is None or sub == start_sub):
                    matches.append(fact)
            elif start <= number <= end:
                if number == start and start_sub and sub != start_sub:
                    continue
                if number == end and end_sub and sub != end_sub:
                    continue
                matches.append(fact)
        if not matches:
            unresolved.append(reference)
            continue
        for fact in matches:
            for party in parties:
                resolved.append(
                    {
                        "target_fact_key": fact["fact_key"],
                        "party_name": party,
                        "value": value,
                        "position_basis": position_basis,
                        "qualification": qualification,
                        "source_locator": source_locator,
                    }
                )

    if unresolved:
        smallest = min(unresolved, key=locator_sort_key)
        raise ExtractionError(f"unresolved target locator: {smallest}")
    return resolved


def validate_extraction(payload, answered_fact_keys=(), answered_relief_keys=()):
    required = (
        "facts",
        "fact_positions",
        "relief_items",
        "relief_positions",
        "source_references",
        "unresolved_references",
    )
    for name in required:
        if not isinstance(payload.get(name), list):
            raise ExtractionError(f"missing array: {name}")

    if payload["unresolved_references"]:
        smallest = min(
            payload["unresolved_references"],
            key=lambda row: locator_sort_key(row["target_locator"]),
        )
        raise ExtractionError(
            f"unresolved target locator: {smallest['target_locator']}"
        )

    new_fact_keys = {row["fact_key"] for row in payload["facts"]}
    new_relief_keys = {row["relief_key"] for row in payload["relief_items"]}
    fact_targets = set(answered_fact_keys) | new_fact_keys
    relief_targets = set(answered_relief_keys) | new_relief_keys

    for fact in payload["facts"]:
        if PLAIN_STANCE.search(fact["description"]):
            raise ExtractionError(
                f"non-factual position stored as fact at {fact['source_locator']}"
            )
        if RESIDUAL_STANCE.search(fact["description"]):
            # Not plainly a stance: keep the fact and send it to the human
            # queue (conventions §5) rather than dropping it or aborting.
            fact["notes"] = RESIDUAL_NOTE
            fact["verified"] = 2
    seen = set()
    for position in payload["fact_positions"]:
        if position["value"] not in FACT_VALUES:
            raise ExtractionError(f"invalid factual position: {position['value']}")
        if position.get("position_basis") not in POSITION_BASES:
            raise ExtractionError(
                f"invalid position basis: {position.get('position_basis')}"
            )
        if position["target_fact_key"] not in fact_targets:
            raise ExtractionError(
                f"unknown target fact: {position['target_fact_key']}"
            )
        identity = (
            position["target_fact_key"],
            position["party_name"],
            position["source_locator"],
        )
        if identity in seen:
            raise ExtractionError(f"duplicate current factual position: {identity}")
        seen.add(identity)

    for position in payload["relief_positions"]:
        if position["value"] not in RELIEF_VALUES:
            raise ExtractionError(f"invalid relief position: {position['value']}")
        if position["target_relief_key"] not in relief_targets:
            raise ExtractionError(
                f"unknown target relief: {position['target_relief_key']}"
            )
    return payload
