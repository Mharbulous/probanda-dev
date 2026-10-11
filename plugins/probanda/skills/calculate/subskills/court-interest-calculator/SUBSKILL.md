---
name: court-interest-calculator
description: Use for BC Court pre/post-judgment interest calculations, including with special damages. Trigger when asked to calculate court interest, interest on a judgment, or about BC Court interest rates.
---

# Court Interest Calculator

Calculate pre-judgment and post-judgment interest for BC Court matters using official BC Court interest rates, with full support for special damages treatment according to BC rules.

## When to Use

This skill automatically triggers when:
- Calculating interest on judgment amounts or damage awards
- Computing post-judgment interest from judgment date to present
- Computing pre-judgment interest from loss date to judgment date
- Calculating interest with special damages (medical bills, prescriptions, etc.)
- Questions about BC Court interest rates or calculation methodology
- Working on any BC Court matter requiring interest calculations

## Quick Start

### Basic Interest Calculation (No Special Damages)

Use the basic script for simple interest calculations:

```bash
python3 subskills/court-interest-calculator/scripts/calculate_interest.py <principal> <start_date> <end_date> [rate_type]
```

**Parameters:**
- `principal`: Amount in dollars (e.g., 219800.00)
- `start_date`: Start date in YYYY-MM-DD format
- `end_date`: End date in YYYY-MM-DD format
- `rate_type`: 'pre-judgment' or 'post-judgment' (optional, defaults to 'post-judgment')

**Example:**
```bash
python3 subskills/court-interest-calculator/scripts/calculate_interest.py 219800.00 2023-09-01 2025-12-12 post-judgment
```

### Prejudgment Interest with Special Damages

Use the advanced script when special damages are involved:

```bash
python3 subskills/court-interest-calculator/scripts/calculate_interest_advanced.py --prejudgment <principal> <start_date> <judgment_date> '<damages_json>'
```

**Parameters:**
- `principal`: Base pecuniary damages amount
- `start_date`: Start date for prejudgment interest (YYYY-MM-DD)
- `judgment_date`: Date of judgment (YYYY-MM-DD)
- `damages_json`: JSON array of special damages: `[{"date":"YYYY-MM-DD","amount":float}]`

**Example:**
```bash
python3 subskills/court-interest-calculator/scripts/calculate_interest_advanced.py --prejudgment 10000 2023-01-01 2023-05-01 '[{"date":"2023-04-01","amount":300}]'
```

## Understanding Special Damages

### What Are Special Damages?

Special damages are out-of-pocket expenses with specific dates and amounts:
- Medical bills
- Prescriptions
- Physiotherapy
- Other documented expenses

### How Special Damages Are Treated

BC Courts treat special damages differently depending on when they occur:

#### 1. Regular Periods (Before Final Period)

- Special damages are **added to the principal** as they occur
- The increased principal earns interest in all subsequent periods
- Example: $500 physiotherapy on March 1 increases principal by $500 from March 1 onward

#### 2. Final Period Before Judgment

- Each special damage in the final rate period is **calculated individually**
- Interest runs from the damage date to the day before judgment
- This ensures each expense earns interest based on when it was actually incurred

#### 3. Postjudgment Interest

- All special damages are simply added to the judgment total
- They become part of the base principal earning postjudgment interest
- No separate calculation needed

### Example Workflow

**Scenario**: $50,000 pecuniary damages, judgment on July 15, 2024, prejudgment interest from Jan 1, 2023

**Special damages:**
- Feb 1, 2023: $200 (physiotherapy)
- May 15, 2023: $500 (medical equipment)
- July 5, 2024: $300 (prescription)

**Calculation approach:**
1. Feb 1 and May 15 damages: Added to principal as they occur (regular periods)
2. July 5 damage: Calculated individually (final period before judgment)
3. Use advanced script:

```bash
python3 subskills/court-interest-calculator/scripts/calculate_interest_advanced.py --prejudgment 50000 2023-01-01 2024-07-15 \
'[{"date":"2023-02-01","amount":200},{"date":"2023-05-15","amount":500},{"date":"2024-07-05","amount":300}]'
```

## Important Notes

### Interest Calculation Rules

**Simple Interest (Not Compound)**
- Interest accrued is NOT added to principal for subsequent calculations
- Only the base principal (plus special damages) earns interest
- Interest accumulates linearly

