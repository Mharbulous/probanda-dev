# Telus Business Connect Reference

Data format and handling details for Telus Business Connect integration. Load this file when parsing Telus CSV data for the timeline. Telus data arrives in two formats: the **portal export** (verified against a real export on 2026-08-28, ticket #420) and the **monthly archive** (verified against the real 2026 archives on 2026-09-23, ticket #875). Both parse to the same rows with the same ids.

## Configuration

No API configuration needed — the practitioner supplies a CSV file path when available. If no CSV is provided, skip and record `"telus"` in `sources_failed`. This is expected — Telus data is not always available.

Store supplied exports under `data/raw-imports/telus/` (gitignored — raw exports carry client names and phone numbers and must never enter git history).

**Which file covers a date.** The portal can only look back 60 days. For an older date, use the monthly archive: TELUS auto-delivers zipped CSVs to `C:\Users\Brahm\Sync\ADMIN\BILLING\Telus\`. The file for a date is the **calendar-month** zip for that date's month, named `<mon>YYYY-MM-01_<mon>YYYY-MM-<last day> rcvd … EF TELUS Business Connect™.zip` (e.g. `may2026-05-01_may2026-05-31 rcvd 2026-06-01 EF TELUS Business Connect™.zip`). It arrives on the 1st of the following month, so the current month is portal-only. Read the zip's single CSV member in memory (Python's built-in `zipfile`); never extract it into the repo. The other zips in that folder, whose windows start on the 29th–31st (e.g. `jun2026-06-30_jul2026-07-30`), are **not** overlapping copies of the same log: they are a different extension's log (`15 - Brahm forward to Kiana`), and each call in them already appears in the calendar-month file. They are not a source.

## CSV Format (real export, verified 2026-08-28)

The portal's Call Log export produces:

```
"Type","Phone Number","Name","Date","Time","Action","Action Result","Result Description","Duration"
"Voice","(800) 663-6102","","Thu 2026-08-27","1:39 PM","VoIP Call","Call connected","","0:01:16"
```

| Column | Format | Notes |
|--------|--------|-------|
| Type | `Voice` | Voice rows only — see Scope below |
| Phone Number | `(XXX) XXX-XXXX`, or short extension digits (e.g. `10`) for internal calls | Normalize to E.164 for storage |
| Name | Contact name or empty | Empty for unknown callers |
| Date | **Weekday-prefixed**: `Thu 2026-08-27` | Strip the weekday prefix before parsing the ISO date |
| Time | **12-hour with AM/PM**: `1:39 PM` | Convert to 24-hour |
| Action | `Phone Call` / `VoIP Call` | How the call was placed/received — there is **no Direction column** |
| Action Result | `Call connected` / `Missed` / `Voicemail` / `Wrong Number` / `Hang Up` | The call's outcome |
| Result Description | Free text or empty | Detail for failure outcomes (e.g. the wrong-number message) |
| Duration | `H:MM:SS` (e.g. `0:01:16`) | Convert to seconds |

**Encoding:** UTF-8 **with BOM** — strip the BOM during parse (the first header cell otherwise reads as `﻿"Type"`). All fields are quoted.

### Scope limitations (important)

- **Voice rows only.** Text/SMS conversations do not appear in this export — they live under a separate report type in the portal. Telus text activity that shows up in screen evidence (window titles like `TELUS Business Connect - Text - {name}`) will have no row here. Absence of a row is only meaningful for *calls*. The monthly archive also carries `Fax` rows; they are skipped and counted in the log, not ingested.
- **Rolling window, not per-day.** The portal exports a recent-activity window (observed: ~15 rows spanning 4 days), not a date-filtered log. Per-day completeness must not be assumed; filter rows to the target date and treat the result as "calls Telus reported", not "all calls that day" unless the practitioner confirms completeness.

## Archive CSV Format (monthly archive, verified 2026-09-23)

```
"Type","Direction","From","To","Extension","Forwarded To","Name","Date","Time","Action","Action Result","Result Description","Duration"
"Voice","Incoming","(778) 386-2608","(604) 969-0697","4 - Brahm Dorst","","Ronald Zhu","Thu 2026-05-28","2:08 PM","Phone Call","Accepted","The call connected to and was accepted by this number.","0:08:22"
"","Outgoing","(778) 386-2608","","4 - Brahm Dorst","4","Ronald Zhu","Thu 2026-05-28","2:08 PM","VoIP Call","Call connected","The call connected to and was accepted by this number.","0:08:17"
"","Outgoing","","","4 - Brahm Dorst","Brahm","Tyler Hatch","Thu 2026-05-28","2:08 PM","FindMe","Stopped","","0:00:05"
```

Same encoding as the portal export (UTF-8 with BOM, all fields quoted). `Name`, `Date`, `Time`, `Action`, `Action Result`, `Result Description` and `Duration` have the same formats as the portal columns above. The archive adds:

| Column | Format | Notes |
|--------|--------|-------|
| Type | `Voice`, blank, or `Fax` | Only `Voice` rows are calls — see below |
| Direction | `Incoming` / `Outgoing` | Authoritative on the `Voice` row only |
| From | Phone number, extension digits, or empty | The caller. Empty when caller ID is withheld |
| To | Phone number, extension digits, or empty | The number called |
| Extension | e.g. `4 - Brahm Dorst` | Whose call log the row belongs to |
| Forwarded To | Free text or empty | Leg detail; not used |

**Reducing the archive to the portal's rows.** A single call writes several rows: one `Voice` row that describes the whole call, plus blank-`Type` rows for each leg (the forward to the desk phone, the FindMe ring to the mobile). The portal export shows only the `Voice` row. Apply, in order:

1. **Keep `Type` = `Voice` rows only.** Blank-`Type` rows are legs of a call whose `Voice` row is present, and their `Direction` does not reliably say who called whom. `Fax` rows are out of scope (see Scope limitations).
2. **Keep only the practitioner's own extension**, `Extension` = `4 - Brahm Dorst` (the portal's "My Extension" log). A `Voice` row for another extension is that extension's view of a call the practitioner's log already holds.
3. **Counterparty = the portal's `Phone Number`.** `Direction` `Incoming` → take `From`. `Direction` `Outgoing` → take `To`. Verified 2026-09-23: all 14 calls in the portal export of 2026-08-25 to 2026-08-28 match an archive `Voice` row exactly on this counterparty and on Name, Date, Time, Action, Action Result, Result Description and Duration.

What remains is the portal's row set, plus `Direction`. From here both formats go through the same Activity Types, native_id and validation rules. Record the format (`"portal"` or `"archive"`) and, for the archive, `Direction` in `raw_payload`.

**Completeness.** Unlike the portal's rolling window, a calendar-month archive holds the extension's whole month, so a day inside it can be treated as all calls Telus logged that day. An archive with a header and no rows is valid: the day is `fetched` with zero calls.

## Activity Types

Each record's `raw_type` is set from the Type column plus Action Result — raw source classifications, not interpretations:
- **phone_call** (Type `Voice`, connected or missed)
- **voicemail** (Action Result `Voicemail`)

The `text` and `fax` types anticipated by the original design are not ingested: text does not appear in either format, and the archive's `Fax` rows are skipped.

## Computing native_id

Verified 2026-08-28: the real export has **no call-id column**, so the composite key is the only option.

- `native_id = "c{date}T{time}{phone}"` using normalized fields: date with weekday prefix stripped (`2026-08-27`), time converted to 24-hour (`13:39`), phone normalized per Parsing rule 5 (`+18006636102`). For the archive, `phone` is the counterparty from its reduction step 3.
- Example: `telus:c2026-08-27T13:39+18006636102`
- Ids are split on the first `:` only, so the `:` inside the time needs no escaping (matches the SKILL.md row-identity rule).

Normalization must be deterministic — same row, same id, every re-import — because downstream annotations are keyed to these ids. **The same call gets the same id from either format**, so importing a day from the portal and later from the archive (or the reverse) replaces the rows in place rather than duplicating them.

**Two rows with the same key.** Compute every row's key first, then resolve collisions within the file:

1. **RingOut pair → one call.** A click-to-call (`Action` `RingOut PC`) writes two `Voice` rows in the same minute with the same counterparty and duration: the `RingOut PC` row and an `Incoming` `Phone Call` leg. Keep the `RingOut PC` row, drop the other, and count the drop in the log.
2. **Distinct calls in the same minute → ordinal suffix.** Otherwise the rows are separate calls (e.g. two missed calls from one number within a minute). Order them by Duration, longest first, keeping file order on a tie. The first keeps the bare id and the rest get `#2`, `#3`, … (e.g. `telus:c2026-05-19T16:53+17783862608#2`). Duration is identical in both formats, so the ordinal is too.

## Parsing & Validation

**Before parsing:**
1. **File exists / readable** — error naming the path if not.
2. **UTF-8 decode** (BOM-tolerant). If decode fails: "Telus CSV file is not UTF-8 encoded."

**During parse:**
1. **Header row** decides the format (case-insensitive, whitespace-trimmed, BOM stripped from the first cell). A header with `Phone Number` is a **portal export**. Required: Type, Phone Number, Date, Time, Action, Action Result, Duration. A header with `Direction`, `From` and `To` is an **archive**. Required: Type, Direction, From, To, Extension, Date, Time, Action, Action Result, Duration. Name and Result Description may be empty in both. If the header matches neither, or the matched format lacks a required column: "Telus CSV is missing required column(s): {list}. Found columns: {list actual}." For an archive, apply its reduction (Archive CSV Format above) before the per-row checks below, so they run on `Voice` rows of the practitioner's extension only.
2. **Date:** strip the leading weekday token, then parse ISO `YYYY-MM-DD`. Reject impossible dates, with row number in the error.
3. **Time:** parse 12-hour `H:MM AM/PM`; convert to 24-hour. Reject unparseable times with row number.
4. **Duration:** parse `H:MM:SS` to seconds. Reject negative durations. Zero-duration rows are valid (instant miss). Reject durations > 8 hours as malformed.
5. **Phone Number** (the archive's counterparty): strip non-digits; 10 digits → prepend `+1`; 11 starting with 1 → prepend `+`; 1–4 digits → internal extension, store as-is with `internal: true` in the raw payload; empty → a withheld caller ID (seen on incoming calls named `Unknown`), use `anonymous` as the phone and set `anonymous: true`; any other digit count → a misdial (seen: a 12-digit outgoing `No Answer`), use the digits as-is, set `unnormalized: true`, and log a warning rather than an error. Both cases are real calls, and one of them anywhere in a month-long archive would otherwise fail every day in it.
6. **Action / Action Result:** store verbatim. Unrecognized values are a warning, not an error — Telus may add outcomes.
7. **Blank/comment rows:** skip rows where all columns are empty or the first non-whitespace character is `#`.

### Error handling

1. **Stop parsing on a validation error** — do not salvage or skip bad rows silently.
2. **Report explicitly** — line number, column, value, expected format.
3. **Record `"telus"` in `sources_failed`** and continue the build with the other sources.
4. Note in the report: "Telus data not available — phone calls are not included in this timeline build."
5. The practitioner can re-import later via "Re-import Telus CSV at {path} for {date}".

### Logging

Log (present only if requested): file path and size, format, columns found, row count, rows in the target date range, rows outside it (expected — rolling window or rest of month), validation errors, parsed count. For an archive, also: rows skipped as call legs (blank `Type`), `Fax` rows, other-extension rows, and dropped RingOut legs. Examples: "Parsed Telus CSV: 14 rows, 1 in range for 2026-08-27, 13 outside range, encoding UTF-8 (BOM)." / "Parsed Telus archive may2026-05-01_may2026-05-31.csv: 252 rows, 140 call legs and 4 fax skipped, 7 calls for 2026-05-28."
