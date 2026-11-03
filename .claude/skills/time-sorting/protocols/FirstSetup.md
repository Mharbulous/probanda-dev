# First Setup Protocol

Run this protocol the first time a user invokes `/time-sorting`, `/build-timeline` or `/timecamping`, under the No-registry rule below. This covers one-time setup steps that do not repeat on subsequent sorts.

**Registry location:** the time-tracking registry is the `time_tracking` block of the machine-level `probanda.json`, the same file practice-data resolves for `case_data_root` (normally `AppData\Roaming\Coclerk\probanda.json`; see practice-data's operations/configuration.md, and under `COCLERK_CONFIG_PATH` the file that variable names is the one read and written back). It is per-practitioner, never in a matter's `probanda.json`. `/time-sorting`, `/build-timeline` and `/timecamping` all read it there, and Step 5 below writes back to the same file the calling skill's Step 0 read.

**No-registry rule (trigger):** when `time_tracking` is absent from that file, or `time_tracking.sources` is absent or empty, a `/time-sorting`, `/build-timeline` or `/timecamping` session stops and runs this protocol before anything else. It never proceeds without a registry, and never records a source `skipped` because the registry is missing. A source is `skipped` only because its registry entry says `enabled: false`.

## Step 1 — Discover Time-Tracking Tools

Ask the user which tools they use to track their time. Present as a multi-select checklist — most practitioners use a combination:

1. **TimeCamp** — "Desktop app that tracks which applications and websites you use"
2. **Google Calendar** — "For court dates, meetings, and appointments"
3. **iCloud Calendar** — "Your Apple calendars (Work and Home)"
4. **Telus Business Connect** — "Phone call logs from your Telus business phone"
5. **SyncoPaid** — "Screen-activity capture with your own on/off switch — you control when it's recording"
6. **Something else** — "Another tool not listed here"

If the user selects "Something else," ask them to name the tool. Check against this list of recognized tools that are not available as ongoing sources:

| Tool | Category | Status |
|------|----------|--------|
| Chrometa | screen_activity | Historical import only — no ongoing capture |
| RingCentral | telephony | Not yet supported |
| Clio Manage (time tracking) | time_entry | Not yet supported |
| Toggl | time_entry | Not yet supported |

If the named tool matches one of these, acknowledge it specifically: *"I know what [tool] is — it captures [category]. I don't have an integration for it yet, but I'll note it so we can add support later."*

If the named tool is **Chrometa**, say instead: *"I know Chrometa — it's screen-activity tracking. There's no live integration, but if you still have your Chrometa export file, I can do a one-time historical import of it into your timeline once setup is finished. Just say 'import Chrometa historical logs'."* Do not add Chrometa to `unsupported_noted`, and do not count it toward the minimum-requirement check below — the import is not an ongoing source.

If the named tool is completely unknown, ask the practitioner what it does (screen tracking? phone logs? calendar? manual time entry?) so it can be categorized and recorded.

**Minimum requirement:** At least one supported source (TimeCamp, Google Calendar, iCloud Calendar, Telus Business Connect, or SyncoPaid) must be selected to proceed. If the practitioner only uses unsupported tools, explain that time-sorting currently requires at least one of the five supported sources, and offer to note their tools for future integration.

## Step 2 — Per-Source Setup

For each supported source the user selected, run its setup sub-procedure. These run in sequence since each is a short conversational exchange.

### 2a: TimeCamp Setup

1. Check the connector: call the timekeeper plugin's `timecamp` connector's `status`. Its tools are named without their prefix: call each under whichever of `mcp__plugin_timekeeper_timecamp__<name>` and `mcp__remote-devices__plugin_timekeeper_timecamp__<name>` this host grants. It holds the TimeCamp API token itself, and no skill reads, stores or passes it.
2. If it reports `usable: true`, confirm: *"TimeCamp is already connected as {user}. Want to keep using that token, or replace it?"*
3. If no token is set, or the practitioner wants to replace it, call the connector's `configure_credential` and send the practitioner the link it returns: *"I need your TimeCamp API token to fetch your computer activities. Paste it on this page, not in chat: {link}. You can find it at: TimeCamp > click your avatar > Profile Settings > scroll to the bottom for 'Your programming API token'."*
4. When they say it is done, call `status` again. The page has already checked the token with TimeCamp before saving it.
5. If `status` still reports `usable: false`, tell the practitioner its reason (no token, auth refused, network) and offer a new link. Never open the TimeCamp web app as a substitute.
6. On success: *"TimeCamp is connected."*

### 2b: Google Calendar Setup

1. Check whether the Google Calendar MCP server is available and authenticated (attempt an MCP call).
2. If authenticated: *"Google Calendar is already connected."*
3. If not authenticated: *"Google Calendar needs to be connected through your Cowork settings."* Invoke `mcp__claude_ai_Google_Calendar__authenticate` to start the auth flow.
4. If the MCP server is not available at all (not installed): *"The Google Calendar connector isn't set up in Cowork yet. You can add it under Settings > Customize > Connectors. I'll keep Google Calendar registered as in use. The only other way I can read it is through Claude in Chrome, from your signed-in Google Calendar. On any day I can read it neither way, Google Calendar is recorded as failed, and `/timecamping` keeps that day blocked from review. To clear it, either add the connector (or run the day where Claude in Chrome can reach your calendar) and re-run the day, or tell me to stop using Google Calendar and re-run the day, so it is recorded as skipped (deliberately left out)."* The registry entry stays `enabled: true`; the second fix sets the `gcal` entry to `enabled: false`. The routes are defined in `build-timeline/reference/GoogleCalendar.md`.

### 2b-2: iCloud Calendar Setup

1. The calendar is read through the Probanda mail connector (`build-timeline/reference/ICloudCalendar.md`). Call `mail__configure_status`. When `calendar_configured` is false, set it up with the same `mail__configure_credential` call that sets up mail, adding the calendar fields `caldav_url` and `timezone`, and `dav_username` when the calendar sign-in name differs from the mail username. For iCloud: `imap.mail.me.com`, `https://caldav.icloud.com`, `America/Vancouver` or the practitioner's own zone, and the Apple ID as `dav_username`. The practitioner types the app-specific password on the page it links to, never in chat.
2. Inform: *"Your calendar is read through the Probanda mail connector, with the same app-specific password as your mail. Only your Work and Home calendars are read, never Family."*

### 2b-3: Mail Setup

1. Call `mail__configure_status`. If it reports `configured: true`: *"Your mail is already connected."*
2. If `configured: false`, ask for the server details in one message, and never for the password: *"To read your sent mail I need your mail server's IMAP host and port, and your username. For iCloud the host is `imap.mail.me.com` and the port is 993. Don't send me your password: you'll type it on a page on this computer in the next step."*
3. Call `mail__configure_credential` with the answers. Send the practitioner its `url`: *"Open this link and enter your app-specific password there. For iCloud, create one at account.apple.com. The page signs in and tells you whether it worked. Tell me when it's done."* When they say it's done, call `mail__configure_status` and report the result.
4. If the practitioner types a password into the chat anyway, don't use it, and don't repeat it. Tell them it has been exposed and that they should revoke it and create a new app-specific password, then enter the new one on the page.

### 2c: Telus Business Connect Setup

1. Ask: *"Which folder holds your zipped Telus call logs?"* Save the answer as the entry's `archive_folder`.
2. Ask: *"Which extensions on that line are yours? Give each as the call log writes it, such as `4 - Your Name`."* Save the answers as the entry's `own_extensions` list. Calls on any other extension are left out.

### 2d: SyncoPaid Setup

1. Check whether SyncoPaid's evidence capture is currently on: run `SyncoPaid.Diagnostics evidence status`.
2. If enabled: *"SyncoPaid's evidence capture is on. I'll pull your screen-activity blocks each time I build a timeline."*
3. If disabled: *"SyncoPaid is installed but evidence capture is switched off. That switch lives inside SyncoPaid's own settings and only you can flip it — I never turn it on for you. Until you do, I'll register SyncoPaid and report it as skipped on each build."* SyncoPaid is still registered as a source in Step 5 below even if disabled right now — the registry entry and the live opt-in are independent, and the practitioner may flip the switch at any later time. Then stop this sub-procedure and continue the protocol.
4. Never call `evidence enable`, under any circumstance — turning capture on is the practitioner's act alone.
5. Tell the practitioner, once, here: *"SyncoPaid's screen-activity data spans all your clients, not just one at a time — I keep it in your local timeline store rather than deleting it after use, the same way I already keep TimeCamp's data, so I have a complete record to build from."*

## Step 3 — API-Specific Privacy Note

The general privacy briefing (local storage, training opt-out) is handled during device setup (`probanda-setup` Step 5), and client name exclusion by retainer-tracking's First Import. This step covers only the API-specific concern for time-sorting.

Briefly inform the practitioner:

> "When I fetch your activity data from [list configured API sources, e.g. "TimeCamp and Google Calendar"], the request goes through an encrypted connection straight to your local machine. I never store it anywhere except your local database, and I never write anything back to these services — all access is strictly read-only."

No user action required — this is informational only.

## Step 4 — Offer Source Research

For each configured source and each unsupported-but-noted tool, offer to research optimal settings and export capabilities:

*"Would you like me to do some quick research on getting the best data out of [your configured sources]? For example, I can look into TimeCamp's optimal settings for window title tracking, or tips for exporting Telus call logs. This runs in the background and won't slow things down."*

If approved:

1. Spawn a **background research subagent** for each tool that does not already have a reference file at `reference/[ToolName].md`
2. While subagents run, proceed immediately to Step 5 (do not wait)
3. When a subagent returns, review its findings critically — research agents can sometimes confuse similar products. Cross-check claims against what the user confirmed
4. Save vetted findings to `reference/[ToolName].md` for future sessions

If declined, skip.

## Step 5 — Save Configuration and Hand Off

Save the time-tracking configuration under a new `time_tracking` top-level key of the machine-level `probanda.json` (Registry location, above), writing back to the same file the calling skill's Step 0 read and keeping every other key:

```json
{
  "time_tracking": {
    "configured_at": "<ISO 8601 timestamp>",
    "sources": [
      {
        "id": "timecamp",
        "type": "screen_activity",
        "enabled": true,
        "auth": "store",
        "reference": "build-timeline/reference/TimeCamp.md"
      },
      {
        "id": "gcal",
        "type": "calendar",
        "enabled": true,
        "auth": "mcp",
        "reference": "build-timeline/reference/GoogleCalendar.md"
      },
      {
        "id": "icloud",
        "type": "calendar",
        "enabled": true,
        "auth": "mcp",
        "reference": "build-timeline/reference/ICloudCalendar.md"
      },
      {
        "id": "sent_mail",
        "type": "email",
        "enabled": true,
        "auth": "mcp",
        "reference": "build-timeline/reference/SentMail.md"
      },
      {
        "id": "telus",
        "type": "telephony",
        "enabled": true,
        "auth": "none",
        "archive_folder": "<the folder from step 2c>",
        "own_extensions": ["<each extension from step 2c>"],
        "reference": "build-timeline/reference/TelusConnect.md"
      },
      {
        "id": "syncopaid",
        "type": "screen_activity",
        "enabled": true,
        "auth": "cli_opt_in",
        "reference": "build-timeline/reference/SyncoPaid.md"
      }
    ],
    "unsupported_noted": ["ringcentral"]
  }
}
```

Write an entry for every supported source: `enabled: true` for the sources the user selected, `enabled: false` for the rest. A registry written here therefore never lacks an entry, so every `skipped` status traces to an explicit choice. The `auth` field indicates how credentials are managed:
- `"store"` — API token stored in the time-pipeline store
- `"mcp"` — MCP server handles authentication
- `"none"` — no credential; the source is read from local files
- `"cli_opt_in"` — no credential is stored or held; access is a live on/off toggle inside the tool's own settings, re-checked before every fetch

The `sent_mail` entry may also carry `copy_confirmed: "YYYY-MM-DD"`, the date the iCloud copy of the Microsoft 365 Sent Items was confirmed (#1262's close check), and `copy_from: "YYYY-MM-DD"`, the first day that check confirmed the copy holds. This step never writes either. Until it is set, every sent-mail day is `failed` (`build-timeline/reference/SentMail.md`).

`time_tracking` may also carry an optional `timezone` key: an IANA timezone name such as `"America/Vancouver"`, the practitioner's local timezone for resolving dates and displaying times. When the key is absent, every reader uses the default `"America/Vancouver"`, the same default the ingest scripts use. This step does not write it.

Summarize what was configured:

> "All set. Here's your time-tracking setup:
> - **TimeCamp**: Connected (token saved by the TimeCamp connector)
> - **Google Calendar**: Connected (MCP authenticated)
> - **iCloud Calendar**: Registered (read through the Probanda mail connector; Work and Home only)
> - **Sent mail**: Registered (the iCloud copy of Sent Items, read through the lawyer plugin's mail tools; read once that copy is confirmed complete)
> - **Telus Business Connect**: Ready (read from your call-log folder)
> - **SyncoPaid**: Registered (evidence capture status checked live on each build)
> - **[unselected source]**: Not used (registered as disabled)
>
> You can now say 'sort today's time' and I'll pull from all your configured sources."

If any unsupported tools were noted:

> "I've also noted that you use [tool]. I'll let you know when integration is available."

Return to the calling skill's Step 1 (in `/time-sorting`, Sync TimeCamp Project/Task Tree).

## What Does NOT Happen on Subsequent Sorts

On future sorts, the following are already configured and read from `probanda.json` without user interaction:

- Which time-tracking sources are enabled
- Authentication method for each source
- Unsupported tools noted for future integration

Exception: SyncoPaid's `cli_opt_in` gate is not settled at setup. Build-timeline re-checks `evidence status` live before every fetch, because the practitioner can flip that switch at any time outside Coclerk. This needs no user interaction on a normal sort — it is build-timeline's own check, reported as a `skipped` line when the switch is off.

The standard workflow in `SKILL.md` handles subsequent sorts directly. This protocol is only invoked under the No-registry rule at the top of this file.
