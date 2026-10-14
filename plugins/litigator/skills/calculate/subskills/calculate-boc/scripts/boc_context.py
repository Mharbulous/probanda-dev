"""Compute a Form 62 bill of costs' totals and write the fill context.

Usage:
    python boc_context.py --state "<working folder>/bill-of-costs.json"
                          [--out "<working folder>/boc-context.json"]

Reads the shared state file the /calculate bill-of-costs members write, computes
every total with Decimal, and writes boc-context.json beside it in the shape
fill_boc.py consumes. The context schema is documented at
publish/subskills/publish-boc/references/boc-context.md.

Standard library only. Prints one JSON line:
{"success": true, "out": "...", "total_units": "...", "grand_total": "..."} or
{"success": false, "error": "..."}. Exit 0 on success, 1 on a refusal.
"""
from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

GST_RATE = Decimal("0.05")
PST_RATE = Decimal("0.07")

# The seven categories fill_boc.py renders, in the order its tables appear.
DISB_CATEGORIES = [
    "filing_fees", "transcripts", "expert_fees",
    "photocopying", "search_fees", "travel", "other",
]

# The originating side is whichever of these roles the state file carries; the
# responding side is whichever of the second list it carries.
ORIGINATING_ROLES = ["plaintiff", "petitioner", "claimant", "appellant"]
RESPONDING_ROLES = ["defendant", "respondent"]

CENT = Decimal("0.01")


class ContextError(Exception):
    pass


def _decimal(value, field: str) -> Decimal:
    if isinstance(value, float):
        raise ContextError(f"{field} must be a decimal string, not a float: {value!r}")
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value).replace(",", "").lstrip("$"))
    except InvalidOperation:
        raise ContextError(f"{field} is not a valid decimal: {value!r}") from None


def _money(amount: Decimal) -> str:
    return f"${amount.quantize(CENT, rounding=ROUND_HALF_UP):,.2f}"


def _units(amount: Decimal) -> str:
    text = format(amount.normalize(), "f")
    return text if "." not in text else text.rstrip("0").rstrip(".")


def _party(parties: dict, roles: list[str]) -> tuple[str, str]:
    """Return (names joined, ROLE) for the first role present with names."""
    for role in roles:
        names = parties.get(role) or []
        if names:
            label = role.upper() + ("S" if len(names) > 1 else "")
            return ", ".join(names), label
    return "", ""


def build_context(state: dict) -> dict:
    parties = state.get("parties") or {}
    originating, originating_role = _party(parties, ORIGINATING_ROLES)
    responding, responding_role = _party(parties, RESPONDING_ROLES)

    unit_value = _decimal(state.get("unitValue"), "unitValue")
    if unit_value <= 0:
        raise ContextError("unitValue must be a positive decimal string")

    tariff_items = []
    total_units = Decimal("0")
    for index, item in enumerate(state.get("tariffItems") or []):
        units = _decimal(item.get("unitsClaimed"), f"tariffItems[{index}].unitsClaimed")
        total_units += units
        tariff_items.append({
            "no": str(item.get("no", "")),
            "description": str(item.get("description", "")),
            "units_claimed": _units(units),
        })

    fees_subtotal = (total_units * unit_value).quantize(CENT, rounding=ROUND_HALF_UP)
    fees_gst = (fees_subtotal * GST_RATE).quantize(CENT, rounding=ROUND_HALF_UP)
    fees_pst = (fees_subtotal * PST_RATE).quantize(CENT, rounding=ROUND_HALF_UP)
    fees_taxes = fees_gst + fees_pst
    fees_total = fees_subtotal + fees_taxes

    grouped: dict[str, list[dict]] = {key: [] for key in DISB_CATEGORIES}
    subtotals = {key: Decimal("0") for key in DISB_CATEGORIES}
    for index, row in enumerate(state.get("disbursements") or []):
        category = row.get("category") or "other"
        if category not in grouped:
            raise ContextError(
                f"disbursements[{index}].category is not one of "
                f"{', '.join(DISB_CATEGORIES)}: {category!r}"
            )
        claimed = _decimal(row.get("claimed"), f"disbursements[{index}].claimed")
        subtotals[category] += claimed
        grouped[category].append({
            "date": str(row.get("date", "")),
            "description": str(row.get("description", "")),
            # Disbursements are claimed at actual cost including any tax paid, and
            # the state file records only that one figure, so the Amount column
            # carries it and the GST column stays blank rather than inventing a split.
            "amount": _money(claimed),
            "gst": "",
            "claimed": _money(claimed),
        })

    disb_total = sum(subtotals.values(), Decimal("0"))
    grand_total = fees_total + disb_total

    return {
        "court_file_number": str(state.get("courtFileNumber", "")),
        "registry": str(state.get("registry", "")),
        "originating_party": originating,
        "originating_party_role": originating_role,
        "responding_party": responding,
        "responding_party_role": responding_role,
        "party_claiming_costs": str(state.get("partyClaimingCosts", "")),
        "costs_scale": str(state.get("tariffScale", "")),
        "unit_value": _money(unit_value),
        "costs_order": str(state.get("costsOrder", "")),
        "costs_terms": str(state.get("costsTerms", "")),
        "tariff_items": tariff_items,
        "total_units": _units(total_units),
        "fees_subtotal": _money(fees_subtotal),
        "fees_gst": _money(fees_gst),
        "fees_pst": _money(fees_pst),
        "fees_taxes": _money(fees_taxes),
        "disbursements": grouped,
        "disb_subtotals": {
            key: (_money(subtotals[key]) if grouped[key] else "")
            for key in DISB_CATEGORIES
        },
        "disb_total": _money(disb_total),
        "fees_total": _money(fees_total),
        "grand_total": _money(grand_total),
        "notes": "",
        "notes_footer": "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute Form 62 bill-of-costs totals and write boc-context.json."
    )
    parser.add_argument("--state", required=True, help="Path to bill-of-costs.json")
    parser.add_argument("--out", help="Output path (default: boc-context.json beside the state file)")
    args = parser.parse_args()

    state_path = Path(args.state)
    out_path = Path(args.out) if args.out else state_path.with_name("boc-context.json")

    try:
        if not state_path.is_file():
            raise ContextError(f"state file not found: {state_path}")
        state = json.loads(state_path.read_text(encoding="utf-8"))
        context = build_context(state)
    except (ContextError, json.JSONDecodeError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        return 1

    out_path.write_text(json.dumps(context, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "success": True,
        "out": str(out_path),
        "total_units": context["total_units"],
        "fees_total": context["fees_total"],
        "disb_total": context["disb_total"],
        "grand_total": context["grand_total"],
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
