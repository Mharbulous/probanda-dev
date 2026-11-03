# Telus Business Connect Reference

The practitioner's TELUS call logs, read from an archive folder of zipped CSVs. `timecamping-data/scripts/import_calls.py` holds every parsing and validation rule, so never read a CSV by hand. A carrier's web portal is not a source.

## Configuration

The `telus` entry in `time_tracking.sources` holds:

| Key | Value |
|---|---|
| `auth` | `"none"` |
| `archive_folder` | The folder of zips, on this machine |
| `own_extensions` | The practitioner's own extensions, each as the `Extension` column writes it (`4 - Pat Example`) |

An older entry may lack `archive_folder` or `own_extensions`. Ask the practitioner once for what is missing and save it to the entry. If they have no archive, the source is `skipped`.

## The archive

| Series | File name | Holds |
|---|---|---|
| Daily | `2021-07-28 rcvd …`, or `08122020 rcvd …` (DDMMYYYY) | A rolling window with no `Direction` column: the named date and the one before |
| Calendar month | `may2026-05-01_may2026-05-31 rcvd …` | The whole month for one extension |
| 30th to 30th | `jun2026-06-30_jul2026-07-30 rcvd …` | Another extension's calls. Most files are header-only |

The script reads only top-level `*.zip` files, so a subfolder of extracted copies is ignored.

## Running it

Run the script with the host Python (`python`; if that is the WindowsApps stub, the interpreter `COCLERK_PYTHON` names), one `--own-extension` per entry in `own_extensions`, and `--timezone` from `time_tracking.timezone`:

```
python import_calls.py --folder F --own-extension E [--own-extension E2] --timezone TZ --out O [--timeline-out DATE --timeline-file P]
```

Then load `O` with one `/timecamping-data` bulk ingest. Re-running is safe: rows upsert in place, so re-importing adds no rows. `P` holds that date's calls as bulk-apply `set` lines for the date's file in Step 4 of `/build-timeline`.

Read the outcome from the printed summary:

| Summary | Outcome for the date |
|---|---|
| `timeline.covered` is true | Succeeded, with `timeline.rows` calls |
| `timeline.covered` is false, `files_failed` is empty | `skipped`: no archive covers this date. Any `timeline.rows` are stored, and the day is still incomplete |
| `timeline.covered` is false, `files_failed` is not empty | `failed`, naming each file and its error |
| The script exits with an error, such as a missing folder | `failed`, with its message |

A failed file does not stop the others. Report every `files_failed` entry even when the date is covered.

## What a result means

- **Voice calls only.** Texts are in no file, and fax rows and call legs are dropped and counted. No row means no call only on a covered date.
- **Every outcome is kept**, missed and voicemail too, each with its duration. Consumers decide what counts.
- **`direction`** is null on a call read only from a daily file, because those files do not record it.
- **After about 2026-08-31** the line moved to Rogers, so later dates have no archive here. A Rogers adapter and its own table wait for a sample export.

## The row contract

`native_id` is `c{date}T{time}{phone}` from the local date, the 24-hour local time and the normalized number: `c2026-08-27T13:39+18006636102`. Same-minute calls take `#2`, `#3`. The id is deterministic, so downstream annotations survive a re-import.

`raw_type` is `voicemail` when the outcome is `Voicemail`, otherwise `phone_call`.

`/time-sorting` and `timecamping-data/references/splice.sql` read these `raw_payload` keys: `format` (`portal` or `archive`), `direction`, `extension`, `phone_number`, `contact_name`, `action`, `action_result`, `result_description`, and the flags `internal`, `anonymous` and `unnormalized`, each present only when true.
