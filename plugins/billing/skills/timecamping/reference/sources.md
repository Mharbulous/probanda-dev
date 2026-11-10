Read when: Step 2 populates the per-source tables, or a Backfill fetches a closed day's missing sources.

# Evidence sources and Step 2

## Source integration

Seven evidence sources. Reuse the existing `probanda.json →
time_tracking.sources` registry (the same accounts/tokens `build-timeline`
already uses) rather than a second config surface — extend the existing
`timecamp` registry entry's capabilities rather than registering a
duplicate source for the Time Entries fetch. A missing registry is handled
by Step 0.

| Source | Mechanism | Reference |
|---|---|---|
| TimeCamp computer activity | **Delegate**: invoke `/build-timeline` for the target date, then have `/time-pipeline-data` export its stored rows (prefix `activity:timecamp:`) to a file and convert them with the gatekeeper's `build_ingest.py timeline --source timecamp`. No independent HTTP call. | `build-timeline/reference/TimeCamp.md` |
| Telus calls | **Delegate** to `/build-timeline`, whose Telus source imports the whole call archive and loads it, with each covered date's status, through the bulk ingest. Nothing to export or convert here. No archive covers the day → `skipped`, a terminal (gate-satisfying) status, not `failed`. | `build-timeline/reference/TelusConnect.md` |
| SyncoPaid captures | **New fetch, capture-level** — not build-timeline's coarser block-level call, which discards the per-capture/OCR detail every SyncoPaid-heavy fixture needs. Redirect the `evidence query ... --include-ocr-text` output to a file, then convert it with `build_ingest.py syncopaid-captures`. Same live-opt-in gate as build-timeline's fetch. | `reference/SyncoPaidCaptures.md` |
| TimeCamp time entries | **New fetch** — the practitioner's own amber/green timesheet rows, a different endpoint from build-timeline's computer-activity fetch. The `timecamp` connector's `entries` writes the day's rows to a file (`out_file`), then `build_ingest.py timecamp-entries` converts it, filtering to the practitioner's own `user_id`. Same connector. | `reference/TimeCampEntries.md` |
| Google Calendar | **Delegate** the same way: export prefix `activity:gcal:`, convert with `--source gcal`. build-timeline owns the registry entry and the fetch; this skill qualifies the route first and never reads a calendar independently. Registered as the fifth source in #454; the doctrine behind it is #421's. | `build-timeline/reference/GoogleCalendar.md` |
| iCloud calendar | **Delegate** the same way: export prefix `activity:icloud:`, convert with `--source icloud`. build-timeline owns the registry entry and the fetch, which runs through the lawyer plugin's `calendar__*` tools with the Probanda mail connector's credential. Only the `Work` and `Home` calendars are read; `Family` never is. Registered as the sixth source in #1199. | `build-timeline/reference/ICloudCalendar.md` |
| Sent mail | **Delegate** the same way, but sent mail is stored as events, not activities: export prefix `event:sent_mail:`, convert with `--source sent_mail`. build-timeline owns the registry entry and the fetch, which reads the iCloud copy of the Microsoft 365 Sent Items through the lawyer plugin's data server's mail tools. Only `Sent Items`, `Sent Messages` and their `Outbound LEAP Matter Based Emails` subfolders are read. Subject, recipients and sent time only, never a body. Registered as the seventh source in #1261. | `build-timeline/reference/SentMail.md` |

## Step 2 procedure

`/timecamping-data`
documents the script (`build_ingest.py`), its subcommands and the file shape (Bulk ingest file);
run it with the host Python (`python`; if that is the WindowsApps stub, the
interpreter `COCLERK_PYTHON` names). Pass `--timezone` with the value from
`probanda.json → time_tracking.timezone` to every subcommand that takes it,
and `America/Vancouver` when the key is unset.
For each of the seven sources above, in any order:

1. **Produce the source's material as a file.** A delegated source: run
   `/build-timeline` for the date, then have `/time-pipeline-data` export the
   source's stored rows (prefix per the table above) to a scratch file. A new
   fetch: write the reference's read to a file (for TimeCamp entries, the
   connector's `entries` with `out_file`).
2. **Confirm a delegated source was fetched for the date** before converting
   it. For Google Calendar, the day must fall inside a range in
   `source:gcal:ranges`, read through `/time-pipeline-data`. For the iCloud
   calendar, this run's build-timeline report must show the route qualified
   and read, and the day must fall inside a range in `source:icloud:ranges`.
   For sent mail, this run's build-timeline report must show the folders
   qualified and read, and the day must fall inside a range in
   `source:sent_mail:ranges`.
   For TimeCamp, build-timeline must have reported the day fetched. Telus
   takes its outcome from build-timeline's report: fetched needs no line here,
   because the import already wrote the day's rows and status. Unconfirmed
   TimeCamp, Google Calendar, iCloud or sent mail is `failed` (step 4), with an
   `--error-detail` saying the source was not fetched for the date, unless it is
   unavailable as below, never `empty`: an `empty` for a day never fetched releases the assembly gate on
   missing evidence. Telus with no archive covering the day is `skipped`, and
   Telus reported failed is `failed` (step 4).
3. **Convert it** with the matching `build_ingest.py` subcommand, appending to
   the day's ingest file. It writes the source's rows and its `fetched` or
   `empty` status line.
4. **Every other exit writes its status line alone**, with `build_ingest.py
   fetch-log`: `skipped`, or `failed` with the reason as `--error-detail`.

Then load the day's file with one `/timecamping-data` bulk ingest. Re-running
a day rebuilds the file and loads it again; rows upsert in place on their
source key, so their ids stay stable.

