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
FORBIDDEN_FACT = re.compile(
    r"\b(admits?|denies?|does not admit|not admit|no knowledge|outside "
    r"(?:its|their|his|her) knowledge|strict proof|takes? no position|"
    r"consents?|opposes?|incorporates?|adopts?|paragraphs?\s+\d+)\b",
    re.IGNORECASE,
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
        if FORBIDDEN_FACT.search(fact["description"]):
            raise ExtractionError(
                f"non-factual position stored as fact at {fact['source_locator']}"
            )
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
