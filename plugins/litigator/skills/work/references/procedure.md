Read when: never whole. `skill_rules__applicable` serves this file one operation at a time (SKILL.md, "Rules for each step").
Assumes SKILL.md is loaded. These are `/draft`'s sections 6 and 7, moved verbatim under their numbers, and section 15's rows for this skill's files. Section 14 is `references/dispatch.md`.

<!-- atom id=work.enter.tools ops=enter -->
## 6. Enter the session

Every tool the opening needs was loaded in the one ToolSearch that SKILL.md, "Rules for each step", lists, which is the only list of them. `knowledge__list`, `knowledge__read` and `sources__check` serve the venue and kind lookup and the per-file source check. Staging is for mockup copies, and for a Job Board page or a requested Litigation Strategy page only on a remote-device-only host. Everywhere else the card tool presents the pages by their fixed paths (`shared/html-pages.md`). On such a host every tool name, the three knowledge-tree tools included, carries the host's prefix (e.g. `mcp__remote-devices__plugin_lawyer_data__drafting_forms__open_session`, `mcp__remote-devices__plugin_lawyer_data__knowledge__list`), so call those names.

<!-- atom id=work.enter.tools-not-found ops=enter,tools_not_found -->
**Tools not found.** If that search does not return `drafting_forms__open_session`, run one more ToolSearch for both full names together: `mcp__plugin_lawyer_data__drafting_forms__open_session` and `mcp__remote-devices__plugin_lawyer_data__drafting_forms__open_session`. If neither is found, stop. Never work around it, and never reach the matter's data another way. Then tell the practitioner which of two cases applies, by `draft/references/tools-not-found.md`, which holds the two cases (a Chat conversation, a Cowork task), how to tell them apart, and what to say in each.

<!-- atom id=work.enter.matter-folder ops=enter -->
**Matter folder.** The matter folder's path comes from one of three places: a folder this session already has connected, a path the practitioner gave in the request or in a file the request points to, or the matter linked to this session's claude.ai Project. In a Project session (its Project ID is in the session context), first call `practice_data__matter_lookup` with `project_id`. One row with a `matter_root` counts as a path the practitioner gave. More than one row: ask which matter, and never pick. No row, or a `matter_root` that is null: go on from the other two places. Never search for it. Do not call `device_list_dir`, list a directory, look in the knowledge tree or project memory for a matter root, or guess a path. On a remote-device host, call `get_device_info` once in every case, so the session knows whether the matter folder is connected. If more than one connected folder could be the matter, ask which one and never pick. On any host with no connected folder and no given path, ask for the matter folder's path in one line and stop. When the practitioner gave the path, go to session entry below. On a remote-device host where no entry in `connectedFolders` is the matter folder or holds it, make the folder request in the round trip right after session entry returns, before staging: call `device_request_folder_access` once for `matter_root`, with a one-line reason (the session shows the matter's pages and writes its drafts there) that names no page file. If the tool refuses the request on its own because of the path (its error names the path, for example that it cannot be displayed faithfully), make no request for any other folder. Never request a parent or the firm root. Say in one line that the remote grant refused the matter folder's path, and that the practitioner can connect the matter folder itself with "Add folder" in the Claude desktop app, after which the session will use it. Then carry on as on a decline. If the practitioner declines, never request again this session: say in one line what the folder holds and that the practitioner can ask to connect it when ready, say the pages cannot be shown as cards until then, and carry on, since session entry and every database write run on the PC through the plugin's own tools and need no grant. Staging and the cards happen in the same turn as the grant.