A registry-disabled source (`enabled: false`), a live-gate-off source
(SyncoPaid), or a date no archive covers (Telus) is `skipped`, an expected,
terminal state — never `failed`. So is a source that can never be read for this
date, such as a carrier changed mid-period, a log past its retention window, or
sent mail before `copy_from`: its `--error-detail` starts `unavailable: ` and gives
the reason, which every proposal and invoice line on that date shows. A registry with no entry for a source is
`failed`, not `skipped`: only an explicit `enabled: false` may skip a source
(the `timecamp` entry covers both TimeCamp sources). A genuine fetch error
(bad token, malformed response, network failure) is `failed`, and so is the
iCloud calendar on a machine whose mail credential has no calendar fields, and
sent mail on a machine with no mail credential: that day waits until the source can
be read. Sent mail is also `failed` on every day until its registry entry
carries `copy_confirmed`. One source's failure never blocks another's fetch.

**A registered source has teeth: every exit path records an outcome.** From
the moment a source's table name sits in the assembly gate's expected set,
every day blocks until it reaches a terminal status — so a fetch that returns
without writing a row strands that day. Enumerate the paths before running
one. For Google Calendar they are:

| Situation | Status |
|---|---|
| Route qualified (below), events returned | `fetched` |
| Route qualified, zero events | `empty` — a real and recurring state on this calendar, never `failed` |
| Registry entry `enabled: false` | `skipped` |
| Registry present but has no `gcal` entry | `failed`, `error_detail` saying there is no `time_tracking.sources` entry for `gcal` and to add one with `enabled: true` or `enabled: false` |
| Route's calendar list is missing the work calendar | `failed`, `error_detail` naming the missing calendar |
| Neither route reachable | `failed`, `error_detail` naming both routes and the fix |
| Any other fetch error | `failed`, `error_detail` carrying it |

**Qualify the calendar route before you trust its result.** Enumerate the
calendars the route can actually see and confirm the practitioner's work
calendar is among them — the identity table in
`build-timeline/reference/GoogleCalendar.md` is the authority on which one that
is and how to confirm an event's membership. On a mismatch record `failed` and
stop; do **not** proceed on the partial view. Name
the route used and the calendars it covered in the run summary, so a
wrong-calendar read is visible in the output rather than inferred months later.

For the iCloud calendar the paths are:

| Situation | Status |
|---|---|
| Route qualified (below), events returned | `fetched` |
| Route qualified, zero events | `empty` — the calendar is sparse, and this is never `failed` |
| Registry entry `enabled: false` | `skipped` |
| Registry present but has no `icloud` entry | `failed`, `error_detail` saying there is no `time_tracking.sources` entry for `icloud` and to add one with `enabled: true` or `enabled: false` |
| Calendar not configured (`dav_not_configured`) | `failed`, `error_detail` saying calendar not configured: run `mail__configure_credential` with the calendar fields, or set the `icloud` entry's `enabled: false` to record `skipped` |
| Calendar list is missing the `Work` calendar | `failed`, `error_detail` naming `Work`, its URL and the fix |
| Calendar list is missing only the `Home` calendar | `fetched` or `empty` on `Work` alone, with `Home` named as missing in the run summary |
| Any other fetch error | `failed`, `error_detail` carrying it and naming the fix |

**Qualify the iCloud route by calendar URL before you trust its result.** `build-timeline/reference/ICloudCalendar.md`
is the authority on the calendars and the procedure. Name the calendars read in the run
summary.

For sent mail the paths are:

| Situation | Status |
|---|---|
| Folders qualified (below), copy confirmed, messages kept for the day | `fetched` |
| Folders qualified, copy confirmed, zero messages kept for the day | `empty` |
| Registry entry `enabled: false` | `skipped` |
| Registry present but has no `sent_mail` entry | `failed`, `error_detail` saying there is no `time_tracking.sources` entry for `sent_mail` and to add one with `enabled: true` or `enabled: false` |
| The `sent_mail` entry has no `copy_confirmed` | `failed`, `error_detail` saying the iCloud Sent Items copy is not yet confirmed complete (#1262) and to set `copy_confirmed` when its close check passes |
| The day is before the entry's `copy_from` | `failed`, `error_detail` saying the confirmed copy does not reach that date |
| The mail credential is not configured (`mail__configure_status`, or a `mail_not_configured` error) | `failed`, `error_detail` saying to configure it with `mail__configure_credential` and re-run the date, or to set the `sent_mail` entry's `enabled: false` to record `skipped` |
| Folder list is missing `Sent Messages` | `failed`, `error_detail` naming `Sent Messages` and the fix |
| Folder list has a folder under `Sent Items/` or `Sent Messages/` that the reference does not list | `failed`, `error_detail` naming the folder and the fix: add it to the in-scope table after review |
| Folder list is missing only `Sent Items` or an `Outbound LEAP Matter Based Emails` subfolder | `fetched` or `empty` on the other folders, with the missing folder named in the run summary |
| A search is truncated | `failed`, `error_detail` naming the folder and both counts |
| Any other fetch error | `failed`, `error_detail` carrying it and naming the fix |

`empty` is never recorded for a day that was not read or not covered.

**Qualify the sent-mail folders before you trust the result.** `build-timeline/reference/SentMail.md`
is the authority on the folders, the day window and the procedure. Name the folders read in
the run summary.

## Source fields

**Never fabricate a field a live source doesn't actually return.** Both
new reference files (`TimeCampEntries.md`, `SyncoPaidCaptures.md`) name
exactly what's confirmed vs. still open — extend a schema additively
through the gatekeeper skill's migration process when a live check
reveals more, never by guessing ahead of verification.
