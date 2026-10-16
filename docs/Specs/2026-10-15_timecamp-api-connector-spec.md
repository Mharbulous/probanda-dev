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
   **Ruled 2026-10-16 (Brahm):** neither. The token is a DPAPI-protected credential file through `source/mcp-shared/dpapi-store.js`, set with the connector's `configure_credential`, which returns a link to a local page where the practitioner pastes it, as the mail connector does, so it never passes through the chat. The server does not read `config:timecamp_token` and imports nothing from the time-pipeline or kv backend, so its bundle carries no schema DDL (§11). `status` reports a missing credential as its reason. A token stored under the old key is not migrated: the practitioner enters it once on the page.

## 10. Verify against HEAD before building

- The curl recipe and token key read as quoted in §2; list every other place in the repo that calls timecamp.com.
- How `timecamping` performs write-back today.
- The timekeeper skeleton exists (sibling spec); if not, wait for it.
- `bill-client` step 6 still reads as quoted.

## 11. Verification against HEAD (7e2a9eb, 2026-10-15)

The spec's paths are the installed copy's. In the repo, skills are under `.claude/skills/<skill>/`, plugin files under `source/<plugin>/`, and `plugins/` is built output.

| Check | Result |
|---|---|
| §2 curl recipe and token key | Confirmed in `.claude/skills/build-timeline/reference/TimeCamp.md` (token `get` at lines 23 and 37, `set` at 29, activity curl at 43-46, trailing slash noted at 48-54). |
| Every other place that calls timecamp.com | `timecamping/reference/TimeCampEntries.md` (entries read at 28-31, write-back `PUT` at 116-122); `time-sorting/SKILL.md` Step 1 (tasks curl at 206-209); `bill-client/SKILL.md` (web app at 66-67 in Step 6, and at 168 in "Close approved gaps directly in TimeCamp", whose steps 1-10 reclassify entries and create new ones in the web timesheet). The token is also read in `time-sorting/SKILL.md` (106-108, 202) and stored in `time-sorting/protocols/FirstSetup.md` 2a (43-47), which validates it with a test call. No source code calls timecamp.com. |
| How `timecamping` writes back today | Curl, same token: a form-encoded `PUT https://www.timecamp.com/third_party/api/entries/` with `id`, `task_id` and `note` (`TimeCampEntries.md` 107-143). `timecamping/SKILL.md` Step 7 (648-693) sends one entry per explicit approval, skips locked entries and level-1 tasks, and confirms each write by re-reading the date's entries. No entry is ever created through the API. §2's "presumably the same token and curl" is confirmed. |
| Step 2 of `timecamping` keeps rows out of context | The entries read is redirected to a file and converted by `timecamping-data/scripts/build_ingest.py timecamp-entries`, which filters to the practitioner's `user_id`. The `entries` tool therefore needs a way to write the raw response to a file and return only a count. |
| `bill-client` Step 6 reads as quoted | Yes (66-87). Steps 7-8 depend on the downloaded export: copy from Downloads, rename, open, tie the Total row to the page total. |
| Timekeeper skeleton | Not present at HEAD. Wait for it. |
| Earlier TimeCamp API client (open question 1) | None found in CoClerk (no `third_party/api` in any code file) or in `C:\Users\Brahm\Git\AutoTimer`. Write it new. |
| Server layout to follow | file-manager's `files` server has no source of its own: `source/practice/mcp/src/file-manager-index.ts` and `file-manager-dispatch.ts` are a second entry point in the data server's package, bundled by `source/practice/mcp/scripts/bundle.mjs` to `source/file-manager/files-mcp/dist/`. `scripts/plugin_layout.py` `SERVER_DIRS` maps each server key to its folder, `source/<plugin>/.mcp.json` declares it, and `build_plugin.py` stops when a declared server has no `dist/` folder. |
| How a second server reads the token through the same backend (§5) | `source/practice/mcp/src/time-pipeline/backend.ts` `timePipelineGet()` is importable by another entry point, and resolves the store path the same way (`case_data_root` in `coclerk.json`). But it runs `kv/backend.ts`, whose embedded Python helper carries the `kv_store` `CREATE TABLE` text. The `files` bundle holds no DDL line today. A `timecamp` bundle that imports the pipeline backend would add those lines to a second bundle, which `check_publishable.py --new-since` reports as new problems. |