<!-- atom id=work.enter.call ops=enter -->
Then one call, `drafting_forms__open_session`, with the matter folder's absolute host path plus client name, client number and matter number when already known. This is the **only** entry, never a raw query, never a separate lookup, never a separate migrate first. An unattended run (section 14) also passes `unattended: true`, so the session token is minted in the unattended class the Job Board recognises. Keep the `matter_root` it returns and pass it on every `knowledge__list` and `knowledge__read` call. In a Project session whose `project_id` lookup returned no row, once session entry succeeds, call `practice_data__link_matter` with the matter number it returned, the `project_id` and that `matter_root`, and say in one line that this Project is now linked to the matter, so the next session here finds its folder. Quote a refusal in one line and go on. Never unlink a Project from another matter yourself.

<!-- atom id=work.enter.refusals ops=enter -->
**Refusals:**
- Unusable pointer or invalid matter root: quote the refusal in one line, point the practitioner at `/matter-data` to initialize or repair the pointer, and stop. Never heal or rewrite the pointer.
- More than one draft folder: quote the refusal in one line, ask the practitioner to keep one `0. DRAFT` folder, and stop. Never pick one.
- No database at the derived path: run `drafting_data__migrate` on the path named, then call session entry again.
- Timeout or no response: retry once with identical arguments, then stop and quote the error verbatim.

<!-- atom id=work.enter.keep ops=enter -->
**Keep for the whole session:** the database path, the matter-data folder (the folder holding that database; in Cowork, request access to that folder itself, never a parent or the firm root, before writing there, and use the path the session sees), the draft folder returned, the matter identity returned, the session identity token minted, the session start stamp. Carry the token verbatim to every render call, and never state it in chat. If the token is ever lost or uncertain, stop before any job write, say so, name the jobs believed to be this session's and when each was locked, and ask. Never mint a replacement. A nightly session holds one token per run (`references/nightly-launch.md`).

<!-- atom id=work.enter.responses ops=enter -->
**Response handling:**

| Response condition | Action |
|---|---|
| Page paths returned (`job_board_path`, `job_board_paths`, `matter_board_path`) | Present the page at `job_board_path` as a file card (section 7, `shared/present-files.md`); with `job_board_path` null and `job_board_paths` empty, present no page. Keep `matter_board_path`: the Litigation Strategy page is presented only when the practitioner asks for it (section 11, View pages). Give no link. Stage a page only on a remote-device-only host. |
| View page paths returned (`view_page_paths`) | Keep them. Present none at the fast open: a view page is presented only when the practitioner asks for it (section 11, View pages). |
| Page note returned (no draft folder) | Say the note in the fast open's closing line, carry on. |
| No `job_board_paths` field at all | Installed plugin predates the fixed pages: see `references/legacy.md`. |
| Opened Writing retired (`opened.filing_retired`) | State it is retired and offer recovery (section 7, Retired Writings in `draft/references/filing-picker.md`). |
| Opening refused (`open_refused`) | Follow section 11's refusal handling for its code. The render that then succeeds supplies the board. |
| Migrated | Say in the fast open's closing line that the matter's records were updated and a backup kept, with no version number. Migration is housekeeping, never a conversation. |
| Migration refused (`migration_refused`) | The hop that drops the database's copy of counsel waits on the practitioner; the database stays at v42, listed and rendered as usual. Quote the refusal in one line, then present the drift rows and counsel offers at once (section 8). Once every row is decided, call session entry again. |
| `blocking` returned (`practice_config_unreachable`: no Writing can be saved this session) | State each member's `message` and `remedy` in the fast open's closing line. Do not enter the Opening: no intake, no Dispatch, no job assigned. Read-only work stays available (`drafting_forms__render`, `drafting_forms__board_card`, `/find-document`). Offer `/practice-data`'s settings repair in that line, the one repair path, and run it only on a yes; once it reports `case_data_root` set, call session entry again. Never create, heal or edit `probanda.json` here. |
| Matter lookup did not find the matter | Say its note in the fast open's closing line, carry on. Client identity fields render as labels only. |
| Session entry returns `server_outdated: true` | Say its `build_note` in the fast open's closing line, carry on. |
| `ingest_coverage` returned | Report it in the fast open's closing line (section 7 step 3, worded by `references/opening.md`). Never read a `/matter-data` file for it. |
| Presentation-folder concept offered with no per-document path | Installed plugin predates it: see `references/legacy.md`. |
| A legacy hosted Work Board address reported | Run the hosted-board cleanup before anything else: see `references/legacy.md`. |
| No proceeding exists | Go to setup (section 8), then render, then continue. |
| A proceeding with no Writing is listed | It has a board of its own: see section 7. |
| Timeout or no response | Retry once with the same arguments, then stop and quote verbatim. |

