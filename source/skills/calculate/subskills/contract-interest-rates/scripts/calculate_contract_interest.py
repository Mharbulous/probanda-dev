#!/usr/bin/env python3
"""
calculate_contract_interest.py

Contractual interest calculator for a fixed or floating annual rate schedule.
The four positional arguments retain the original simple-interest behavior.
Optional flags add monthly compounding and interest-first payments.

Usage:
    python3 calculate_contract_interest.py <principal> <start_date> <end_date> '<rate_schedule_json>' [options]

Arguments:
    principal          Amount interest accrues on, in dollars (e.g. 135369.14)
    start_date          YYYY-MM-DD, first day interest accrues
    end_date            YYYY-MM-DD, last day interest accrues (inclusive)
    rate_schedule_json  JSON array of {"effective_date": "YYYY-MM-DD", "rate": <percent per
                        annum, spread already included>}. A rate in force on or before
                        start_date is required.

Options:
    --compound none|monthly
                        Default: none. With no options, output remains byte-for-byte
                        compatible with the original simple-interest calculator.
    --first-rest-date YYYY-MM-DD
                        Required with --compound monthly and forbidden otherwise. This is
                        the first date whose opening balance includes interest accrued
                        through the previous day. Monthly recurrence keeps the anchor
                        day, clamps in shorter months, then returns to the anchor day.
    --payment DATE AMOUNT
                        Repeatable. Payments are aggregated by date and applied at the
                        start of that day to uncapitalized interest, then capitalized
                        interest, then original principal.

Notes:
    - Dates are inclusive and the day-count basis is 365.
    - Rate changes take effect at the start of their effective date.
    - On a date carrying multiple events, the order is: rate change, payment, rest,
      then that day's accrual.
    - Full Decimal precision carries through the calculation. Currency is rounded
      half-up to cents only for display and final reported amounts.
"""

import calendar
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

DAYS_PER_YEAR = 365
CENT = Decimal("0.01")
HUNDRED = Decimal("100")
DECIMAL_DAYS_PER_YEAR = Decimal(str(DAYS_PER_YEAR))


def parse_date(s):
    parsed = datetime.strptime(s, "%Y-%m-%d").date()
    if parsed.isoformat() != s:
        raise ValueError(f"date must use YYYY-MM-DD: {s}")
    return parsed


def build_subperiods(start_date, end_date, rate_schedule):
    """
    Given the overall [start_date, end_date] (inclusive) and an ascending
    rate_schedule of {"effective_date", "rate"}, return a list of
    (period_start, period_end, rate) tuples covering the whole range, split
    at every rate-change date that falls within it.
    """
    schedule = sorted(rate_schedule, key=lambda r: r["effective_date"])

    applicable = [r for r in schedule if parse_date(r["effective_date"]) <= start_date]
    if not applicable:
        raise ValueError(
            f"No rate_schedule entry has an effective_date on or before start_date "
            f"({start_date}). The schedule must include the rate in force at the start "
            f"of the interest period."
        )

    change_dates = sorted(
        {
            parse_date(r["effective_date"])
            for r in schedule
            if start_date < parse_date(r["effective_date"]) <= end_date
        }
    )

    boundaries = [start_date] + change_dates + [end_date + timedelta(days=1)]

    subperiods = []
    for i in range(len(boundaries) - 1):
        period_start = boundaries[i]
        period_end = boundaries[i + 1] - timedelta(days=1)
        if period_end < period_start:
            continue
        current_rate = None
        for r in schedule:
            if parse_date(r["effective_date"]) <= period_start:
                current_rate = r["rate"]
            else:
                break
        if current_rate is None:
            raise ValueError(f"No applicable rate found for sub-period starting {period_start}")
        subperiods.append((period_start, period_end, current_rate))

    return subperiods


