#!/usr/bin/env python3
"""
Calculate BC Court Interest
Computes pre-judgment or post-judgment interest based on BC Court interest rates.
"""

import sys
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Tuple

# Interest rate periods from BC Courts
# Format: (start_date, end_date, rate, days_in_year)
INTEREST_RATES = [
    (date(2023, 1, 1), date(2023, 6, 30), Decimal('6.45'), 365),
    (date(2023, 7, 1), date(2023, 12, 31), Decimal('6.95'), 365),
    (date(2024, 1, 1), date(2024, 6, 30), Decimal('7.20'), 366),
    (date(2024, 7, 1), date(2024, 12, 31), Decimal('6.95'), 366),
    (date(2025, 1, 1), date(2025, 6, 30), Decimal('5.45'), 365),
    (date(2025, 7, 1), date(2025, 12, 31), Decimal('4.95'), 365),
]

def parse_date(date_str: str) -> date:
    """Parse date string in YYYY-MM-DD format."""
    return datetime.strptime(date_str, '%Y-%m-%d').date()

def get_applicable_rates(start: date, end: date, rate_type: str) -> List[Tuple[date, date, Decimal, int]]:
    """Get applicable interest rate periods for the given date range."""
    applicable = []
    for period_start, period_end, rate, days_in_year in INTEREST_RATES:
        # Check if period overlaps with our date range
        if period_start <= end and period_end >= start:
            # Calculate actual overlap
            overlap_start = max(start, period_start)
            overlap_end = min(end, period_end)
            applicable.append((overlap_start, overlap_end, rate, days_in_year))
    return applicable

def calculate_interest(principal: Decimal, start: date, end: date, rate_type: str = 'post-judgment') -> dict:
    """
    Calculate interest on a principal amount.
    
    Args:
        principal: Principal amount
        start: Start date for interest calculation
        end: End date for interest calculation
        rate_type: 'pre-judgment' or 'post-judgment' (default)
    
    Returns:
        Dictionary with calculation details
    """
    periods = get_applicable_rates(start, end, rate_type)
    
    if not periods:
        return {
            'principal': principal,
            'start_date': start,
            'end_date': end,
            'rate_type': rate_type,
            'total_interest': Decimal('0'),
            'total_amount': principal,
            'periods': [],
            'error': f'No interest rates found for period {start} to {end}'
        }
    
    total_interest = Decimal('0')
    period_details = []
    
    for period_start, period_end, rate, days_in_year in periods:
        days = (period_end - period_start).days + 1
        interest = (principal * rate / Decimal('100') * Decimal(str(days)) / Decimal(str(days_in_year))).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )
        total_interest += interest
        
        period_details.append({
            'start_date': period_start.isoformat(),
            'end_date': period_end.isoformat(),
            'rate': float(rate),
            'days': days,
            'interest': float(interest)
        })
    
    return {
        'principal': float(principal),
        'start_date': start.isoformat(),
        'end_date': end.isoformat(),
        'rate_type': rate_type,
        'total_interest': float(total_interest),
        'total_amount': float(principal + total_interest),
        'periods': period_details
    }

def format_result(result: dict) -> str:
    """Format calculation result for display."""
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
        output.append(f"  Interest: ${period['interest']:,.2f}")
        output.append("")
    
    output.append("-" * 80)
    output.append(f"Total Interest: ${result['total_interest']:,.2f}")
    output.append(f"Principal + Interest: ${result['total_amount']:,.2f}")
    
    if 'error' in result:
        output.append("")
        output.append(f"WARNING: {result['error']}")
    
    return "\n".join(output)

def main():
    """Main entry point for command-line usage."""
    if len(sys.argv) < 4:
        print("Usage: calculate_interest.py <principal> <start_date> <end_date> [rate_type]")
        print("  principal: Amount (e.g., 219800.00)")
        print("  start_date: Start date in YYYY-MM-DD format")
        print("  end_date: End date in YYYY-MM-DD format")
        print("  rate_type: 'pre-judgment' or 'post-judgment' (optional, default: post-judgment)")
        sys.exit(1)
    
    principal = Decimal(sys.argv[1])
    start_date = parse_date(sys.argv[2])
    end_date = parse_date(sys.argv[3])
    rate_type = sys.argv[4] if len(sys.argv) > 4 else 'post-judgment'
    
    result = calculate_interest(principal, start_date, end_date, rate_type)
    print(format_result(result))

if __name__ == '__main__':
    main()
