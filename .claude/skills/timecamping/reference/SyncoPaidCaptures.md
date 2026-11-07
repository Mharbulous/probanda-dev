# SyncoPaid Captures Reference (capture-level)

Configuration and data details for fetching SyncoPaid's **capture-level**
detail — individual screen captures with per-capture window titles, input
counts, and (where available) a screenshot/OCR reference. Load this file at
Step 2 when populating `syncopaid_captures`.

This is a **different fetch mode** from `build-timeline/reference/SyncoPaid.md`'s
`evidence blocks` call, which is deliberately coarser (aggregated blocks,
window titles capped at 10, no OCR, no screenshot reference at all) and is
right for build-timeline's raw-timeline purpose. `/timecamping` needs finer
detail: every fixture that turns on SyncoPaid evidence (an unfamiliar phone
number identified from screen context bracketing a call; a search-mode
screenshot distinguishing "email triage" from matter-specific research; a
36-minute block decomposed into six sub-groups by reading individual window
titles and input counts) reasons over **individual captures**, not
pre-aggregated blocks.

## Configuration — same two-gate discipline as build-timeline

Both checks from `SyncoPaid.md` apply unchanged here:

1. **Registry `enabled`** — same registry entry build-timeline already
   reads (`probanda.json → time_tracking.sources`); `/timecamping` reuses it
   rather than maintaining a second config surface (see `sources.md`'s
   source-integration table).
2. **Live `evidence status`** — check `SyncoPaid.Diagnostics evidence status`
   before every fetch, same three-outcome discipline as build-timeline's:
   enabled → proceed; disabled → skip (`skipped` in `source_fetch_log`,
   not `failed`); anything else → fail closed. Never call `evidence enable`.

## Fetching — confirmed against the live CLI

The mixed-entry-decomposition E2E fixture
(`docs/E2E-tests/2026-08-28-1143 timecamping-mixed-entry-decomposition-e2e-test.md`)
cites a reproduction command for the exact per-capture data it depends on:

```
SyncoPaid.Diagnostics evidence query --from {timestamp} --to {timestamp}
```

