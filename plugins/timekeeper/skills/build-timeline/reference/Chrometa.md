# Chrometa Reference

Data format and handling details for Chrometa's one-time historical import. Load this file when parsing the Chrometa export for the timeline.

## Configuration

No API or auth configuration — this is a static, practitioner-supplied export file, not a live source. Chrometa is **not** a `probanda.json → time_tracking.sources` registry entry; it is invoked only via the Queries table's "Import Chrometa historical logs" row (`SKILL.md` → Queries), never through Step 2's per-date registry loop.

Invoking that query also bypasses **Step 1** (resolve target range) — the range is fixed, not derived from a user-supplied date. Execution goes straight to Step 3 (normalize each raw record) using the procedure below, then Steps 4-6 unchanged.

**Fixed range.** Local `[2019-01-01T00:00:00, 2020-04-01T00:00:00)` in `probanda.json → time_tracking.timezone` (default `"America/Vancouver"`), converted to UTC the same way Step 1 converts a requested date. `source:chrometa:ranges` is set to this full window, not just the dates that happen to have rows — so a later coverage check knows the window was checked, not merely un-fetched. The export's actual data extent (2019-01-02 to 2020-02-14) is narrower than the nominal window; the sibling March 2020 monthly export exists but is empty (headers only on every sheet) — the consolidated file is complete for the window, no second file is needed.

**Source file:** `C:\Users\Brahm\Sync\ADMIN\TIME TRACKING\Chrometa Time Records\Consolidated Time Summaries.xlsx`, sheet `Sheet2`. If the file is missing, unreadable, or the sheet is absent, fail clearly — this query is explicit and on-demand, never silently degraded the way an automatic per-date fetch is allowed to skip a source.

## Source columns

13 columns in the header row: `Source.Name, Day, Start, End, Duration, Duration (Minutes), Annotation, Task, Activity, URL, Client, Project, Marked as Exported to Tabs3?`

- `Start` / `End` — naive local datetimes (no timezone marker), minute precision. Interpret per `probanda.json → time_tracking.timezone` (default `"America/Vancouver"`), then convert to UTC for `start_ts`/`end_ts`, matching every other source. **`Start` is authoritative** for the row's date — it disagrees with `Day` on 4 rows in the real export, so don't use `Day` for date logic.
- Two trailing rows in the sheet have a blank `Start` (sheet-level totals, e.g. a `Duration (Minutes)` sum with every other column empty) — these are not activity data. Skip any row where `Start` is empty, logged but not reported as an error.
- `URL` holds the literal string `"null"` (not blank) on the large majority of rows lacking a URL — a Chrometa export quirk. Store verbatim inside `raw_payload`; do not normalize it to an actual null.
- `Duration` is a display string (e.g. `"2m"`, `"64h 14m"`); `Duration (Minutes)` is numeric. Both stored verbatim in `raw_payload`. `end_ts` comes directly from the `End` column, never derived from either duration field.
- `Source.Name` records which monthly export the row originated from (e.g. `"2019-07-01-to-2019-07-31-summary.xlsx"`) — store verbatim as provenance.

## Activity Types / raw_type