<!-- atom id=work.open.which-filing ops=enter -->
## 7. Open the Writing

Open the first Writing session entry lists that is not retired. When a caller has already identified the Writing, open that one instead: a live Writing opens directly, and a retired one goes straight to the recovery offer below. A caller who already knows the Writing's id passes it as `filing_id` to session entry. Session entry lists Writings in the order to present them; present that order and never ask or infer what produced it. No picker and no question about which Writing to open. A new Writing whose purpose the request does not state still takes SKILL.md's purpose rule. Open it with the fast open below. A notice, not an approval pause.

<!-- atom id=work.open.picker ops=filing_picker -->
When the practitioner asks to work on a different Writing or names one, when a retired Writing is named, when every Writing is retired, or when session entry lists a proceeding with no Writing, read `draft/references/filing-picker.md`, which holds the Writing picker, the retired-Writings group and its recovery offer, and how a proceeding with no Writing opens and renders.

<!-- atom id=work.open.fast ops=enter -->
**Fast open**, for an existing Writing or a pre-filing proceeding, straight after session entry. With a draft folder, session entry has opened the Writing (or proceeding), written the matter's pages once at their fixed paths, and returned their paths and that board as `opened`. With no draft folder session entry opens nothing, and section 11's no-draft-folder rule applies. Step 1 presents the opened Writing's or proceeding's Job Board page as a card, except on the fallback route on a remote-device-only host (`shared/present-files.md`), which stages and presents it in the round trip right after session entry returns.

