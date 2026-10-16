# UNITY® Accounting — Reference

**Product:** UNITY® Accounting (formerly esilaw)  
**Vendor:** Dye & Durham  
**Market:** Canadian law firms (BC and other provinces)

UNITY is a commercial trust and general ledger accounting platform widely used by BC law firms. It is **not** Law Society of BC software — it is a third-party product by Dye & Durham that is built to comply with provincial law society trust accounting rules.

---

## Trust Listing Export

The relevant report for this skill is the **Trust Listing** (sometimes labelled "TrustListing" in the exported filename, e.g. `TrustListing_20260410.csv`).

### Known CSV Format

| Field | CSV Column Name | Notes |
|-------|----------------|-------|
| Client number | `Client Num` | Numeric string, e.g. `1042` |
| Matter number | `Matter Num` (or `Matt Num`) | Dot-separated, e.g. `1042.01`. UNITY exports may prefix with `.` in some versions — strip if present |
| Client name | `Client Name` (or `Name`) | Last name first, e.g. `Anderson Patricia` |
| Originating lawyer | `Orig Law` | Initials (optional field) |
| Responsible lawyer | `Resp Law` | Initials |
| Type of law | `Type of Law` | Text description (optional) |
| Major client flag | `Major Client` | `Y`/`N` (optional) |
| Regular trust balance | `Regular Trust` | **Negative** number for funded retainers (see Sign Convention below) |
| Term trust balance | `Term Trust` | Usually `0.00` for litigation matters |
| Last trust date | `Last Trust Date` | Format: `DD/MM/YYYY` (may include `HH:MM:SS AM/PM` suffix) |
| Matter description | `Description` (or `Matter`) | Free-text description of the matter |

### Sign Convention

UNITY stores trust balances as **negative numbers** when the account is funded. This reflects the credit-side accounting convention (the firm owes the money to the client). A funded retainer of $5,000 appears as `-5000.00`.

- `regular_trust < 0` → funded retainer (display as `abs(value)`)
- `regular_trust = 0` → depleted retainer
- `regular_trust > 0` → should not occur in normal use; flag if seen

Always apply `abs()` when presenting trust balances to the user.

### Date Format

Dates in CSV exports use `DD/MM/YYYY` with optional time suffix (e.g. `10/04/2026 12:00:00 AM`). Convert to ISO 8601 (`YYYY-MM-DD`) before storing in the practice database.

### Sentinel Date

Missing or uninitialized dates may appear as `01/01/1900`. Treat these as `NULL` — do not store the sentinel value.

---

## How to Export the Trust Listing from UNITY

The export steps below are approximate and may vary by UNITY version:

1. Open UNITY® Accounting
2. Navigate to **Reports → Trust → Trust Listing** (or similar — the exact menu path depends on your version)
3. Set the date range or "as of" date as needed
4. Choose **CSV** or **Excel** export format
5. Save the file — the default filename typically follows the pattern `TrustListing_YYYYMMDD.csv`

If the menu path has changed in your version of UNITY, check **Help → Reports** or contact Dye & Durham support.

---

## Integration Notes

- UNITY does not expose a public API for direct data access. All data enters this skill via manual CSV export.
- The LTSA integration (BC-specific) is a UNITY feature for property transfers and is unrelated to the trust balance workflow used by this skill.
- UNITY is hosted in Canadian data centres, which is consistent with Law Society of BC data residency expectations.

---

## What NOT to Claim

When discussing UNITY with a user, do not say:
- "UNITY is Law Society software" — it is not; it is a commercial product
- "UNITY is the official BC trust accounting system" — it is a popular choice but not mandated
- Anything specific about UNITY's current pricing, version numbers, or roadmap without verified current information
