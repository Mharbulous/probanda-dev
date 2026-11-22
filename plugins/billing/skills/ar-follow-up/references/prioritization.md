# AR Follow-Up — Prioritization & Formatting Reference

## Composite-Key Sorting

Assign each client a `(tier, sort_key_1, sort_key_2)` tuple and sort once. A single `sorted()` call produces the final ranked list without multi-pass sorting:

```python
def priority_key(client):
    if client["nearest_court_days"] is not None and client["nearest_court_days"] <= 30 and client["shortfall"] > 0:
        return (1, client["nearest_court_days"], -client["total_ask"])
    elif client["nearest_court_days"] is not None and client["nearest_court_days"] <= 120 and client["shortfall"] > 0:
        return (2, client["nearest_court_days"], -client["total_ask"])
    elif client["trust_balance"] == 0:
        return (3, -client["total_ask"], 0)
    elif client["shortfall"] > 0:
        return (4, -client["shortfall_pct"], 0)
    elif client["wip_amount"] > 0:
        return (5, -client["wip_amount"], 0)
    else:
        return (6, -client["invoice_age_days"], 0)

ranked = sorted(clients_with_amounts, key=priority_key)
```

## Single-Client WIP Cutoff Line Variations

When `cutoff_source` is `issue_date` or the matter has no invoices on record, format the WIP line as:

```text
Unbilled WIP:             CAD 2,400.00 (12.0 hrs @ CAD 200/hr, since 2026-03-01)
                          Cutoff based on invoice issue date — actual billing period end may differ.
Unbilled WIP:             CAD 2,400.00 (12.0 hrs @ CAD 200/hr; no invoices on record, all time shown)
```
