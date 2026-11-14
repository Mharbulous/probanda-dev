# /bill's time work across the practitioner's devices

Status 2026-11-11: plan approved by the practitioner. Nothing here is built. It reverses question 3 of `2026-11-10_billing-redesign-build-plan.md` (the PC-only stop), answers its question 5, and answers the open decision that blocks its slice 13.

## Context

`/bill` stopped at Step 6.2 on the practitioner's second PC, because the time work assumes one PC holds every evidence source. Read on `main` at 960d6041:

1. **The store loses rows between PCs.** Every record the time work uses (`review_date`, `day_evidence`, `block`, `candidate_date`, `capture_reading`) is in one SQLite file, `0. CASE DATA\_practice\time_pipeline.db`, in the synced folder. Both PCs open it live, with no lock and no staging (`src/kv/backend.ts:33-40`, `2026-11-04_bill-record-store-survey.md:114-123`). File sync keeps the last copy saved. On the second PC a date read `judged` with no evidence and no blocks, and the store held 0 `candidate_date` records. Not verified: the other PC's copy of the file.
2. **No device identity exists.** No record, row or source outcome has a device field, and the server has no device id (`src/time-review/records.ts:22-33`).
3. **The registry is per machine.** `time_tracking` sits in each PC's `probanda.json`. No code reads it. The gate checks a fixed list of seven names, not the registry (`skills/timecamping-data/references/splice.sql:113-129`).
4. **Two passages stop on host type:** `skills/bill/SKILL.md:142` and `skills/timecamping/SKILL.md:327`.
5. **`time_review__save_evidence` takes every row inline** and replaces the whole day (`src/time-review/tools.ts:71-104`).
6. **Only SyncoPaid captures are tied to a device.** The other six sources are cloud data or a folder.

## The seven sources

| Source | Data lives | Which device can supply it | How its rows reach the day |
|---|---|---|---|
| `timecamp_time_entries` | TimeCamp cloud | any device with the TimeCamp token | fetched by the running device, saved in that device's part of the day |
| `timecamp_computer_activities` | TimeCamp cloud | same | same |
| `gcal_events` | Google cloud | any device whose session has the connector | same |
| `icloud_events` | iCloud | any device with the calendar credential | same |
| `sent_mail` | iCloud copy of Sent Items | any device with the mail credential | same |
| `telus_calls` | folder of zips | any device that has the folder (path recorded per device) | same |
| `syncopaid_captures` | each PC's own SyncoPaid | only the PC that captured them | that PC saves its own part. Other devices read the part from the store. Images stay on that PC, and only the `capture_reading` is shared |

The first six are **shared sources**: one terminal outcome from any device is enough. `syncopaid_captures` is a **device source**: one terminal outcome is needed from each registered device.

## Decisions

1. **Device identity.** The server creates `device_id` (random) and `device_name` (computer name, editable) in the machine-level `probanda.json` on first use. The server stamps the device. The model never types it.
2. **One writer per file, merged on read.** Each device writes only `_practice\time_pipeline\<device_id>.db`. Reads merge every file in that folder plus the old `time_pipeline.db`, which is still read and never written again. The newest `updated_at` wins per key. A delete is a tombstone. Every record read back carries the device whose file holds it, so provenance needs no field in stored values. An old plugin copy that still writes the old file loses nothing. Clock skew between PCs is accepted.
3. **A day's evidence is saved in parts.** Key `day_evidence:<date>:<device_id>`. An old `day_evidence:<date>` record reads as a part from "unknown device". `time_review__read_day` returns all parts as one time-ordered day, each row labelled with its device name.
4. **`save_evidence` takes the date only.** The server reads the day's outcomes and rows from the gate query itself, stamps the device, and writes this device's part. To confirm in source first: that the timekeeping bundle can import the `timecamping.db` backend.
   **Note, 2026-11-13:** not to be built as written, because it makes the `timekeeping` server read the TimeCamp-shaped `timecamping.db`. The rule that billing's core dependency is its `timekeeping` server and TimeCamp is optional is stated in `source/billing/VISION.md` (issue 283). The map "Billing without TimeCamp" decides what replaces it.
5. **The registry is one shared record**, `time_registry` in the store, with the six source entries as today and a `devices` map: `{<device_id>: {name, syncopaid: {enabled}, telus_archive_folder}}`. A device's old `time_tracking` block is copied in once. A device missing from `devices` is asked only the device questions. It is never treated as `skipped`.
6. **The gate's expected set is built by the server from the registry:** each enabled shared source once, plus `syncopaid_captures` for each device with `syncopaid.enabled: true`. `stage_day` refuses with `evidence_short` and names each missing (source, device).
7. **One gather step on every host.** A run gathers what the running device can supply, saves its part, then asks the gate. It stops only on a named gap, for example "`syncopaid_captures` on Office PC has no outcome for 12 dates: run `/bill` there, it resumes at this step". The Cowork stop and the "PC only" bullet are deleted. In Cowork the SyncoPaid command line cannot be reached, so the same named stop appears there with no host rule.
8. **Review page.** It is served by whichever PC runs the server. A card whose image is on another device shows the saved reading and that device's name.
9. **Claims.** `review_date__status` reports a date that two devices claimed or judged, naming both. Until sync catches up, two PCs can still claim one date. The report makes that visible.

## Constraints that still hold

- No inference on a day until every expected (source, device) has a terminal outcome.
- `skipped` only by an explicit registry entry.
- Screenshots are read only with SyncoPaid's own evidence access on. Rows hold metadata only.
- One judgment per date. Approvals come only from a click on the review page. No TimeCamp write without the practitioner's say.
- A capture is read once: a saved `capture_reading` is reused whichever device holds the image.

## Slices, each with its check

1. **Device id and per-device store files.** Test: two fixtures share one `_practice` folder with different `probanda.json` files. A `candidate_date` written on A is listed on B. A day judged on A reads back on B with its evidence and blocks. Two claims on one date are reported.
2. **Evidence parts and the gate.** Tests: `save_evidence` with a date only writes this device's part. `read_day` merges two parts in time order with device labels. The gate is short while a registered device's SyncoPaid part is missing, and names it. Then run the slice 13 replay of the build plan.
3. **Shared registry.** Rewrite `time-sorting/protocols/FirstSetup.md` for the shared record and the device questions. Keep the No-registry rule once, there, and delete its copies at `timecamping/SKILL.md:88-96`, `build-timeline/SKILL.md:229-235` and `time-sorting/SKILL.md:180-182`.
4. **Skill and agent text.** Delete the Cowork stop at `bill/SKILL.md:142` and the bullet at `timecamping/SKILL.md:327`. Parallel mode's gather line loses "and the day's rows". `timecamping/reference/sources.md:73-75` becomes the shared-source rule. The `day-reviewer` brief says the rows carry device labels. Check: grep finds no "In Cowork, stop" and no "PC only" in the billing skills, then `build_plugin.py` and `check_plugin.py` pass.

Each slice ends as the build plan's "Every slice ends the same way" says. The store change is a minor bump, made by `/release`.

## Deferred

- **Reading another PC's captures through SyncoPaid's two-PC sync** (SyncoPaid 1.4.160). It needs SyncoPaid's `evidence` command to report each row's device and whether another PC's day has fully arrived. When it does, one PC can supply every device's SyncoPaid part.
- **`timecamping.db`** stays where it is until the timetracking-data conversion (`2026-11-10_data-store-restructure-phase-2.md`, decision 5). Two PCs gathering at once can still lose a fetch there. The gate then fails closed, and the saved day parts are not affected.
- A server tool that runs the SyncoPaid command line, so a Cowork session can gather captures.
