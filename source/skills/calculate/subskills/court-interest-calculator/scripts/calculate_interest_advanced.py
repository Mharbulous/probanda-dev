#!/usr/bin/env python3
"""
Calculate BC Court Interest with Special Damages Support
Computes pre-judgment or post-judgment interest based on BC Court interest rates.
Handles special damages according to BC rules.
"""

import sys
import json
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Tuple, Dict

# Interest rate periods from BC Courts
# Format: (start_date, end_date, pre_judgment_rate, post_judgment_rate, days_in_year)
INTEREST_RATES = [
    (date(2023, 1, 1), date(2023, 6, 30), Decimal('4.45'), Decimal('6.45'), 365),
    (date(2023, 7, 1), date(2023, 12, 31), Decimal('4.95'), Decimal('6.95'), 365),
    (date(2024, 1, 1), date(2024, 6, 30), Decimal('5.20'), Decimal('7.20'), 366),
    (date(2024, 7, 1), date(2024, 12, 31), Decimal('4.95'), Decimal('6.95'), 366),
    (date(2025, 1, 1), date(2025, 6, 30), Decimal('3.45'), Decimal('5.45'), 365),
    (date(2025, 7, 1), date(2025, 12, 31), Decimal('2.95'), Decimal('4.95'), 365),
]

def parse_date(date_str: str) -> date:
    """Parse date string in YYYY-MM-DD format."""
    return datetime.strptime(date_str, '%Y-%m-%d').date()

def get_rate_for_period(period_start: date, period_end: date, rate_type: str) -> Tuple[Decimal, int]:
    """Get the applicable rate for a given period."""
    for start, end, pre_rate, post_rate, days_in_year in INTEREST_RATES:
        if start <= period_start and period_end <= end:
            rate = post_rate if rate_type == 'post-judgment' else pre_rate
            return rate, days_in_year
    raise ValueError(f"No rate found for period {period_start} to {period_end}")

def calculate_basic_interest(principal: Decimal, start: date, end: date, rate_type: str = 'post-judgment') -> dict:
    """
    Calculate basic interest without special damages.
    This is the simple case used for post-judgment interest or pre-judgment without special damages.
    """
    periods = []
    total_interest = Decimal('0')
    
    # Find all rate periods that overlap with our date range
    current_date = start
    
    for rate_start, rate_end, pre_rate, post_rate, days_in_year in INTEREST_RATES:
        if current_date > end:
            break
            
        # Check if this rate period overlaps with our calculation period
        if rate_start <= end and rate_end >= current_date:
            period_start = max(current_date, rate_start)
            period_end = min(end, rate_end)
            
            rate = post_rate if rate_type == 'post-judgment' else pre_rate
            days = (period_end - period_start).days + 1
            
            interest = (principal * rate / Decimal('100') * Decimal(str(days)) / Decimal(str(days_in_year))).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP
            )
            
            total_interest += interest
            periods.append({
                'start_date': period_start.isoformat(),
                'end_date': period_end.isoformat(),
                'rate': float(rate),
                'days': days,
                'principal': float(principal),
                'interest': float(interest)
            })
            
            current_date = period_end + timedelta(days=1)
    
    return {
        'principal': float(principal),
        'start_date': start.isoformat(),
        'end_date': end.isoformat(),
        'rate_type': rate_type,
        'total_interest': float(total_interest),
        'total_amount': float(principal + total_interest),
        'periods': periods
    }

