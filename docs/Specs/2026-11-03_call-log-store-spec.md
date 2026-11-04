# Consolidated call-log store

Status: built 2026-11-03. Decided in a reviewed grilling session and the practitioner's answers of the same date. Its route for a second provider (an adapter plus its own table) and the deferred Rogers adapter are replaced by `2026-11-03_call-log-any-provider-spec.md`.

## Requirements

- One idempotent importer fills `telus_calls` from the whole archive folder, in code. Re-importing adds no rows.
- One MCP tool returns a matter's calls in a date range, each with direction, duration and outcome, matched through practice contacts.
- No hand-parsing or portal prose remains in the skills.
- A second provider is an adapter plus its own table, and does not change `telus_calls`.
- Every call shows, with its outcome and duration, including calls under 30 seconds. Nothing filters them.

## Why

A billable call was found only by a regex over 785k characters of TimeCamp window titles, after the practitioner said they had called. The call logs sat in 235 zipped CSVs that no code read: 120 lines of prose told the model how to parse one CSV at a time, and no code linked a number to a contact. The TELUS portal is gone, because the line moved to Rogers about 2026-08-31.

## Facts about the archive

Read from the real folder on 2026-11-03, read-only. The folder holds 235 zips and an `Extracted/` folder of copies. Each zip holds one CSV with a byte order mark.

| Series | Count | Name | Header | Holds |
|---|---|---|---|---|
| Daily | 172 | `YYYY-MM-DD rcvd …`, 2 as `DDMMYYYY rcvd …` | 9 columns, no Direction | Dec 2020 to Jun 2024, a rolling window: a file named D also holds D-1. The earliest rows date as `Mon 07/12/2020`, day first |
| Calendar month | 26 | `mayYYYY-MM-01_mayYYYY-MM-31 rcvd …` | 13 columns | Jun 2024 to Aug 2026, extension 4 |
| 30th to 30th | 37 | `junYYYY-06-30_julYYYY-07-30 rcvd …` | 13 columns | 33 header-only. The 4 with rows hold outgoing calls on extension 15, and none match an extension-4 row |

Rows: `Type` is `Voice`, blank (a leg) or `Fax`. `Action Result` values include Call connected, Accepted, Missed, Voicemail, No Answer, Wrong Number, Busy, Hang Up, Stopped, IP Phone Offline, Unknown, NotAllowed and Call Failed. Numbers are `(XXX) XXX-XXXX`, 1 to 4 digit extensions, blank, 10 digits, or a few of 11 or 12 digits, some with a `+`.

The first run over the real folder read 235 files with none failed, and kept 2,084 calls over 975 covered dates. It dropped 1,694 legs, 50 faxes and 11 RingOut legs. 7 calls have an unnormalized number, and no call changed duration between files.

## Decisions

1. **No schema change.** Direction stays in `raw_payload.direction`, and the tool reads it with `json_extract`. There is no `provider` column: the assembly gate keys on the table name (`splice.sql`), so a second provider gets its own table, as `gcal_events` and `icloud_events` did. The release stays a patch.
2. **Importer in code:** `.claude/skills/timecamping-data/scripts/import_calls.py`, standard library only. The script's docstring and functions are the source of its rules. It scans top-level `*.zip` in name order, so the monthly archive replaces a daily row for the same call and the result is reproducible.
3. **Coverage.** A date is covered by a calendar-month file, or by a daily file named that date or the next. The 30th-to-30th series covers nothing, so a header-only file never marks a date as read. A file that fails validation covers nothing, and the others carry on.
4. **Two own extensions.** Extension 15 ("forward") was an extra extension the practitioner used, so its calls merge into the log. `own_extensions` is a list. Two rows with one id on different extensions in one file are one call, the longer. Two rows on one extension are two calls.
5. **Config:** the `telus` registry entry gains `archive_folder` and `own_extensions`, and `auth` becomes `"none"`. `auth` is a credential mode, not a place for paths.
6. **Query tool:** `timecamping_data__calls {from, to, matter?, numbers?}` in the lawyer `data` server, `source/lawyer/mcp/src/timecamping/calls.ts`. It matches on the last 10 digits with `phoneDigits`. It is the one server module that names a timecamping table, which its header states. A call's `contacts` is a list, because a firm's main line can belong to several contacts.
7. **`uncovered_dates` counts only `fetched` and `empty`.** A `skipped` date was not read, so it stays uncovered.
8. **Import at the point of use,** not a new skill: the phone step of `/get-candidate-dates` and the Telus source of `/build-timeline`. `build_ingest.py --source telus` is deleted.
9. **A contact without a phone:** the session finds the number in the intake form, passes it in `numbers`, and offers once to save it with `upsert_contact`, sending the existing phones plus the new one, only on the practitioner's yes.

## Deferred

- The Rogers adapter and its `rogers_calls` table, until a sample export lands. Rogers server errors block the download.
- Softphone window titles as a second call source.
- A separate unmatched-number review. The no-`matter` mode and the `/timecamping` FACT directory cover it.
- Rogers `.xls` files from 2019 to 2021, iMazing CSVs, and the gaps from Jan 2021 to May 2024, which the tool reports as uncovered dates.
