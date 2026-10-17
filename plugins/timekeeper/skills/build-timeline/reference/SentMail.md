# Sent Mail Reference

Configuration and data details for the practitioner's sent mail. Load this file when fetching sent mail for the timeline. Registered as the seventh `/timecamping` evidence source in #1261.

## Configuration

**The source is the iCloud copy of the Microsoft 365 Sent Items**, not Microsoft 365 itself (decided on #1261; the copy is #1262). The outlook-dorst-copier (#1271), used since 2026-09-30, puts the copy in `Sent Messages`, the iCloud account's own sent folder (#942). An earlier copy method put messages in `Sent Items`, which held 1,799 messages on 2026-09-30 and none on 2026-10-01. It stays in scope in case mail lands there again. The copier copies each newly sent email from the Exchange default Sent folder only, so mail filed straight into Exchange's `Outbound LEAP Matter Based Emails` subfolder is not copied forward.

**Personal mail is stored.** `Sent Messages` is also the iCloud account's own sent folder, so it can hold personal mail sent from brahm@dorst.ca (1 of 1,073 messages since 2026-03-01). Those messages are stored like any other, with no filter on the sender (practitioner, 2026-10-01, #942: "Keep all"). The Microsoft Graph route in `Engineering/1. Design/2026-08-27_outlook-source-design.md` §1 is not used.

**Check which folders you are reading before you read them.** Four folders are in scope, listed in precedence order:

| Folder | In scope |
|---|---|
| `Sent Items` | Yes. When it is missing, read the others and name it in the run summary |
| `Sent Items/Outbound LEAP Matter Based Emails` | Yes. When it is missing, read the others and name the subfolder in the run summary |
| `Sent Messages` | Yes. Required: when it is missing, the day is `failed` |
| `Sent Messages/Outbound LEAP Matter Based Emails` | Yes. When it is missing, read the others and name the subfolder in the run summary |
| Any other folder under `Sent Items/` or `Sent Messages/` | No. Its presence makes the day `failed` until it is reviewed and added to this table |

Search each in-scope folder separately: a search does not include the folder's subfolders (checked live on #1261). `/timecamping-data`'s ingest script refuses a row from any folder other than the four in scope, so a folder added to this table after review must be added to the folders that script accepts as well.

**The route is the legal plugin's `contacts-calendars-email` server.** It reads the mailbox over IMAP with the credential set once through `mail__configure_credential`. The read uses exactly two of its mail tools, `mail__list_folders` and `mail__search_emails`. Never call any other:

- Its mail write, `mail__save_draft`. build-timeline never writes to a source, and marking a message read is a write.
- Its body reads: `mail__get_email`, `mail__download_attachment`, and `mail__search_emails` with `include_body: true`. This source is metadata only, never a body or an attachment.
- Its other mail reads: `mail__get_latest_emails`, `mail__find_email_by_message_id`, `mail__find_thread_messages`, `mail__folder_status`.
- Any `calendar__*` or `contacts__*` tool. The iCloud calendar is a source of its own (`ICloudCalendar.md`).

## Registry entry and coverage

The registry entry is `sent_mail` (`time-sorting/protocols/FirstSetup.md`). It may carry `copy_confirmed: "YYYY-MM-DD"`, the date #1262's close check passed, and `copy_from: "YYYY-MM-DD"`, the first day that check confirmed the copy holds. #1262 closed on 2026-10-01 on the practitioner's criterion that the past six months suffice, so the live entry carries `copy_confirmed: "2026-10-01"` and `copy_from: "2026-04-01"`.

- **No `copy_confirmed`**: do not read. Every day is `failed`, with an `error_detail` saying the iCloud Sent Items copy is not yet confirmed complete (#1262) and to set `copy_confirmed` when its close check passes. The copy is still uploading, so a read would return a partial day that looks complete.
- **`copy_confirmed` set**: every day from `copy_from` on is read, whether it falls before or after `copy_confirmed`. A day before `copy_from` is `failed`, with an `error_detail` saying the confirmed copy does not reach that date: a read would find nothing and record `empty` on mail never copied. An entry with `copy_confirmed` and no `copy_from` reads every day.

## Qualifying the route

Check the folders before any search. A read of the wrong folder, or of one folder short, returns a successful result with no error.

1. Call `mail__list_folders`.
2. **`Sent Messages` missing**: stop without reading. The source is `failed`, with an `error_detail` naming `Sent Messages` and the fix: check the configured account with `mail__configure_status`, and reconfigure with `mail__configure_credential` for the iCloud account that holds the Microsoft 365 copy.
3. **A folder under `Sent Items/` or `Sent Messages/` that the table does not list**: stop without reading. The source is `failed`, with an `error_detail` naming the folder and the fix: review it, then add it to the in-scope table.
4. **`Sent Items` or an `Outbound LEAP Matter Based Emails` subfolder missing**: read the other folders. This is not a failure. Name the missing folder in the run summary.

## Fetching messages

For local day D, call `mail__search_emails` once for each qualified folder, in the table's order, with:

- `folder`: the folder's exact name from the list.
- `since`: D minus one day, and `before`: D plus two days, both `YYYY-MM-DD`. The window is wider than the day on purpose: the server's date boundary is not UTC (checked live on #1261), so a window of D alone can miss the evening of D.
- `limit: 500`, the maximum.
- Nothing else. Never `include_body`, and no other filter.

**A timeout is retried once.** On a `mail_timeout` error, wait a few seconds and search that folder once more. If it fails again, the day is `failed`, with the error text as its `error_detail`. Never fall back to a browser or any other route.

**Keep only the messages sent on local day D.** Each message's `date` is ISO 8601 with its offset. Convert it to the practitioner's timezone (`probanda.json → time_tracking.timezone`, default `America/Vancouver`) and keep the message only when its date there is D.

**A truncated search is `failed`.** The response reports `totalFound` and `returned`. When `returned` is less than `totalFound`, or `returned` equals the limit of 500, the search may be missing messages: the day is `failed`, with an `error_detail` naming the folder and both counts. Never store a partial day.

Each message the search returns carries `uid`, `folder`, `date`, `from`, `to`, `subject`, `messageId`, `seen` and `size`, and `cc` when the message has a cc recipient (the search leaves `cc` out otherwise, as the extension did on #942). No body is returned. `/timecamping-data`'s ingest script requires `from` to be a string and `to` and any `cc` to be lists, reads a missing `cc` as no cc recipients, and fails the run on any other shape.

**One row per Message-ID, and the copy in the earliest folder of the table wins.** A message whose Message-ID is already among the messages kept from an earlier folder is not stored again. The same Message-ID twice in one folder fails the day.

## Building the row

A sent email has a single instant and no duration, so it is stored as an **event** in the `timeline` namespace: `event:{id}`, indexed under `index:event:by-date:{YYYY-MM-DD}` and `index:event:by-source:sent_mail` (build-timeline's Event row schema).

- **`native_id`** is the message's RFC 5322 Message-ID, its `messageId` with the angle brackets stripped. The row id is `sent_mail:{message-id}`. The Message-ID is the same wherever the message is held: the iCloud copy keeps the original Exchange Message-ID (checked live on #1261). A message in several folders is therefore one row, and any later route, such as Graph or a re-copy, must key on the same Message-ID and feed this same source, never a second one (#1263). A message with no `messageId` fails the day, naming its folder and `uid`: never compose a substitute key.
- **`ts`** is the message's `date`, converted to UTC.
- **`raw_type`** is `"email_sent"`, a fixed constant for this source (design doc §1), never inferred from content.
- **`raw_payload`** is the search result message verbatim: `uid`, `folder`, `date`, `from`, `to`, `cc` when present, `subject`, `messageId`, `seen`, `size`. Never a body.

A re-fetch of day D replaces that day's rows through build-timeline's replace-by-source, and a message keeps its row id because the Message-ID does not change.

## Meeting responses

A sent meeting response (`Accepted: …`, `Declined: …`, `Tentative: …`, `Canceled: …` and similar automatic replies) is stored like any other sent message. Whether it is only a marker is `/timecamping` Step 5's decision, never made here.

## Empty is not failed

A qualified, covered read in which no kept message falls on day D is **`empty`**, a terminal status. A day that was never read is `failed`, never `empty`: no `copy_confirmed`, no mail credential, a folder check that stopped the read, or a truncated search. An `empty` for an unread day releases `/timecamping`'s assembly gate on missing evidence.

## Exit paths

Every exit records a status for `/timecamping`, because a registered source blocks every day until it reaches a terminal one. `fetched`, `empty` and `skipped` release the day. `failed` keeps it blocked until a re-run succeeds.

| Situation | Status | `error_detail` |
|---|---|---|
| Qualified, covered read, messages kept | `fetched` | none |
| Qualified, covered read, zero messages kept | `empty` | none |
| Registry entry `enabled: false` | `skipped` | none |
| Registry present but has no `sent_mail` entry | `failed` | No `time_tracking.sources` entry for `sent_mail`; add one with `enabled: true` or `enabled: false` |
| The entry has no `copy_confirmed` | `failed` | The iCloud Sent Items copy is not yet confirmed complete (#1262); set the entry's `copy_confirmed` to the date its close check passes |
| The day is before the entry's `copy_from` | `failed` | The confirmed iCloud copy starts at `copy_from`; this day is not covered |
| The mail credential is not configured (`mail__configure_status`, or a `mail_not_configured` error) | `failed` | Configure it with `mail__configure_credential` and re-run the date, or set the `sent_mail` entry's `enabled` to `false` to record `skipped` |
| The folder list has no `Sent Messages` | `failed` | Names `Sent Messages` and the fix (qualification step 2) |
| The folder list has a folder under `Sent Items/` or `Sent Messages/` that the table does not list | `failed` | Names the folder and the fix (qualification step 3) |
| The folder list lacks `Sent Items` or an `Outbound LEAP Matter Based Emails` subfolder | `fetched` or `empty`, on the other folders | none. The run summary names the missing folder |
| A search is truncated | `failed` | Names the folder and both counts |
| Any other error | `failed` | The error, and the fix |

Only `enabled: false` records `skipped`. An unconfigured mail credential is `failed`, as a missing extension is for the iCloud calendar: the day waits until the credential is configured.