**6-Month Rate Periods**
- Rates change January 1 and July 1 each year
- Pre-judgment rates are typically 2% lower than post-judgment rates
- Always check for rate updates if calculating beyond current period

**Leap Years**
- 2024 is a leap year (366 days)
- 2025 is not a leap year (365 days)
- The script automatically uses correct days per year

### Interest Rate Updates

BC Court interest rates change every 6 months. To ensure accuracy:

1. Check if current date is beyond the latest rate period in the scripts
2. If yes, fetch latest rates: `web_fetch https://www.bccourts.ca/supreme_court/about_the_supreme_court/Court_Order_Interest_Rates.aspx`
3. Update both scripts and `references/bc_court_rates.md`
4. Inform user that rates were updated

### Pre-Judgment vs Post-Judgment

**Pre-Judgment Interest:**
- From date of loss to the day before judgment
- Lower rate (typically 2% less than post-judgment)
- Special damages treatment applies

**Post-Judgment Interest:**
- From judgment date to date of payment
- Higher rate
- Applied to total judgment amount (all damages + prejudgment interest + costs)

## Output Format

### Basic Calculation Output

```
Principal Amount: $XXX,XXX.XX
Period: YYYY-MM-DD to YYYY-MM-DD

Interest by Period:
--------------------------------------------------------------------------------
[Date Range]
  Rate: X.XX% per annum
  Days: XXX days
  Principal: $XXX,XXX.XX
  Interest: $X,XXX.XX
--------------------------------------------------------------------------------
Total Interest: $XX,XXX.XX
Principal + Interest: $XXX,XXX.XX
```

### With Special Damages Output

```
PREJUDGMENT INTEREST CALCULATION WITH SPECIAL DAMAGES
================================================================================
Base Principal (Pecuniary Damages): $XX,XXX.XX
Total Special Damages: $X,XXX.XX
Period: YYYY-MM-DD to YYYY-MM-DD (day before judgment)

Special Damages:
  YYYY-MM-DD: $XXX.XX
  [...]

Interest Calculation:
--------------------------------------------------------------------------------
[Regular periods with adjusted principal]
[Final period - base principal]
[Final period - special damages calculated individually]
--------------------------------------------------------------------------------
Total Prejudgment Interest: $X,XXX.XX
JUDGMENT TOTAL: $XX,XXX.XX
```

## Common Use Cases

### Post-Judgment Interest on Full Judgment

```bash
python3 subskills/court-interest-calculator/scripts/calculate_interest.py [judgment_amount] [judgment_date] [current_date] post-judgment
```

### Pre-Judgment Interest Without Special Damages

```bash
python3 subskills/court-interest-calculator/scripts/calculate_interest.py [pecuniary_damages] [loss_date] [day_before_judgment] pre-judgment
```

### Pre-Judgment Interest With Special Damages

```bash
python3 subskills/court-interest-calculator/scripts/calculate_interest_advanced.py --prejudgment [base_damages] [start_date] [judgment_date] '[{"date":"YYYY-MM-DD","amount":XXX}]'
```

### Calculating Client's Proportional Share

When client has partial interest (e.g., 2/10 of property value):

1. Calculate client's share: `Share = Total_Value × Fraction`
2. Use appropriate script for interest calculation on share amount

### Complete Judgment Calculation

For a full judgment calculation with special damages:

1. Calculate prejudgment interest (including special damages)
2. Add: Base damages + Special damages + Prejudgment interest + Non-pecuniary damages + Costs = Judgment Total
3. Calculate postjudgment interest on Judgment Total

## Troubleshooting

**"No interest rates found for period"**
- The date range extends beyond available rates in the script
- Fetch updated rates from BC Courts website
- Update both scripts and reference file

**Special damages not calculating correctly**
- Verify you're using the advanced script (calculate_interest_advanced.py)
- Check JSON format: `[{"date":"YYYY-MM-DD","amount":123.45}]`
- Ensure dates are in YYYY-MM-DD format
- Verify judgment date is after all special damage dates

**Calculation seems incorrect**
- Verify leap year status (2024 = 366 days, 2025 = 365 days)
- Ensure correct rate type (pre vs post-judgment)
- Check that rate periods align correctly
- For prejudgment: ensure using day BEFORE judgment

## References

See `references/bc_court_rates.md` for:
- Complete rate table (2023-2025)
- Official source URL
- Detailed calculation methodology with examples
- Special damages treatment explanation
- Instructions for updating rates
