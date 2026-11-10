# `fill_boc.py` context JSON schema

`boc-context.json` is written by `/calculate`'s `calculate-boc` and consumed by
`subskills/publish-boc/scripts/fill_boc.py` through `--context`. This file is the schema's single
source of truth; `calculate-boc` cites this path rather than restating it.

```json
{
  "court_file_number": "S-241171",
  "registry": "Vancouver",
  "originating_party": "FULL NAME IN CAPS",
  "originating_party_role": "PLAINTIFF",
  "responding_party": "FULL NAME IN CAPS",
  "responding_party_role": "DEFENDANT",
  "party_claiming_costs": "Descriptive name of claiming party",
  "costs_scale": "Scale B",
  "unit_value": "$110.00",
  "costs_order": "Order reference or leave-blank text",
  "costs_terms": "Quoted costs terms or leave-blank text",
  "tariff_items": [
    { "no": "1", "description": "...", "units_claimed": "3" },
    { "no": "26(b)", "description": "...", "units_claimed": "2.5" }
  ],
  "total_units": "17.5",
  "fees_subtotal": "$1,925.00",
  "fees_gst": "$96.25",
  "fees_pst": "$134.75",
  "fees_taxes": "$231.00",
  "disbursements": {
    "filing_fees":   [{ "date": "26 February 2024", "description": "...", "amount": "7.00", "gst": "0.00", "claimed": "$7.00" }],
    "transcripts":   [],
    "expert_fees":   [],
    "photocopying":  [],
    "search_fees":   [],
    "travel":        [],
    "other":         []
  },
  "disb_subtotals": {
    "filing_fees": "$14.00",
    "transcripts": "", "expert_fees": "", "photocopying": "",
    "search_fees": "", "travel": "", "other": ""
  },
  "disb_total": "$14.00",
  "fees_total": "$2,156.00",
  "grand_total": "$2,170.00",
  "notes": "",
  "notes_footer": ""
}
```

## Key behaviours

- **Tariff rows expanded.** The template's single
  `[ITEM NO.] / [ITEM DESCRIPTION] / [UNITS CLAIMED]` row is duplicated for each
  entry in `tariff_items`. The Allowed column is left blank throughout — the
  registrar fills it.
- **Empty disbursement categories collapse to N/A.** For a category whose list is
  empty, the script replaces the header, column-label, data and subtotal rows with
  the category title row plus one row reading "N/A", so the output carries no blank
  table sections.
- **No styling embellishments.** The script changes no cell shading, border, font
  or colour beyond what is in `subskills/publish-boc/templates/062-boc.dotx`. It
  substitutes text only.
- **Allowed columns cleared.** Every `[*_ALLOWED]` placeholder is set to the empty
  string.

## Programmatic scalars

| Placeholder | Template context | Source |
|-------------|-----------------|--------|
| `[COURT FILE NUMBER]` | `No. [COURT FILE NUMBER]` | state file header |
| `[REGISTRY]` | `[REGISTRY] Registry` | state file header |
| `[ORIGINATING PARTY]` | Standalone paragraph | state file header |
| `[ORIGINATING PARTY ROLE]` | Standalone paragraph (e.g. `PLAINTIFF`) | state file header |
| `[RESPONDING PARTY]` | Standalone paragraph | state file header |
| `[RESPONDING PARTY ROLE]` | Standalone paragraph (e.g. `DEFENDANT`) | state file header |
| `[PARTY CLAIMING COSTS]` | `This is the bill of costs of: [PARTY CLAIMING COSTS]` | practitioner |
| `[COSTS SCALE]` | `Tariff scale: [COSTS SCALE]` | practitioner (e.g. `Scale B`) |
| `[UNIT VALUE]` | `Unit value: [UNIT VALUE]` | practitioner (e.g. `$110.00`) |
| `[COSTS ORDER]` | `Costs awarded by: [COSTS ORDER]` | practitioner (order reference) |
| `[COSTS TERMS]` | Standalone paragraph | practitioner |

**Leave blank** — never substituted, because the registrar fills them at the
hearing: every `[*_ALLOWED]` column, `[COSTS ORDER]` and `[COSTS TERMS]` when not
yet decided, `[NOTES]` and `[NOTES FOOTER]`.
