# SyncoPaid Reference

Configuration and data details for SyncoPaid integration. Load this file when fetching SyncoPaid screen-activity blocks for the timeline.

## Configuration

SyncoPaid is gated by **two independent checks**, worth naming explicitly since they're easy to conflate:

1. **Registry `enabled`** — has the practitioner configured SyncoPaid as a Coclerk source at all. Same meaning as for any other source; Step 2's loop already handles it.
2. **Live `evidence status`** — is SyncoPaid's own opt-in currently on. Checked **before every fetch**, because the lawyer's opt-in can change independently of the registry at any time.

Run `SyncoPaid.Diagnostics evidence status` before every fetch. There are exactly three outcomes:

- **Enabled** — proceed to Fetching below.
- **Disabled** — skip. Record `"syncopaid"` as skipped (not failed — this is an expected state) for Step 6's report. Leave `source:syncopaid:fetched_at` and `source:syncopaid:ranges` untouched, exactly as on a genuine failure. Do not call `evidence blocks`.
- **Anything else** (command not found, non-zero exit, unparseable output) — this is a **failure**, not a skip. Record `"syncopaid"` in `sources_failed` with the reason. Do not call `evidence blocks`.

**Output shape — confirmed live 2026-09-04** (ticket [#423](https://github.com/Mharbulous/CoClerk/issues/423); full fixture: `docs/E2E-tests/2026-09-04-2118 timecamping-syncopaid-optin-gate-e2e-test.md`). `evidence status` prints **JSON on stdout** and exits 0 in both states:

```json
{
  "enabled": true,
  "settingKey": "assistantEvidence.enabled",
  "dataDirectory": "C:\\Users\\Brahm\\AppData\\Local\\SyncoPaid"
}
```

Parse the stdout body as JSON and read the boolean `enabled`. Three traps, all reproduced live:

- **Exit code is not a success signal.** An unrecognised top-level argument falls through to an unrelated diagnostics routine that prints a database banner to stdout and **exits 0**. Parse JSON-shape first, exit code second; a non-JSON body is always a failure, whatever the exit code.
- **`enabled: false` also means "no database at this `--data-dir`."** `ReadStatusAsync` returns a disabled status when the store file is absent, without reading any setting — so a mistyped or wrongly-defaulted data directory is indistinguishable from a genuine opt-out and would silently read as a skip. Confirm the returned `dataDirectory` matches the configured store before accepting a skip.
- **Never infer the gate from a fetch failure.** A disabled store makes `evidence query`/`evidence blocks` throw an unhandled exception at exit 127, indistinguishable from a genuine crash. The gate is readable only from `evidence status`.

There is **no UI toggle** for this setting anywhere in the SyncoPaid apps — `assistantEvidence.enabled` appears only in `EvidenceCommand.cs` in the SyncoPaid.Diagnostics project. The practitioner's opt-in act is running `evidence enable` themselves. Note that both `evidence enable` and `evidence disable` open a **read-write** connection and run the full migration runner before writing the setting; `status`, `query` and `blocks` are read-only and cannot migrate.

Build-timeline **never** calls `evidence enable` — turning capture on is the practitioner's act alone, never this skill's.

## Fetching

```
SyncoPaid.Diagnostics evidence blocks --from {day_start} --to {day_end} --gap-minutes 5
```

- **Unscoped** — never pass `--matter-id`. A matter-scoped call can only confirm a classification that already exists; it can never surface time misclassified to another matter or missed by TimeCamp entirely, which is the whole point of reconciling against this source.
- **`--gap-minutes 5` is pinned permanently, never a configurable option.** Block boundaries are a direct function of this value, and every `native_id` is a direct function of a block boundary. Re-fetching the same window with a different value would silently reshape every boundary and every id, orphaning any downstream classification or correction keyed to the old ones.
- **One call per local date, never a wider window.** Pinning `--gap-minutes` alone does not make block boundaries — and therefore `native_id` — stable: boundaries are a function of the gap algorithm applied *over the requested window*, so a boundary sitting at the edge of a window is an artifact of where the window was cut. Fetching 2026-04-15 alone and later fetching the whole week containing it can legitimately produce different blocks for the same day, with different `startUtc` values and therefore different ids — the exact orphaned-annotation failure the `--gap-minutes` pinning exists to prevent. A multi-day request from Step 1 must become one `evidence blocks` call per local day in the range, never a single wide-range call. This makes `native_id` a pure function of `(local date, gap-minutes=5)` — do not "optimize" this into one call per requested range; that reintroduces the instability.
- `{day_start}` / `{day_end}` are the local-day boundaries — from `probanda.json → time_tracking.timezone` (default `"America/Vancouver"` if unset) — converted to UTC the same way Step 1 already converts a requested date, for each day in the range.

**Timestamp contract — confirmed live 2026-09-04** (ticket [#423](https://github.com/Mharbulous/CoClerk/issues/423); full fixture: `docs/E2E-tests/2026-09-04-2118 timecamping-syncopaid-window-contract-e2e-test.md`):

- **Pass naive local datetimes** (`2026-04-15T00:00:00`), never an explicit `Z` or offset. The CLI converts using the machine's own zone — `--from 2026-08-27T13:52:30` came back as `fromUtcInclusive: 2026-08-27T20:52:30Z` under `Pacific Standard Time`. Passing a `Z`-suffixed timestamp would be read against the local zone anyway and shift the window by the offset.
- **The window is half-open `[from, to)`** — `--from` inclusive, `--to` **exclusive** (`WHERE captured_at_utc >= @From AND captured_at_utc < @To`). Do not subtract a second from `--to`.
- **Every response declares its own interpretation** in `fromUtcInclusive`, `toUtcExclusive` and `localTimeZone`. Read them back and abort the day on a mismatch rather than proceeding — one comparison that catches a whole class of silent window shifts.

The intent stated above — the half-open local-day window — is therefore what the CLI does natively when passed naive local bounds. No offset arithmetic is needed. If the CLI ever rejects the timestamp form, **fail the source loudly for that day — do not silently retry with a coarser form.**

### Response Format

Each block returned represents one contiguous period of observed screen activity. SyncoPaid blocks have a start and end and are stored as **activities** in the `timeline` namespace, not events.

Fields, per block:
- `startUtc` — block start, UTC
- `endUtc` — block end, UTC
- `processName` — the application/process observed
- `matterId` — matter identifier if SyncoPaid has already inferred one, else `null`
- `matterDisplay` — matter display name if inferred, else `null`
- `captureCount` — number of underlying captures aggregated into this block
- `mouseClicks` — click count over the block
- `keyboardEvents` — keyboard event count over the block
- `distinctWindowTitleCount` — total distinct window titles seen over the block (may exceed the length of `windowTitles` below)
- `windowTitles` — up to 10 distinct window titles seen over the block; the CLI caps this list, and `distinctWindowTitleCount` is stored alongside it so the cap is visible to anything reading the row rather than silently lossy

If the live CLI returns fields beyond this list, store them verbatim inside `raw_payload` rather than dropping them — this field list comes from the design decision, not from observed CLI output.

**Known capture gaps.** Some date ranges return captures with a field missing on every row, which reaches the blocks built from them. The dates, fields and upstream issue are recorded once, in `.claude/skills/timecamping/reference/SyncoPaidCaptures.md`, section "Fetching — confirmed against the live CLI", paragraph **Known evidence gaps**. Read them there.

Row schema:

```json
{
  "id": "syncopaid:2026-04-15T16:02:00Z",
  "source": "syncopaid",
  "native_id": "2026-04-15T16:02:00Z",
  "start_ts": "2026-04-15T16:02:00Z",
  "end_ts": "2026-04-15T16:47:00Z",
  "raw_type": "screen_work",
  "raw_payload": {
    "processName": "Microsoft Word",
    "matterId": null,
    "matterDisplay": null,
    "captureCount": 14,
    "mouseClicks": 82,
    "keyboardEvents": 640,
    "distinctWindowTitleCount": 2,
    "windowTitles": ["Smith v Jones - Settlement Memo.docx - Word"]
  },
  "fetched_at": "2026-04-16T02:30:00Z"
}
```

- **`raw_type: "screen_work"`** — a fixed per-source constant, stated explicitly as such so it is never mistaken for content inference. Blocks carry no native type field, so the literal SKILL.md rule ("`raw_type` … `null` when the source does not provide one") would otherwise say `null`; the constant is used instead because the capture modality is uniform and already known — SyncoPaid observes windows and processes exactly as TimeCamp does — mirroring the existing TimeCamp precedent, not a per-row judgment call. Never derive it from a window title.
- **`matterId` / `matterDisplay`** — stored verbatim inside `raw_payload`, **never acted on, never displayed as a column**. This exactly mirrors how TimeCamp's `task_id` foreign key is already "stored verbatim inside `raw_payload` and never resolved" (`SKILL.md`, "Reference data is not stored here"). Build-timeline never assigns activities to matters; that is classification's job, downstream in time-sorting.

## Computing native_id

`native_id` is the block's `startUtc`, **normalized** to `YYYY-MM-DDTHH:MM:SSZ` (seconds precision, trailing `Z`) before use — not the CLI's raw string as-returned. Document the normalization here because if the CLI ever emits a different representation of the same instant (e.g. `+00:00` instead of `Z`, or adds sub-second precision), an un-normalized id would silently change on re-fetch and orphan everything keyed to the old one. The stable row ID is `syncopaid:{native_id}`.

**What actually forms a boundary — measured 2026-09-04.** Over a full 13-hour day (921 captures, 197 blocks), **all 196 boundaries were process changes and none came from the gap parameter**; the tightest boundary spanned a 3-second gap, and no two adjacent blocks shared a `processName`. The `--gap-minutes` pinning above stays correct and necessary — a gap-formed boundary would move if the value changed — but it is not what shapes most blocks, and a reader who takes the framing literally will mis-model how blocks form. Two consequences: a process switch is intrinsic to the capture stream, so it falls at the same instant however the fetch window is cut, making `native_id` more stable than the per-day rule assumes (only a boundary at the window's own edge is a request artifact); and block-level output is far more fragmented than "one contiguous period of observed screen activity" suggests — most blocks are a single capture, so ordinary window-flipping shatters continuous work into dozens of rows.

Blocks are time-ordered and non-overlapping within one fetch, and — because of the one-call-per-local-day rule above — across fetches too, so `startUtc` alone is unique. `processName` is deliberately **not** part of the id: a process can recur in a later block after an intervening gap or matter change (e.g. Word → Chrome → Word), so it does not uniquely identify a block the way a start instant does.

The embedded `:` characters in the timestamp need no hashing: row ids are split on the first `:` only, exactly as the existing `telus:c2026-04-15T14:30+16045551234` example already relies on. SKILL.md's hash-the-composite rule (for freeform text that's long or contains `:`) targets unbounded freeform text, not a fixed-width structured timestamp — hashing this value would add nothing.

## Confidentiality

Unscoped `evidence blocks` output spans all clients. SyncoPaid's own CLI documentation says to treat this as confidential and delete it after reconciliation — guidance written for an ephemeral, ad-hoc reconciliation pull inside a single conversation, not for a system-of-record ingester like build-timeline. This integration consciously supersedes that guidance: the timeline store already persists unscoped, cross-client window titles from TimeCamp in exactly the same local-only store, and `blocks` mode is contractually the *lower*-detail path (no OCR text, no screenshot references at all) — persisting SyncoPaid blocks carries the same exposure class the store already carries, at strictly lower detail.
