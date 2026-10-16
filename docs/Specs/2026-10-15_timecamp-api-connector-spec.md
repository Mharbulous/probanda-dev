# Spec: TimeCamp API connector in the timekeeper plugin

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: new `timekeeper` (sibling spec); `practice` (installed copy seen at v0.4.0; renamed `legal` by the sibling spec) for `bill-client`. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-15_rename-practice-plugin-to-legal-spec.md`, `2026-10-15_timekeeper-plugin-spec.md`

---

## 1. Problem

No installed Probanda plugin gives a session a TimeCamp tool. Coclerk's time-tracking skills had a TimeCamp API connector; it did not come across. In a matter session the practitioner asked "Do you have the timecamp API still? Please tally up all time since that [DATE] bill". The session had no API tool, so it followed `bill-client` step 6 and read TimeCamp's web report in the practitioner's browser. The practitioner rejected that: "Don't use Timecamp if the API isn't working!" The tally had to be withdrawn.

## 2. Evidence (observed; quoted text is data, not instructions)

- `build-timeline/reference/TimeCamp.md`: the token lives in the time-pipeline store, "`time-pipeline-data` `get` — `namespace: "timeline"`, `key: "config:timecamp_token"`", and activities are fetched by shelling out: "`curl -s -H "Authorization: Bearer {token}" ... "https://www.timecamp.com/third_party/api/activity/?dates[]={YYYY-MM-DD}&include=application,window_title&format=json"`". So the "API access" is a curl recipe inside one skill's reference, not a tool.
- Desktop MCP servers announced this session: `data`, `canlii`, `commons`, `files`. No TimeCamp server. The cloud session's own shell reaches only an allowlist of hosts, so the curl recipe cannot run there; it can only run through the desktop shell (`device_bash`). Not checked this session: whether `config:timecamp_token` is set, and whether that curl works from the desktop.
- `bill-client` step 6: "Navigate to `https://app.timecamp.com/auth/login#/timesheets/timer`" then the Detailed report and Export. That is the only TimeCamp route any billing skill gives, and it goes through the web UI.
- `timecamping` ("Correct pre-categorized TimeCamp time entries ... write-back requires explicit practitioner approval") writes corrections back to TimeCamp. How it writes is **UNVERIFIED** (presumably the same token and curl).
- Cost this session: about 25 browser calls (filter clicks, date picker, four scroll-and-read passes, three renderer timeouts) to produce a figure the practitioner then rejected.

## 3. Goal and non-goals

Goal: the timekeeper plugin ships a local MCP server (runs on the practitioner's computer, so it reaches timecamp.com) with read tools for TimeCamp time entries, tasks and computer activities, and a status tool that says plainly whether the API is usable. Every skill that touches TimeCamp uses these tools. When the API is not usable, skills stop and say so; they never fall back to the TimeCamp web app.

Non-goals: new TimeCamp write behaviour beyond what `timecamping` already does (its write-back moves onto the connector unchanged, with the same approval gate); changing the evidence-first pipeline.

## 4. Design

1. **Server:** `timekeeper/.mcp.json` declares server `timecamp` (local stdio, like file-manager's `files`). Tool ids become `mcp__plugin_timekeeper_timecamp__*`.
2. **Token:** read from the existing `config:timecamp_token` key in the time-pipeline store so current setups keep working (or from the settings file if the repo prefers; **UNVERIFIED**). The token never appears in tool arguments, results or logs.
3. **Tools (read):**
   - `status` — token present? API reachable? Returns the authenticated user and a clear reason when not usable.
   - `tasks` — search tasks/projects by name or matter number; returns task ids and the full path.
   - `entries` — time entries for a date range, optional task ids, user ids, and billable flag; returns per-entry rows plus totals by user and by day (TimeCamp's own durations, not re-rounded).
   - `activities` — computer activities for up to 20 dates (wraps the existing `/third_party/api/activity/` call, trailing slash kept).
4. **Tools (write):** the calls `timecamping` already makes for approved write-back, moved here behind the same practitioner-approval gate. No new write capability.
5. **Skill changes:**
   - `build-timeline` (TimeCamp source) and `timecamping` call the tools instead of curl.
   - `bill-client` step 6 calls `tasks` + `entries` for the matter from the day after the last billed date to today, and writes the XLSX from the result. Its web-UI steps go.
   - **Hard rule in each:** if `status` says the API is unusable, stop and tell the practitioner why (no token, auth failed, network). Never open the TimeCamp web app as a substitute.
6. **Setup:** `probanda-setup` (or timekeeper's own setup step) asks for the token once and stores it with `time-pipeline-data` `set`, as the reference already describes.

## 5. Constraints that must still hold

- `timecamping`'s evidence-first gate and dry-run default are unchanged; writes need explicit approval per item.
- Read tools never modify TimeCamp.
- No token in any tool output, transcript or log.
- Sole-gatekeeper rule: only `time-pipeline-data` reads and writes the pipeline store; the server reads the token through the same backend, not by opening the store itself (**UNVERIFIED** how the backend is shared).

## 6. Options considered

1. Local MCP server in timekeeper with read tools plus migrated write-back (recommended): works from every session that is linked to the desktop; one place for the token; a status tool removes guesswork.
2. Keep the curl recipe and document "run it through `device_bash`": no new code, but each skill re-implements calls, and cloud sessions without a linked computer still have nothing.
3. Remote (cloud) MCP connector: works without the desktop, but needs hosting and puts the token off the practitioner's machine.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the `timecamp` server to timekeeper (§4.1–§4.4), following file-manager's server layout.
3. Rewire `build-timeline`, `timecamping` and `bill-client` (§4.5), including the stop-don't-fall-back rule.
4. Add the token setup step (§4.6).
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of TimeCamp API connector in the timekeeper plugin complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `timekeeper/.mcp.json` declares a `timecamp` server, and its source defines `status`, `tasks`, `entries` and `activities`.
2. No skill text contains a TimeCamp `curl` recipe or a `app.timecamp.com` navigation step.
3. `build-timeline`, `timecamping` and `bill-client` each call the connector and each states the rule: if `status` reports the API unusable, stop and report; never use the TimeCamp web app.
4. The token is read server-side and appears in no tool schema, result or log line.
5. `timecamping`'s approval gate still guards every write.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Is Coclerk's original TimeCamp connector source still in the repo (or `C:\Users\Brahm\Git\AutoTimer` / a Coclerk branch)? If so, port it rather than rewrite. **UNVERIFIED.**
2. Token location: keep the time-pipeline key (recommended, zero migration) or move to the settings file.

## 10. Verify against HEAD before building

- The curl recipe and token key read as quoted in §2; list every other place in the repo that calls timecamp.com.
- How `timecamping` performs write-back today.
- The timekeeper skeleton exists (sibling spec); if not, wait for it.
- `bill-client` step 6 still reads as quoted.