def calculate_prejudgment_with_special_damages(
    base_principal: Decimal,
    start_date: date,
    judgment_date: date,
    special_damages: List[Dict[str, any]]
) -> dict:
    """
    Calculate pre-judgment interest with special damages.
    Special damages in final period are calculated individually.
    
    Args:
        base_principal: Base pecuniary damages amount
        start_date: Start date for prejudgment interest
        judgment_date: Date of judgment
        special_damages: List of dicts with 'date' (YYYY-MM-DD) and 'amount' (float)
    """
    # Sort special damages by date
    sorted_damages = sorted(special_damages, key=lambda x: parse_date(x['date']))
    
    # Find the final rate period before judgment
    final_period_start = None
    final_period_end = None
    for rate_start, rate_end, _, _, _ in INTEREST_RATES:
        if rate_start <= judgment_date <= rate_end:
            final_period_start = rate_start
            final_period_end = rate_end
            break
    
    if not final_period_start:
        raise ValueError(f"No rate period found for judgment date {judgment_date}")
    
    # Separate damages into regular periods and final period
    regular_damages = []
    final_period_damages = []
    
    for damage in sorted_damages:
        damage_date = parse_date(damage['date'])
        if damage_date < final_period_start:
            regular_damages.append({'date': damage_date, 'amount': Decimal(str(damage['amount']))})
        else:
            final_period_damages.append({'date': damage_date, 'amount': Decimal(str(damage['amount']))})
    
    # Calculate interest for regular periods (damages added to principal)
    current_principal = base_principal
    current_date = start_date
    total_interest = Decimal('0')
    periods = []
    
    for rate_start, rate_end, pre_rate, _, days_in_year in INTEREST_RATES:
        if current_date >= final_period_start:
            break
            
        if rate_start <= current_date:
            continue
            
        period_start = max(current_date, rate_start)
        period_end = min(final_period_start - timedelta(days=1), rate_end)
        
        if period_start > period_end:
            continue
        
        # Add any damages that occur at the start of this period
        damages_this_period = [d for d in regular_damages if d['date'] == period_start]
        for damage in damages_this_period:
            current_principal += damage['amount']
        
        days = (period_end - period_start).days + 1
        interest = (current_principal * pre_rate / Decimal('100') * Decimal(str(days)) / Decimal(str(days_in_year))).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )
        
        total_interest += interest
        periods.append({
            'start_date': period_start.isoformat(),
            'end_date': period_end.isoformat(),
            'rate': float(pre_rate),
            'days': days,
            'principal': float(current_principal),
            'interest': float(interest),
            'note': 'Regular period'
        })
        
        current_date = period_end + timedelta(days=1)
    
    # Calculate interest for final period (base principal only, damages calculated individually)
    final_period_rate, days_in_year = get_rate_for_period(final_period_start, judgment_date, 'pre-judgment')
    
    # Base principal for final period (includes all regular damages)
    final_principal = current_principal
    day_before_judgment = judgment_date - timedelta(days=1)
    days = (day_before_judgment - max(current_date, final_period_start)).days + 1
    
    if days > 0:
        base_interest = (final_principal * final_period_rate / Decimal('100') * Decimal(str(days)) / Decimal(str(days_in_year))).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )
        total_interest += base_interest
        
        periods.append({
            'start_date': max(current_date, final_period_start).isoformat(),
            'end_date': day_before_judgment.isoformat(),
            'rate': float(final_period_rate),
            'days': days,
            'principal': float(final_principal),
            'interest': float(base_interest),
            'note': 'Final period - base principal'
        })
    
    # Calculate interest for each special damage in final period individually
    final_damages_detail = []
    for damage in final_period_damages:
        damage_date = damage['date']
        days_to_judgment = (day_before_judgment - damage_date).days + 1
        
        if days_to_judgment > 0:
            damage_interest = (damage['amount'] * final_period_rate / Decimal('100') * Decimal(str(days_to_judgment)) / Decimal(str(days_in_year))).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP
            )
            total_interest += damage_interest
            
            final_damages_detail.append({
                'date': damage_date.isoformat(),
                'amount': float(damage['amount']),
                'days': days_to_judgment,
                'interest': float(damage_interest)
            })
    
    if final_damages_detail:
        periods.append({
            'note': 'Final period - special damages (calculated individually)',
            'special_damages': final_damages_detail,
            'total_special_damages_interest': float(sum(Decimal(str(d['interest'])) for d in final_damages_detail))
        })
    
    # Calculate totals
    total_special_damages = sum(d['amount'] for d in sorted_damages)
    
    return {
        'base_principal': float(base_principal),
        'special_damages_total': float(total_special_damages),
        'start_date': start_date.isoformat(),
        'judgment_date': judgment_date.isoformat(),
        'rate_type': 'pre-judgment',
        'total_interest': float(total_interest),
        'judgment_total': float(base_principal + total_special_damages + total_interest),
        'periods': periods,
        'special_damages_detail': [
            {'date': d['date'], 'amount': float(d['amount'])} for d in sorted_damages
        ]
    }

def format_basic_result(result: dict) -> str:
    """Format basic calculation result for display."""
    output = []
    output.append(f"Principal Amount: ${result['principal']:,.2f}")
    output.append(f"Period: {result['start_date']} to {result['end_date']}")
    output.append(f"Interest Type: {result['rate_type'].replace('-', ' ').title()}")
    output.append("")
    output.append("Interest by Period:")
    output.append("-" * 80)
    
    for period in result['periods']:
        output.append(f"{period['start_date']} to {period['end_date']}")
        output.append(f"  Rate: {period['rate']}% per annum")
        output.append(f"  Days: {period['days']} days")
        output.append(f"  Principal: ${period['principal']:,.2f}")
        output.append(f"  Interest: ${period['interest']:,.2f}")
        output.append("")
    
    output.append("-" * 80)
    output.append(f"Total Interest: ${result['total_interest']:,.2f}")
    output.append(f"Principal + Interest: ${result['total_amount']:,.2f}")
    
    return "\n".join(output)