<!-- atom id=work.open.step-1 ops=open -->
1. **One chat line, and nothing else:** `Opened the <matter number> matter (Job Board <id>: <Writing title>), and the session is running.` For a pre-filing proceeding, name `Proceeding <id>` in place of the Job Board. The paths are not stated and no link is given. In the same turn, present the opened Writing's or proceeding's Job Board page as a file card (`shared/present-files.md`: `mcp__cowork__present_files` when the tool list holds it, else `SendUserFile` when the list holds that), by session entry's `job_board_path` and nothing else, never staged. The Litigation Strategy page is not presented at the opening. On the `SendUserFile` route, a remote-device-only host instead stages that page in one `device_stage_files` call in the round trip right after session entry returns, which may share that round trip with the lapse-cleanup and intake writes, then presents the returned path with `SendUserFile` (`shared/html-pages.md`). That staging comes after the folder check in Enter the session (Matter folder): when the matter folder was not connected, the one folder request goes first, so the first staging succeeds. The one chat line names the Job Board, so it is also the line saying what was presented that `shared/present-files.md` asks for when the card tool does not confirm delivery.
<!-- atom id=work.open.step-2 ops=open -->
2. **Read the board.** Read `opened.board_summary` (matter, client, revision, to-do, unmet and met criteria). Then call `drafting_forms__board_card(lanes: ["live", "criteria"])` once; every later reading of the board in this turn is off that card. No render.
<!-- atom id=work.open.step-3 ops=open -->
3. **At most one more line.** When session entry's `opened.board_changed` is true (or the intake's re-render reports it, when one ran), say in one line what moved on the board, naming only the jobs in `opened.board_moves` (or that re-render's) (added when `from` is null, removed when `to` is null, otherwise moved from column `from` to column `to`), and present the page at that result's `job_board_path` again as a file card (step 1). With `board_moves` empty the line says the board changed and no job moved; with it absent (no earlier render of this board recorded) the line makes no claim about movement. Session entry's exceptional notes (blocking, migrated, matter not found, server outdated, no draft folder), the lapse cleanup and the intake (section 14) join that line, or form it when the board did not change. With `blocking` returned, the lapse cleanup and the intake do not run and no Opening follows (section 6). Session entry's `ingest_coverage` joins or forms it too, as part of that one line, except when the session was entered for a requested draft: then it is left out of this line, and the one coverage check after the draft is shown reports instead (`draft/references/letters.md`, "Ingestion check", or for a job `references/job-session.md`, "The input check"). Its wording is `references/opening.md`, "The ingest-coverage clause". With files to ingest, make the offer that clause gives for each one, `/ingest` or, for a file that may be another version of a source case data holds, `/matter-data`'s supersede of the pair, and run it only on a yes. Declining changes nothing. In an unattended run, a result other than the clean one goes into the run's report and the run continues: at session entry this is a notice, never a gate. The gate is the claim (`references/job-session.md`, "The input check"). The lapse cleanup and the intake run between step 2 and this line, and this line reads the intake's re-render. Otherwise say nothing, not even that the board is unchanged. Never a second line. The idle report (section 14) follows separately, one line per idle job.
<!-- atom id=work.open.form-currency ops=form_currency -->
**Form currency.** When session entry returns `form_currency.warning`, say it verbatim as one line after the fast open's lines. Then say in one line that whether it affects this Writing is for `/legal-research`, and that the form is updated by the repo-session checklist at `form_currency.update_doc`. No date in either line is a deadline, and no deadline skill is invoked. The mockup carries the same line at the head of the venue document, rendered for the human and withheld from the forum.

<!-- atom id=work.open.then-opening ops=open -->
Then the Opening (section 14). An empty board with no job of any status and no captured ideas goes straight to the outlining branch of that reference, after the statement of goals where one is due (section 14, "Statement of goals").

<!-- atom id=work.refs.header ops=none -->
## 15. References

| Trigger | File |
|---|---|
<!-- atom id=work.ref.job-session ops=new_work -->
| The practitioner answered the opening line with a job or new work, or the session chose a job (section 14, Dispatch) | `references/job-session.md` |
<!-- atom id=work.ref.nightly-launch ops=nightly -->
| The `draft-nightly` scheduled task fires | `references/nightly-launch.md` |
<!-- atom id=work.ref.legacy ops=legacy -->
| Session entry reported a hosted board or a plugin-predates condition (it opened a board but `opened` has no `board_summary`, or it returns no `job_board_paths` field at all), or a re-entered Writing shows loose-thread markers (the 🧵 marker on the mockup, not the Job Board's Loose Threads list) | `references/legacy.md` |
<!-- atom id=work.ref.opening-routes ops=route_reply -->
| The practitioner typed an instruction with the invocation or replies after the opening (section 14, Opening) | `references/opening-routes.md` |
<!-- atom id=work.ref.opening ops=proposals -->
| An attended Opening runs the lapse cleanup or the intake, a session reads a job's `keys:` line or the Proposed and Shelved lanes, or the fast open's closing line reports `ingest_coverage` (sections 7 and 14) | `references/opening.md` |
<!-- atom id=work.ref.loose-thread-triage ops=triage -->
| Dispatch found no job and the Loose Threads count is 20 or more, or the practitioner asks to rank or triage the loose threads (section 14, Dispatch) | `references/loose-thread-triage.md` |
<!-- atom id=work.ref.loose-threads-work ops=route_reply,execute -->
| The practitioner says to work on the loose threads, or the held job's intent is to work them ("Working the threads without a pick") | `references/loose-thread-triage.md` |
<!-- atom id=work.ref.suggestion-box ops=triage -->
| Loose-thread triage reaches the open `tooling` threads (section 14, Dispatch) | `references/suggestion-box.md` |