No column in the export carries a native activity-type/category value. Every row uses the fixed fallback: `raw_type: "screen_work"` (Chrometa is tagged `screen_activity` in `FirstSetup.md`'s tool table — the same category TimeCamp occupies).

Values like `Activity="Away Time"` or `Project="Working"` look type-ish but are **not** a native taxonomy — deriving `raw_type` from them would be content inference from a title-like field, which `SKILL.md`'s row-schema rule explicitly forbids.

## Client/Project are classification, not this skill's business

`Client` and `Project` carry the practitioner's own pre-existing matter assignments from when the Chrometa export was tagged. Store them verbatim inside `raw_payload` and never act on them — exactly as TimeCamp's `task_id` foreign key is "stored verbatim inside `raw_payload` and never resolved" (`SKILL.md`, "Reference data is not stored here"). This pre-classification is a gift to downstream time-sorting, not something build-timeline interprets or assigns.

## Computing native_id

The export has no stable id column. Tested directly against the real 57,977-data-row export before deciding:

| Candidate key | Duplicate groups | Max group size |
|---|---|---|
| `Start` alone | 6,636 | 6 |
| `(Start, End, Activity)` | 144 | 2 |
| `(Start, End, Activity, Client)` | **124** | **2** |

Of the 124 remaining groups on `(Start, End, Activity, Client)`: 110 are byte-identical duplicate rows (the same record appears twice in the export), 13 differ only in `Annotation` where one side is empty (the same real activity segment, annotated later), and exactly 1 has two distinct non-empty annotations on both sides. Collapsing every group to one row is correct — not collapsing would double-count the same minutes, since duration is identical within every group.

Because `Activity` is freeform text that can be long and can contain a literal `:` (the row-id separator, e.g. `"306: Shoar & Ellis v. Metro Law..."`), the composite cannot be embedded literally in an id — it must be hashed:

```
native_id = sha1(f"{start_utc_iso}|{end_utc_iso}|{activity}|{client}".encode("utf-8")).hexdigest()[:16]
row id    = f"chrometa:{native_id}"
```

where `start_utc_iso`/`end_utc_iso` are the UTC ISO-8601 forms (trailing `Z`) after timezone conversion, and `activity`/`client` are the raw cell values **verbatim, unstripped** (empty/missing → `""`).

Verified: 0 hash collisions between distinct composites — 57,853 unique `(start, end, activity, client)` composites map to 57,853 unique hash values; the only repeated hashes are the 124 groups above, which repeat because the composite is genuinely identical (the intended collapse).

**Worked example** (real row): `Start=2019-07-02 16:17` local (America/Vancouver, PDT, UTC-7) → `2019-07-02T23:17:00Z`; `End=2019-07-02 16:19` local → `2019-07-02T23:19:00Z`; `Activity=" Cantebury v. Goldies Pizza - Message (HTML) "`; `Client="Ellen Pratt"`. Composite: `"2019-07-02T23:17:00Z|2019-07-02T23:19:00Z| Cantebury v. Goldies Pizza - Message (HTML) |Ellen Pratt"`. `sha1(...).hexdigest()[:16]` = `e9a7da49f5a03b6d`. Row id: `chrometa:e9a7da49f5a03b6d`.

No separate field stores the pre-hash composite — it's fully reconstructible from the stored row itself (`start_ts | end_ts | raw_payload.activity | raw_payload.client`), so a redundant copy would just add ~6 MB of duplicate text for no gain.

**DST note:** zero rows in the real export fall on a 2019/2020 DST transition date (2019-03-10, 2019-11-03, 2020-03-08), so no ambiguous or nonexistent local timestamp occurs in practice — but the timezone-conversion library used should still resolve DST from the actual local date/time, not assume a fixed offset.

## Duplicate collapse

Group rows by `native_id`; keep exactly one row per group:

1. If one side has a non-empty `Annotation` and the other doesn't, keep the annotated one.
2. In the rare case both sides carry distinct non-empty annotations, keep the first row in sheet order and store the other's annotation verbatim in `raw_payload._collapsed_annotations` (an array). In the verified real export this happens exactly once: `2019-10-11 08:53-09:00`, `Client="Ellen Pratt"`, `Activity="Away Time"`, annotations `"check 43 folder "` and `"check boxes "`.

`_collapsed_annotations` is the only synthetic key in `raw_payload`; the leading underscore marks it as non-native (not a Chrometa export column). Report the collapsed-duplicate count in the import summary. On a clean run against the current export, expect 57,853 stored rows (57,977 data rows minus 124 collapsed duplicates).

## Building the activity row

```json
{
  "id": "chrometa:e9a7da49f5a03b6d",
  "source": "chrometa",
  "native_id": "e9a7da49f5a03b6d",
  "start_ts": "2019-07-02T23:17:00Z",
  "end_ts": "2019-07-02T23:19:00Z",
  "raw_type": "screen_work",
  "raw_payload": {
    "source_file": "2019-07-01-to-2019-07-31-summary.xlsx",
    "day": "2019-07-02",
    "duration": "2m",
    "duration_minutes": 2,
    "annotation": null,
    "task": null,
    "activity": " Cantebury v. Goldies Pizza - Message (HTML) ",
    "url": "null",
    "client": "Ellen Pratt",
    "project": "Working",
    "marked_exported_to_tabs3": "No"
  },
  "fetched_at": "<import run timestamp, UTC>"
}
```

`raw_payload` keys are snake_cased from the source columns (matching TimeCamp's precedent of light key normalization); every column not otherwise mapped is preserved.

## No duration ceiling

Unlike `TelusConnect.md`'s CSV validation (which rejects durations over 8 hours as malformed input), Chrometa's export legitimately contains long idle/away spans: 33 rows exceed 8 hours, 10 exceed 24 hours, and 4 exceed three and a half days — the longest runs 2019-06-06 16:10 to 2019-06-10 10:21 (3d 18h), `Client="Ellen Pratt"`. Import these unmodified — rejecting them would be interpretation, not validation, and there is no equivalent "malformed input" risk here since the source isn't a user-typed CSV field.

## Cross-midnight rows

36 activities in the real export span more than one local date. Per `SKILL.md`'s key layout, `index:activity:by-date:{date}` holds "activities whose interval overlaps this local date" — add each such row to **every** local date it overlaps, not just its start date.

Overlap is half-open, `[start, end)`. 4 further activities end at exactly 00:00 local, and an activity that ends the instant a day begins does not touch that day. Counting those as cross-midnight gives 40, which is what an earlier revision of this file recorded. Either way 277 distinct local dates carry rows.

## Validation & error handling

- **File not found / unreadable / expected sheet missing** — fail clearly: "Chrometa import failed — file not found at {path}." or equivalent. This query is explicit and on-demand (never part of the automatic per-date loop), so report the failure directly to the practitioner rather than degrading silently.
- **Missing expected columns** — fail clearly, listing expected vs. found columns.
- **Blank `Start`** — skip silently (these are the sheet's own trailing total rows, not data); log the skip count, don't report it as an error.
- **Non-blank but unparseable `Start`/`End`** on an otherwise-data row — treat as a genuine validation error: stop and report the row, mirroring Telus's "do not silently drop rows" strategy.

## Idempotency

Because the replace scope (Step 4) is the entire fixed 2019-01-2020-03 window and every Chrometa row lies inside it by construction, Step 4.2's usual per-row range check is unnecessary here: delete every id currently in `index:activity:by-source:chrometa` unconditionally, then insert the freshly-parsed set. A first run reports all-new; any re-run reports all-replaced — safe to re-run if the export is corrected or this file's logic changes later.

## Running the import

Two pieces, built 2026-09-04 (issue #453). Everything above this heading is the specification; these two implement it.

**Step 1 — produce the write file.** `scripts/chrometa_to_jsonl.py` reads the xlsx and writes a JSONL file of write operations. It never opens the database. Standard library only: an xlsx is a zip of XML, so it uses `zipfile` and `xml.etree`.

```
python scripts/chrometa_to_jsonl.py --out {path}.jsonl
```

It prints a JSON summary carrying every number the Logging section below asks for. On the current export that is 57,979 rows read, 2 footer rows skipped, 124 duplicates collapsed, 57,853 activities, 277 dates with rows, 36 cross-midnight activities, and 58,313 lines written (about 43 MB).

**Step 2 — apply it.** Invoke `time-pipeline-data` with the `bulk apply` operation, `namespace: "timeline"` and `path` set to the file from step 1. It applies every line in one transaction. `deleted_by_prefix` in the result is 0 on a first run and 57,853 on a re-run, which is what distinguishes "all new" from "all replaced" in the summary.

The file's own lines carry the whole plan: one `delete_prefix` on `activity:chrometa:` that replaces Step 4's by-source walk outright, then the rows, then this source's own by-source index, then one `merge` line per local date in the fixed window, then the two `source:chrometa:*` metadata keys.

Every date in the window gets a merge line, not only the 277 that carry rows. A date with no rows contributes an empty `add`, which is what strips a stale Chrometa id from a date a corrected export no longer touches. The by-date indexes are merged rather than overwritten because they are shared with every other source: a plain overwrite would silently discard a TimeCamp or Telus id that later lands on a 2019 date.

**No sharded index is needed.** `SKILL.md`'s scaling note suggests a sharded `index:activity:by-source-and-date:{source}:{YYYY-MM-DD}` index once the O(all rows) scan in Step 4.2 gets slow. That scan walks `index:activity:by-source:{source}` for the one source being re-fetched, so Chrometa's 57,853 ids sit in `index:activity:by-source:chrometa` and never enter a TimeCamp or Telus fetch's scan. Chrometa's own Idempotency section replaces the scan with an unconditional delete, and the `delete_prefix` line removes even that. The scaling note still stands for the per-date sources that do run Step 4.2.

## Logging

For debugging/audit purposes, log (but do not present unless requested):

- File path and sheet name
- Total rows read, footer rows skipped, duplicate groups collapsed
- Rows stored (new vs. replaced)
- Example: "Parsed Chrometa export: 57,979 rows (2 footer rows skipped, 124 duplicates collapsed), 57,853 activities stored, all new."