def format_prejudgment_with_damages_result(result: dict) -> str:
    """Format prejudgment with special damages result for display."""
    output = []
    output.append("PREJUDGMENT INTEREST CALCULATION WITH SPECIAL DAMAGES")
    output.append("=" * 80)
    output.append(f"Base Principal (Pecuniary Damages): ${result['base_principal']:,.2f}")
    output.append(f"Total Special Damages: ${result['special_damages_total']:,.2f}")
    output.append(f"Period: {result['start_date']} to {result['judgment_date']} (day before judgment)")
    output.append("")
    
    if result['special_damages_detail']:
        output.append("Special Damages:")
        for damage in result['special_damages_detail']:
            output.append(f"  {damage['date']}: ${damage['amount']:,.2f}")
        output.append("")
    
    output.append("Interest Calculation:")
    output.append("-" * 80)
    
    for period in result['periods']:
        if 'special_damages' in period:
            output.append(f"{period['note']}:")
            for damage in period['special_damages']:
                output.append(f"  {damage['date']}: ${damage['amount']:,.2f}")
                output.append(f"    Days to judgment: {damage['days']}")
                output.append(f"    Interest: ${damage['interest']:,.2f}")
            output.append(f"  Total: ${period['total_special_damages_interest']:,.2f}")
        else:
            output.append(f"{period['start_date']} to {period['end_date']}")
            output.append(f"  {period['note']}")
            output.append(f"  Rate: {period['rate']}% per annum")
            output.append(f"  Days: {period['days']} days")
            output.append(f"  Principal: ${period['principal']:,.2f}")
            output.append(f"  Interest: ${period['interest']:,.2f}")
        output.append("")
    
    output.append("-" * 80)
    output.append(f"Total Prejudgment Interest: ${result['total_interest']:,.2f}")
    output.append(f"JUDGMENT TOTAL: ${result['judgment_total']:,.2f}")
    output.append(f"  (Base: ${result['base_principal']:,.2f} + Special Damages: ${result['special_damages_total']:,.2f} + Interest: ${result['total_interest']:,.2f})")
    
    return "\n".join(output)

def main():
    """Main entry point for command-line usage."""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Basic: calculate_interest.py <principal> <start_date> <end_date> [rate_type]")
        print("  With special damages: calculate_interest.py --prejudgment <principal> <start_date> <judgment_date> <damages_json>")
        print("")
        print("Examples:")
        print("  calculate_interest.py 219800.00 2023-09-01 2025-12-12 post-judgment")
        print('  calculate_interest.py --prejudgment 10000 2023-01-01 2023-05-01 \'[{"date":"2023-04-01","amount":300}]\'')
        sys.exit(1)
    
    if sys.argv[1] == '--prejudgment':
        # Prejudgment with special damages
        if len(sys.argv) < 6:
            print("Error: --prejudgment requires: <principal> <start_date> <judgment_date> <damages_json>")
            sys.exit(1)
        
        principal = Decimal(sys.argv[2])
        start_date = parse_date(sys.argv[3])
        judgment_date = parse_date(sys.argv[4])
        damages_json = sys.argv[5]
        
        try:
            special_damages = json.loads(damages_json)
        except json.JSONDecodeError as e:
            print(f"Error parsing damages JSON: {e}")
            sys.exit(1)
        
        result = calculate_prejudgment_with_special_damages(principal, start_date, judgment_date, special_damages)
        print(format_prejudgment_with_damages_result(result))
    else:
        # Basic interest calculation
        if len(sys.argv) < 4:
            print("Error: Basic calculation requires: <principal> <start_date> <end_date> [rate_type]")
            sys.exit(1)
        
        principal = Decimal(sys.argv[1])
        start_date = parse_date(sys.argv[2])
        end_date = parse_date(sys.argv[3])
        rate_type = sys.argv[4] if len(sys.argv) > 4 else 'post-judgment'
        
        result = calculate_basic_interest(principal, start_date, end_date, rate_type)
        print(format_basic_result(result))

if __name__ == '__main__':
    main()
