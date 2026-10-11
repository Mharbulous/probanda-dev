# BC Court Interest Rates Reference

## Official Source

The official BC Court interest rates are published at:
https://www.bccourts.ca/supreme_court/about_the_supreme_court/Court_Order_Interest_Rates.aspx

**IMPORTANT:** This reference file should be updated periodically (every 6 months) by fetching the latest rates from the official source using web_fetch tool.

## Current Interest Rates (2023-2025)

These rates are used for both pre-judgment and post-judgment interest calculations.

| Period Start | Period End | Pre-Judgment Rate | Post-Judgment Rate |
|--------------|------------|-------------------|---------------------|
| Jan 1, 2023 | June 30, 2023 | 4.45% | 6.45% |
| July 1, 2023 | Dec 31, 2023 | 4.95% | 6.95% |
| Jan 1, 2024 | June 30, 2024 | 5.20% | 7.20% |
| July 1, 2024 | Dec 31, 2024 | 4.95% | 6.95% |
| Jan 1, 2025 | June 30, 2025 | 3.45% | 5.45% |
| July 1, 2025 | Dec 31, 2025 | 2.95% | 4.95% |

## Interest Rate Periods

Interest rates in BC are set by regulation and change semi-annually in **6-month periods**:

- **January 1 to June 30** (first half of each year)
- **July 1 to December 31** (second half of each year)

Each period has separate rates for prejudgment and postjudgment interest (postjudgment rates are typically 2% higher than prejudgment rates).

## Simple Interest (Not Compound)

**Court order interest is calculated using simple interest, not compound interest.** This means:

- Interest accrued is **not** added to the principal for subsequent calculations
- Only the base principal amount (plus special damages) earns interest
- Interest accumulates linearly over time

The formula for each interest period is:

```
Interest = Principal × (Rate / 100) × (Days in Period / Days in Year)
```

## Leap Years

- 2024 was a leap year (366 days)
- 2025 is not a leap year (365 days)
- When calculating interest, use the appropriate days per year for accuracy

## Special Damages Treatment

Special damages are out-of-pocket expenses (medical bills, prescriptions, physiotherapy, etc.) with specific dates and amounts. They are treated differently depending on when they occur:

### During Regular Interest Periods

- Special damages are **added to the principal** as they occur
- The increased principal is used for calculating interest in subsequent periods
- Example: If a $500 physiotherapy bill occurs on March 1, 2023, then starting March 1, 2023, the principal increases by $500 for all future interest calculations

### In the Final Period Before Judgment (Prejudgment Only)

Special damages occurring in the **final interest rate period before the judgment date** receive special treatment:

- Each special damage in the final period has its **interest calculated individually**
- Interest is calculated from the damage date to the day before judgment
- This ensures each expense earns the correct amount of interest based on when it was actually incurred
- Example: A $300 expense on April 1, 2023 with judgment on May 1, 2023 earns interest for exactly 30 days

### Postjudgment Interest

For postjudgment interest:

- All special damages are simply added to the judgment total
- No separate calculation is performed
- They become part of the base principal earning postjudgment interest

## Calculation Process

### 1. Prejudgment Interest (if applicable)

- Calculated from the prejudgment start date to the day before judgment
- Based on the pecuniary damages amount
- Special damages are incorporated as they occur
- Final period special damages calculated individually

### 2. Judgment Total

Judgment Total = Pecuniary damages + Prejudgment interest + Non-pecuniary damages + Costs + Special damages

### 3. Postjudgment Interest (if applicable)

- Calculated from judgment date to the accrual date
- Based on the total judgment amount
- Uses postjudgment interest rates (typically 2% higher)

## Example Calculation

**Scenario**: $10,000 award with judgment on May 1, 2023, special damage of $300 on April 1, 2023, rate 4.45%

**Prejudgment Calculation**:
- Base amount: $10,000 × 4.45% × (90 days / 365) = $109.93
- Special damage: $300 × 4.45% × (30 days / 365) = $1.10
- **Total Prejudgment Interest**: $111.03

**Judgment Total**: $10,000 + $300 + $111.03 = $10,411.03

**Postjudgment**: Based on $10,411.03 at postjudgment rates

## Multiple Rate Periods

When calculating interest across multiple rate periods:

1. Break the calculation into separate periods based on rate changes
2. Calculate interest for each period separately
3. Sum all period interests to get total interest

Example: Interest from Sept 1, 2023 to March 15, 2024 would involve:
- Period 1: Sept 1 - Dec 31, 2023 (rate 6.95%, 365 days in year)
- Period 2: Jan 1 - March 15, 2024 (rate 7.20%, 366 days in year)

## Pre-Judgment vs Post-Judgment

- **Pre-Judgment Interest**: Interest that accrues from the date of loss to the day before judgment
- **Post-Judgment Interest**: Interest that accrues from the date of judgment until payment

The rates are different for each type, so always specify which type of interest is being calculated.

## Updating This Reference

To update this reference with the latest rates:

1. Use web_fetch to retrieve: https://www.bccourts.ca/supreme_court/about_the_supreme_court/Court_Order_Interest_Rates.aspx
2. Extract the current rates from the table
3. Update this reference file with new rates
4. Update the INTEREST_RATES constant in both:
   - subskills/court-interest-calculator/scripts/calculate_interest.py
   - subskills/court-interest-calculator/scripts/calculate_interest_advanced.py
5. Test the calculations with a known example to ensure accuracy

## Updating This Reference

To update this reference with the latest rates:

1. Use web_fetch to retrieve: https://www.bccourts.ca/supreme_court/about_the_supreme_court/Court_Order_Interest_Rates.aspx
2. Extract the current rates from the table
3. Update this reference file with new rates
4. Update the INTEREST_RATES constant in subskills/court-interest-calculator/scripts/calculate_interest.py
5. Test the calculation with a known example to ensure accuracy
