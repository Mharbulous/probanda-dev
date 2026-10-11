"""Form 63 -- Default Judgment Bill of Costs (Rule 14-1 (20)).

Deterministic engine: a context dict in, a rendered markdown document out. No
prose composition happens outside this module -- the calling skill gathers
facts, this module renders. Schedule 1 banding and every subtotal/total are
computed here from raw inputs; nothing arithmetic is ever accepted as an
already-computed value.

Allowed-column and TOTAL ALLOWED cells are registrar-owned and always render
the form's dotted placeholder -- no input can populate them.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

# ---------------------------------------------------------------------------
# Schedule 1 (B.C. Reg. 168/2009, Appendix B, Schedule 1). Figures as supplied
# in the 2026-08-10 implementation plan for this engine -- not independently
# re-verified against bclaws.gov.bc.ca at build time; see
# ../references/schedule-1.md for re-verification status.
# Bounds are the amount-involved UPPER bound, exclusive: an amount equal to a
# bound falls in the *next* band.
# ---------------------------------------------------------------------------
SCHEDULE_1_BANDS: list[tuple[str | None, str]] = [
    ("5000", "160"),
    ("15000", "240"),
    ("25000", "320"),
    ("35000", "400"),
    ("45000", "480"),
    ("55000", "560"),
    ("65000", "620"),
    (None, "680"),
]
NO_AMOUNT_INVOLVED_COSTS = "320"

_DOTTED = "$.............."
_NO_AMOUNT = "no amount involved"
_SIGNATURE_RULE = "." * 68
_DATE_PLACEHOLDER = "............\\[dd/mmm/yyyy\\]............"
# Prescribed text carried by every Appendix A form (see ../references/form-63.md).
# Brackets escaped for markdown; fill_form63.py's template carries them literal.
_RULE_22_3_NOTE = (
    "\\[Rule 22-3 of the Supreme Court Civil Rules applies to all forms.\\]"
)


def schedule_1_costs(amount: Decimal | None) -> Decimal:
    """Schedule 1 costs for one amount involved, or the no-amount-involved figure."""

    if amount is None:
        return Decimal(NO_AMOUNT_INVOLVED_COSTS)
    for bound, costs in SCHEDULE_1_BANDS:
        if bound is None or amount < Decimal(bound):
            return Decimal(costs)
    raise AssertionError("unreachable: last band has no bound")


# ---------------------------------------------------------------------------
# Validation and decimal parsing
# ---------------------------------------------------------------------------


def _parse_decimal(value: Any, field: str) -> Decimal:
    if isinstance(value, float):
        raise ValueError(f"{field} must be a decimal string, not a float: {value!r}")
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a decimal string: {value!r}")
    try:
        d = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"{field} is not a valid decimal string: {value!r}") from exc
    if d < 0:
        raise ValueError(f"{field} must not be negative: {value!r}")
    return d


def _parse_optional_decimal(value: Any, field: str) -> Decimal | None:
    if value is None:
        return None
    return _parse_decimal(value, field)


def _validate(ctx: dict[str, Any]) -> None:
    if not ctx.get("plaintiffs"):
        raise ValueError("plaintiffs must not be empty")
    if not ctx.get("defendants"):
        raise ValueError("defendants must not be empty")
    if not ctx.get("party_claiming_costs"):
        raise ValueError("party_claiming_costs is required")
    if not ctx.get("court_file_number"):
        raise ValueError("court_file_number is required")
    if not ctx.get("registry"):
        raise ValueError("registry is required")

    no_amount = bool(ctx.get("no_amount_involved"))
    has_amount = ctx.get("amount_involved") is not None
    if no_amount and has_amount:
        raise ValueError(
            "amount_involved must not be set alongside no_amount_involved=true"
        )
    if not no_amount and not has_amount:
        raise ValueError(
            "amount_involved is required unless no_amount_involved is true"
        )

    for disb in ctx.get("disbursements") or []:
        if not disb.get("description"):
            raise ValueError("each disbursement requires a description")
        if disb.get("amount") is None:
            raise ValueError(f"disbursement {disb.get('description')!r} requires an amount")


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def _fmt_money(amount: Decimal) -> str:
    quantized = amount.quantize(Decimal("0.01"))
    return f"${quantized:,.2f}"


def _fmt_optional(amount: Decimal | None, placeholder: str) -> str:
    return _fmt_money(amount) if amount is not None else placeholder


def _join_names(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + " and " + names[-1]


def _party_role(count: int, role: str) -> str:
    return role if count == 1 else role + "s"


# ---------------------------------------------------------------------------
# Table rendering
# ---------------------------------------------------------------------------


def _compact_row(cells: list[str]) -> str:
    return "|" + "|".join(" " if c == "" else f" {c} " for c in cells) + "|"


def _aligned_table(header: list[str], rows: list[list[str]]) -> list[str]:
    """A GFM pipe table whose columns are padded to their own max content width."""

    widths = [
        max(len(header[i]), *(len(row[i]) for row in rows)) if rows else len(header[i])
        for i in range(len(header))
    ]
    lines = [_compact_row([h.ljust(w) for h, w in zip(header, widths)])]
    lines.append(
        "|" + "|".join(f" {'-' * w} " for w in widths) + "|"
    )
    for row in rows:
        lines.append(_compact_row([c.ljust(w) for c, w in zip(row, widths)]))
    return lines


# ---------------------------------------------------------------------------
# Derived figures
# ---------------------------------------------------------------------------


def compute(ctx: dict[str, Any]) -> dict[str, Any]:
    """Every derived value on a Form 63. Money is a Decimal, or None where the
    context carries none; each renderer formats it and supplies its own
    placeholder.

    Sole source of Schedule 1 banding and of every subtotal and total. Both
    outputs -- the markdown `render` below and the Word filler in
    `fill_form63.py` -- consume this; neither re-derives a figure.

    Registrar-owned values (the Allowed column, TOTAL ALLOWED) are not here:
    no input can populate them, and each renderer emits the form's dotted
    placeholder itself.

    `date` is returned raw -- None when the context carries none -- because its
    placeholder differs between outputs (markdown escapes the brackets).
    """

    _validate(ctx)

    no_amount = bool(ctx.get("no_amount_involved"))
    amount_involved = _parse_optional_decimal(ctx.get("amount_involved"), "amount_involved")
    additional_costs = _parse_optional_decimal(
        ctx.get("additional_costs_6_5"), "additional_costs_6_5"
    )
    disbursement_taxes = _parse_optional_decimal(
        ctx.get("disbursement_taxes"), "disbursement_taxes"
    )
    disbursements = [
        {
            "description": d["description"],
            "amount": _parse_decimal(d["amount"], "disbursement amount"),
        }
        for d in (ctx.get("disbursements") or [])
    ]

    sched1 = schedule_1_costs(None if no_amount else amount_involved)
    costs_total = sched1 + (additional_costs or Decimal("0"))
    disb_total = sum((d["amount"] for d in disbursements), Decimal("0")) + (
        disbursement_taxes or Decimal("0")
    )

    plaintiffs = list(ctx["plaintiffs"])
    defendants = list(ctx["defendants"])

    return {
        "registry": ctx["registry"],
        "court_file_number": ctx["court_file_number"],
        "plaintiffs": _join_names(plaintiffs),
        "defendants": _join_names(defendants),
        "plaintiff_role": _party_role(len(plaintiffs), "Plaintiff"),
        "defendant_role": _party_role(len(defendants), "Defendant"),
        "party_claiming_costs": ctx["party_claiming_costs"],
        "amount_involved": None if no_amount else amount_involved,
        "costs_description": "To enter judgment under Rule 3-8",
        "schedule_1_costs": sched1,
        "additional_costs": additional_costs,
        "costs_total": costs_total,
        "disbursements": disbursements,
        "disbursement_taxes": disbursement_taxes,
        "disbursement_total": disb_total,
        "date": ctx.get("date"),
    }


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render(ctx: dict[str, Any]) -> str:
    fig = compute(ctx)

    lines: list[str] = []
    lines.extend(_render_style_of_proceeding(fig))
    lines.append("")
    lines.extend(_render_intro(fig))
    lines.append("")
    lines.extend(_render_costs(fig))
    lines.append("")
    lines.extend(_render_disbursements(fig))
    lines.append("")
    lines.extend(_render_total_allowed(fig))
    return "\n".join(lines) + "\n"


def _render_style_of_proceeding(fig: dict[str, Any]) -> list[str]:
    rows = [
        ["", "", ""],
        ["", "*Form 63 (Rule 14-1 (20))*", ""],
        ["", "", f"{fig['registry']} Registry"],
        ["", "", f"No. {fig['court_file_number']}"],
        ["", "**IN THE SUPREME COURT OF BRITISH COLUMBIA**", ""],
        ["BETWEEN:", "", ""],
        ["", fig["plaintiffs"], ""],
        ["", "", f"*{fig['plaintiff_role']}*"],
        ["AND:", "", ""],
        ["", fig["defendants"], ""],
        ["", "", f"*{fig['defendant_role']}*"],
        ["", "**DEFAULT JUDGMENT BILL OF COSTS**", ""],
        ["", f"*{_RULE_22_3_NOTE}*", ""],
    ]
    lines = [_compact_row(rows[0]), _compact_row([":---", ":---:", "---:"])]
    lines.extend(_compact_row(r) for r in rows[1:])
    return lines


def _render_intro(fig: dict[str, Any]) -> list[str]:
    return [
        _compact_row(["", ""]),
        _compact_row(["---:", ":---"]),
        _compact_row(
            [
                "This is the default judgment bill of costs of:",
                fig["party_claiming_costs"],
            ]
        ),
        _compact_row(
            ["Amount involved", _fmt_optional(fig["amount_involved"], _NO_AMOUNT)]
        ),
    ]


def _render_costs(fig: dict[str, Any]) -> list[str]:
    rows = [
        [fig["costs_description"], _fmt_money(fig["schedule_1_costs"]), _DOTTED, ""],
        [
            "Additional costs, if any, ordered under section 6 (5) of Appendix B",
            _fmt_optional(fig["additional_costs"], _DOTTED),
            _DOTTED,
            "",
        ],
        [
            "**Total:**",
            f"**{_fmt_money(fig['costs_total'])}**",
            f"**{_DOTTED}**",
            f"**{_DOTTED}**",
        ],
    ]
    header = ["**Description**", "**Claimed**", "**Allowed**", ""]
    return ["**COSTS**", ""] + _aligned_table(header, rows)


def _render_disbursements(fig: dict[str, Any]) -> list[str]:
    rows = [
        [d["description"], _fmt_money(d["amount"]), _DOTTED, ""]
        for d in fig["disbursements"]
    ]
    rows.append(
        [
            "**Applicable taxes:**",
            f"**{_fmt_optional(fig['disbursement_taxes'], _DOTTED)}**",
            f"**{_DOTTED}**",
            "",
        ]
    )
    rows.append(
        [
            "**Total:**",
            f"**{_fmt_money(fig['disbursement_total'])}**",
            f"**{_DOTTED}**",
            f"**{_DOTTED}**",
        ]
    )
    header = ["**Description**", "**Claimed**", "**Allowed**", ""]
    return ["**DISBURSEMENTS**", ""] + _aligned_table(header, rows)


def _render_total_allowed(fig: dict[str, Any]) -> list[str]:
    date = fig["date"]
    date_cell = f"Date: {date}" if date else f"Date: {_DATE_PLACEHOLDER}"
    return [
        _compact_row(["", ""]),
        _compact_row([":---", "---:"]),
        _compact_row(["**TOTAL ALLOWED**", f"**{_DOTTED}**"]),
        _compact_row([date_cell, _SIGNATURE_RULE]),
        _compact_row(["", "Signature of assessing officer"]),
    ]