def calculate(principal, start_date, end_date, rate_schedule):
    """Original simple-interest calculation retained for legacy output."""
    if end_date < start_date:
        raise ValueError("end_date must be on or after start_date")

    subperiods = build_subperiods(start_date, end_date, rate_schedule)

    lines = []
    total_interest = 0.0
    lines.append("Principal Amount: $" + f"{principal:,.2f}")
    lines.append(f"Period: {start_date.isoformat()} to {end_date.isoformat()}")
    lines.append("")
    lines.append("Interest by Sub-Period:")
    lines.append("-" * 80)

    for period_start, period_end, rate in subperiods:
        days = (period_end - period_start).days + 1
        interest = principal * (rate / 100.0) * (days / DAYS_PER_YEAR)
        total_interest += interest
        lines.append(f"[{period_start.isoformat()} to {period_end.isoformat()}]")
        lines.append(f"  Rate: {rate:.4f}% per annum")
        lines.append(f"  Days: {days} days")
        lines.append("  Principal: $" + f"{principal:,.2f}")
        lines.append("  Interest: $" + f"{interest:,.2f}")
        lines.append("-" * 80)

    lines.append("Total Interest: $" + f"{total_interest:,.2f}")
    lines.append("Principal + Interest: $" + f"{principal + total_interest:,.2f}")

    return "\n".join(lines), total_interest


def as_decimal(value, label):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"{label} must be a valid number") from exc
    if not result.is_finite():
        raise ValueError(f"{label} must be finite")
    return result


def money(value):
    rounded = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return "$" + f"{rounded:,.2f}"


def rate_text(value):
    return format(value, "f").rstrip("0").rstrip(".") or "0"


def validate_rate_schedule(rate_schedule, start_date):
    if not isinstance(rate_schedule, list) or not rate_schedule:
        raise ValueError("rate_schedule_json must be a non-empty JSON array")

    parsed = []
    seen_dates = set()
    for index, item in enumerate(rate_schedule):
        if not isinstance(item, dict):
            raise ValueError(f"rate_schedule entry {index + 1} must be an object")
        if set(item) != {"effective_date", "rate"}:
            raise ValueError(
                f"rate_schedule entry {index + 1} must contain only effective_date and rate"
            )
        try:
            effective_date = parse_date(item["effective_date"])
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"rate_schedule entry {index + 1} has an invalid effective_date"
            ) from exc
        if effective_date in seen_dates:
            raise ValueError(
                f"duplicate rate effective_date: {effective_date.isoformat()}"
            )
        seen_dates.add(effective_date)
        rate = as_decimal(item["rate"], f"rate_schedule entry {index + 1} rate")
        parsed.append((effective_date, rate))

    parsed.sort(key=lambda entry: entry[0])
    if not any(effective_date <= start_date for effective_date, _rate in parsed):
        raise ValueError(
            "No rate_schedule entry has an effective_date on or before start_date "
            f"({start_date})"
        )
    return parsed


def parse_options(args):
    compound = "none"
    first_rest_date = None
    payments = []
    index = 0
    while index < len(args):
        option = args[index]
        if option == "--compound":
            if index + 1 >= len(args):
                raise ValueError("--compound requires none or monthly")
            compound = args[index + 1]
            if compound not in {"none", "monthly"}:
                raise ValueError("--compound must be none or monthly")
            index += 2
        elif option == "--first-rest-date":
            if index + 1 >= len(args):
                raise ValueError("--first-rest-date requires YYYY-MM-DD")
            try:
                first_rest_date = parse_date(args[index + 1])
            except ValueError as exc:
                raise ValueError("--first-rest-date must be YYYY-MM-DD") from exc
            index += 2
        elif option == "--payment":
            if index + 2 >= len(args):
                raise ValueError("--payment requires DATE AMOUNT")
            try:
                payment_date = parse_date(args[index + 1])
            except ValueError as exc:
                raise ValueError("--payment DATE must be YYYY-MM-DD") from exc
            amount = as_decimal(args[index + 2], "--payment AMOUNT")
            if amount <= 0:
                raise ValueError("--payment AMOUNT must be greater than zero")
            payments.append((payment_date, amount))
            index += 3
        else:
            raise ValueError(f"unknown option: {option}")

    return compound, first_rest_date, payments