**Output shape — confirmed live 2026-09-04** (ticket [#423](https://github.com/Mharbulous/CoClerk/issues/423); fixtures under `docs/E2E-tests/2026-09-04-2118 timecamping-syncopaid-*`). The response is JSON on stdout: a header carrying `generatedAtUtc`, `dataDirectory`, `fromUtcInclusive`, `toUtcExclusive`, `localTimeZone`, `matterIdFilter`, `totalCapturesInWindow`, `returnedCaptures`, `truncated` and `ocrTextIncluded`, then a `captures` array. Each capture:

```json
{
  "id": "62e6487a-2548-4002-9d50-9fd21e93c3d0",
  "capturedAtUtc": "2026-08-27T20:52:30.0416109Z",
  "capturedAtLocal": "2026-08-27T13:52:30.0416109-07:00",
  "windowTitle": "brahm@whatisfair.ca - Outlook",
  "processName": "OUTLOOK",
  "appPath": "C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE",
  "screenshotState": "Recorded",
  "mouseClicksSincePreviousCapture": 2,
  "keyboardEventsSincePreviousCapture": 0,
  "screenshot": { "id": "...", "path": "...enc", "encrypted": true, "fileExists": false },
  "ocr": { "status": "Succeeded", "textLength": 870, "text": null },
  "matterSignal": {
    "state": "NoMatterSignal", "noSignalReason": "no_match",
    "resolvedMatterDisplay": null, "candidateMatterDisplays": [], "primaryEvidenceSnippet": null
  }
}
```

Notes on the fields that matter to inference:

- **`ocr.text` is `null` unless `--include-ocr-text` is passed**; `textLength` is always populated, so the presence of OCR text is knowable without paying for it.
- **`screenshotState`** is `Recorded` or `DuplicateSuppressed`. A run of `DuplicateSuppressed` captures sharing one `screenshot.id` is the objective unchanged-screen signal — with the input counts, this is what makes presumption P6 decidable at all.
- **`screenshot.fileExists` can read `false` while the file is present and decryptable.** Do not treat it as a blocker; it is a known resolver defect (see below).
- **`matterSignal` is SyncoPaid's own inference and is therefore indirect evidence** — the same class as TimeCamp's amber label, per the design doc's evidence doctrine. Store it, never act on it, never let it corroborate anything.
- **Timestamps**: `--from`/`--to` take naive **local** datetimes and the window is half-open `[from, to)`. Same contract as `SyncoPaid.md`'s block fetch; the details and the read-back check live there.

**Screenshot retrieval, for the inference pass and for a ceremony,** is a second lookup: `evidence show --screenshot <capture.screenshot.id> --out <folder named syncopaid-screens>/<capture id>.png` decrypts one screenshot to a PNG, the only place `timekeeper:screenshot-reader` may read. A capture with `"encrypted": true` is not unavailable: this command decrypts it (confirmed on 2026-07-19 captures, #942, 2026-10-01). Two live defects to expect (both SyncoPaid-repo issues, first recorded on #420 and confirmed still live on #423): the path resolver looks in `yyyy-MM` shard subfolders while every screenshot sits flat in `screenshots\`, and rows written by a pre-V018 capture app store a full path where the current CLI requires a bare filename — any query window containing one such row throws. If `evidence show` fails, treat the screenshot as unavailable and **disclose the gap explicitly in the ceremony** per `show-me`'s missing-data rule; never proceed as though the image had been read.

**Known evidence gaps (SyncoPaid-side, [SyncoPaid#102](https://github.com/Mharbulous/SyncoPaid/issues/102), measured 2026-09-22 on #881, extended 2026-09-24 on #1016).** Three ranges return captures with a field missing or unreliable for every row, not just for a few:

| Range (local) | Missing or unreliable | Usable |
|---|---|---|
| first record (2026-03-01) to 2026-05-26 07:37 | `windowTitle`, `processName` (null); `mouseClicksSincePreviousCapture`, `keyboardEventsSincePreviousCapture` (always 0); `screenshotState` (always `Recorded`, never `DuplicateSuppressed`) | `ocr.status` `Succeeded`, and OCR text shows the foreground window, except in the next row |
| 2026-05-25 ~12:50 to ~19:00 | OCR text (shows a different screen from the foreground TimeCamp records), on top of the row above | capture timestamps only |
| 2026-07-19 ~07:00 onward, except 2026-08-26 23:00 to 2026-08-27 22:00 | `ocr.status` (null, no OCR row) | `windowTitle`, `processName` |

Outside these ranges a null `windowTitle` on a few percent of captures, or through an overnight run, is normal. Also expect `ocr.status` `Failed` on most captures of 2026-06-11 to 06-14 and 06-17 to 06-18. On a capture in a gap range, proceed on whichever fields are usable, and **disclose the gap in the ceremony**: name the missing or unreliable field and cite SyncoPaid#102. Do not hold the day for manual review, and never infer the missing field. In the first range, zero input counts and the absence of `DuplicateSuppressed` are not idle evidence, so never rest presumption P6 on them. In the 2026-05-25 row, never read OCR text as what was on the foreground screen. Once SyncoPaid#102 closes, re-measure the ranges before relying on this table.

**Fail closed on an unparseable response**, exactly as `SyncoPaid.md`
directs for `evidence status` — never silently retry with `evidence blocks`
as a "close enough" substitute; that would silently discard the per-capture
detail this fetch exists to preserve. Never invent a field this command
does not actually return — leave the column null and disclose the gap
explicitly in any ceremony that would have used it, per `show-me`'s
missing-data rule.

## Computing native_id

Normalize the capture's own timestamp the same way `SyncoPaid.md` normalizes
a block's `startUtc` — `YYYY-MM-DDTHH:MM:SSZ`, seconds precision, trailing
`Z` — before use, for the same reason: an un-normalized id would silently
change on re-fetch if the CLI's raw timestamp representation ever varies.
The stable row id is `syncopaid_capture:{native_id}` (distinct prefix from
build-timeline's `syncopaid:{native_id}` block ids — same source, different
granularity, different id space; the two must never be confused or merged).

**Two captures in the same second.** Order the day's captures by full-precision
`capturedAtUtc`. The first in a second keeps the bare id and the rest get `#2`,
`#3`, … (e.g. `2026-09-01T16:02:30Z#2`), mirroring the Telus same-minute rule
(`build-timeline/reference/TelusConnect.md`, "The row contract"). The
suffix goes on `native_id` only: `captured_at` stays the unsuffixed second, and
`end_ts` chains to the next capture in full-precision order. A day with no
collision keeps exactly the ids it had before this rule. A file whose captures
go backwards by a whole second is still refused.

## Confidentiality

Same posture as `SyncoPaid.md`'s own note: this repo's timeline/timecamping
stores already persist unscoped, cross-client window-title detail from
TimeCamp and SyncoPaid alike in local-only storage. Capture-level detail
(including any OCR text once confirmed) carries strictly more exposure than
the block-level fetch, at the same local-only trust boundary — nothing here
changes who can read `timecamping.db`, only how much it holds.