def monthly_rest_dates(first_rest_date, end_date):
    anchor_day = first_rest_date.day
    year = first_rest_date.year
    month = first_rest_date.month
    result = []
    offset = 0
    while True:
        absolute_month = (month - 1) + offset
        candidate_year = year + absolute_month // 12
        candidate_month = absolute_month % 12 + 1
        last_day = calendar.monthrange(candidate_year, candidate_month)[1]
        candidate = first_rest_date.replace(
            year=candidate_year,
            month=candidate_month,
            day=min(anchor_day, last_day),
        )
        if candidate > end_date:
            break
        result.append(candidate)
        offset += 1
    return result


def calculate_event_ledger(
    principal,
    start_date,
    end_date,
    parsed_schedule,
    compound,
    first_rest_date,
    payments,
):
    if end_date < start_date:
        raise ValueError("end_date must be on or after start_date")
    if principal < 0:
        raise ValueError("principal must not be negative")

    if compound == "monthly":
        if first_rest_date is None:
            raise ValueError("--first-rest-date is required with --compound monthly")
        if first_rest_date <= start_date:
            raise ValueError("--first-rest-date must be after start_date")
    elif first_rest_date is not None:
        raise ValueError("--first-rest-date is allowed only with --compound monthly")

    payments_by_date = defaultdict(Decimal)
    for payment_date, amount in payments:
        if not start_date <= payment_date <= end_date:
            raise ValueError(
                "payment date must fall within the inclusive calculation period"
            )
        payments_by_date[payment_date] += amount

    rate_by_date = {
        effective_date: rate
        for effective_date, rate in parsed_schedule
        if start_date <= effective_date <= end_date
    }
    opening_rate = [
        rate for effective_date, rate in parsed_schedule if effective_date <= start_date
    ][-1]

    rest_dates = (
        set(monthly_rest_dates(first_rest_date, end_date))
        if compound == "monthly"
        else set()
    )
    event_dates = (
        {start_date, end_date + timedelta(days=1)}
        | set(rate_by_date)
        | set(payments_by_date)
        | rest_dates
    )
    ordered_dates = sorted(event_dates)

    original_principal = principal
    capitalized_interest = Decimal("0")
    accrued_interest = Decimal("0")
    total_interest = Decimal("0")
    total_payments = Decimal("0")
    paid_uncapitalized = Decimal("0")
    paid_capitalized = Decimal("0")
    paid_principal = Decimal("0")
    current_rate = opening_rate

    lines = [
        f"Starting Principal: {money(principal)}",
        f"Period: {start_date.isoformat()} to {end_date.isoformat()}",
        f"Compounding: {compound.title()}",
        f"Opening rate on {start_date.isoformat()}: {rate_text(opening_rate)}% per annum",
    ]
    if first_rest_date is not None:
        lines.append(f"First Rest Date: {first_rest_date.isoformat()}")
    if payments_by_date:
        rerun_payments = ", ".join(
            f"{date.isoformat()} {amount}" for date, amount in sorted(payments_by_date.items())
        )
        lines.append(f"Payments: {rerun_payments}")
    lines.extend(["", "Event Ledger:", "-" * 80])

    for index, event_date in enumerate(ordered_dates[:-1]):
        if event_date > end_date:
            break
        next_date = ordered_dates[index + 1]
        lines.append(f"Opening on {event_date.isoformat()}:")
        lines.append(f"  Original principal: {money(original_principal)}")
        lines.append(f"  Capitalized interest: {money(capitalized_interest)}")
        lines.append(f"  Uncapitalized interest: {money(accrued_interest)}")

        if event_date in rate_by_date:
            current_rate = rate_by_date[event_date]
            lines.append(
                f"Rate effective {event_date.isoformat()}: "
                f"{rate_text(current_rate)}% per annum"
            )

        if event_date in payments_by_date:
            payment = payments_by_date[event_date]
            outstanding = original_principal + capitalized_interest + accrued_interest
            if payment > outstanding:
                raise ValueError(
                    f"payment exceeds outstanding balance on {event_date.isoformat()}: "
                    f"{money(payment)} > {money(outstanding)}"
                )

            remaining = payment
            to_uncapitalized = min(remaining, accrued_interest)
            accrued_interest -= to_uncapitalized
            remaining -= to_uncapitalized

            to_capitalized = min(remaining, capitalized_interest)
            capitalized_interest -= to_capitalized
            remaining -= to_capitalized

            to_principal = min(remaining, original_principal)
            original_principal -= to_principal

            total_payments += payment
            paid_uncapitalized += to_uncapitalized
            paid_capitalized += to_capitalized
            paid_principal += to_principal

            lines.append(f"Payment on {event_date.isoformat()}: {money(payment)}")
            lines.append(
                f"  Applied to uncapitalized interest: {money(to_uncapitalized)}"
            )
            lines.append(f"  Applied to capitalized interest: {money(to_capitalized)}")
            lines.append(f"  Applied to original principal: {money(to_principal)}")

        if event_date in rest_dates:
            capitalization = accrued_interest
            capitalized_interest += capitalization
            accrued_interest = Decimal("0")
            lines.append(
                f"Capitalization before {event_date.isoformat()}: "
                f"{money(capitalization)}"
            )

        days = (next_date - event_date).days
        if days:
            period_end = next_date - timedelta(days=1)
            interest_bearing_balance = original_principal + capitalized_interest
            interest = (
                interest_bearing_balance
                * current_rate
                / HUNDRED
                * Decimal(days)
                / DECIMAL_DAYS_PER_YEAR
            )
            accrued_interest += interest
            total_interest += interest
            lines.append(
                f"Accrual [{event_date.isoformat()} to {period_end.isoformat()}]"
            )
            lines.append(f"  Rate: {rate_text(current_rate)}% per annum")
            lines.append(f"  Inclusive Days: {days} days")
            lines.append(
                f"  Interest-bearing balance: {money(interest_bearing_balance)}"
            )
            lines.append(f"  Interest accrued: {money(interest)}")
        lines.append(
            "  Closing balance: "
            + money(original_principal + capitalized_interest + accrued_interest)
        )
        lines.append("-" * 80)

    ending_balance = original_principal + capitalized_interest + accrued_interest
    lines.extend(
        [
            f"Total Interest Accrued: {money(total_interest)}",
            f"Total Payments: {money(total_payments)}",
            f"  Paid uncapitalized interest: {money(paid_uncapitalized)}",
            f"  Paid capitalized interest: {money(paid_capitalized)}",
            f"  Paid original principal: {money(paid_principal)}",
            f"Remaining Original Principal: {money(original_principal)}",
            f"Remaining Capitalized Interest: {money(capitalized_interest)}",
            f"Remaining Uncapitalized Interest: {money(accrued_interest)}",
            f"Ending Balance: {money(ending_balance)}",
        ]
    )
    return "\n".join(lines)


def fail(message):
    print(f"Error: {message}")
    sys.exit(1)


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)

    try:
        principal_text = sys.argv[1]
        start_date = parse_date(sys.argv[2])
        end_date = parse_date(sys.argv[3])
        rate_schedule = json.loads(sys.argv[4])
        parsed_schedule = validate_rate_schedule(rate_schedule, start_date)
        compound, first_rest_date, payments = parse_options(sys.argv[5:])
        principal_decimal = as_decimal(principal_text, "principal")
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        fail(str(exc))

    if not sys.argv[5:]:
        try:
            output, _total = calculate(
                float(principal_text), start_date, end_date, rate_schedule
            )
        except ValueError as exc:
            fail(str(exc))
        print(output)
        return

    try:
        output = calculate_event_ledger(
            principal_decimal,
            start_date,
            end_date,
            parsed_schedule,
            compound,
            first_rest_date,
            payments,
        )
    except ValueError as exc:
        fail(str(exc))
    print(output)


if __name__ == "__main__":
    main()
