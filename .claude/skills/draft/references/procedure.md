Read when: never whole. `skill_rules__applicable` serves this file one operation at a time (SKILL.md, "Rules for each step").
Assumes SKILL.md is loaded. These are SKILL.md's sections 4 to 13 and 15, moved verbatim under their numbers. Section 14 is `references/dispatch.md`.

<!-- atom id=draft.venue-rules ops=venue_lookup,setup -->
Venue- and kind-specific rules are in each kind's type file under `references/<Country>/<Jurisdiction>/<Venue>/Documents/`, found by the lookup in section 8.

<!-- atom id=draft.s4 ops=authorities -->
## 4. Authorities, reserve, rejection

This section's rules are in `references/authorities.md`, "Doctrine". Read it when a job touches an authority, reserved material or a rejected item.

Procedures: `references/authorities.md`.

<!-- atom id=draft.s5 ops=hand_off -->
## 5. Skills invoked

Before handing work to another skill other than `/drafting-data`, read `references/skills-invoked.md`, which lists each skill this one hands to and the condition for each.


<!-- atom id=draft.enter.tools ops=enter -->
## 6. Enter the session

Every tool the opening needs was loaded in the one ToolSearch that SKILL.md, "Rules for each step", lists, which is the only list of them. `knowledge__list`, `knowledge__read` and `sources__check` serve the venue and kind lookup and the per-file source check. Staging is for mockup copies, and for a Job Board page or a requested Litigation Strategy page only on a remote-device-only host. Everywhere else the card tool presents the pages by their fixed paths (`shared/html-pages.md`). On such a host every tool name, the three knowledge-tree tools included, carries the host's prefix (e.g. `mcp__remote-devices__plugin_legal_data__drafting_forms__open_session`, `mcp__remote-devices__plugin_legal_data__knowledge__list`), so call those names.

<!-- atom id=draft.enter.tools-not-found ops=enter,tools_not_found -->
**Tools not found.** If that search does not return `drafting_forms__open_session`, run one more ToolSearch for both full names together: `mcp__plugin_legal_data__drafting_forms__open_session` and `mcp__remote-devices__plugin_legal_data__drafting_forms__open_session`. If neither is found, stop. Never work around it, and never reach the matter's data another way. Then tell the practitioner which of two cases applies, by `references/tools-not-found.md`, which holds the two cases (a Chat conversation, a Cowork task), how to tell them apart, and what to say in each.

<!-- atom id=draft.enter.matter-folder ops=enter -->
**Matter folder.** The matter folder's path comes from one of two places: a folder this session already has connected, or a path the practitioner gave in the request or in a file the request points to. Never search for it. Do not call `device_list_dir`, list a directory, look in the knowledge tree or project memory for a matter root, or guess a path. On a remote-device host, call `get_device_info` once in every case, so the session knows whether the matter folder is connected. If more than one connected folder could be the matter, ask which one and never pick. On any host with no connected folder and no given path, ask for the matter folder's path in one line and stop. When the practitioner gave the path, go to session entry below. On a remote-device host where `connectedFolders` is empty, make the folder request in the round trip right after session entry returns, before staging: call `device_request_folder_access` once for `matter_root`, with a one-line reason (the session shows the matter's pages and writes its drafts there). If the tool refuses the request on its own because of the path (its error names the path, for example that it cannot be displayed faithfully), make no request for any other folder. Never request a parent or the firm root. Say in one line that the remote grant refused the matter folder's path, and that the practitioner can connect the matter folder itself with "Add folder" in the Claude desktop app, after which the session will use it. Then carry on as on a decline. If the practitioner declines, never request again this session: say in one line what the folder holds and that the practitioner can ask to connect it when ready, say the pages cannot be shown as cards until then, and carry on, since session entry and every database write run on the PC through the plugin's own tools and need no grant. Staging and the cards happen in the same turn as the grant.

<!-- atom id=draft.enter.call ops=enter -->
Then one call, `drafting_forms__open_session`, with the matter folder's absolute host path plus client name, client number and matter number when already known. This is the **only** entry, never a raw query, never a separate lookup, never a separate migrate first. An unattended run (section 14) also passes `unattended: true`, so the session token is minted in the unattended class the Job Board recognises. Keep the `matter_root` it returns and pass it on every `knowledge__list` and `knowledge__read` call.

<!-- atom id=draft.enter.refusals ops=enter -->
**Refusals:**
- Unusable pointer or invalid matter root: quote the refusal in one line, point the practitioner at `/case-data` to initialize or repair the pointer, and stop. Never heal or rewrite the pointer.
- More than one draft folder: quote the refusal in one line, ask the practitioner to keep one `0. DRAFT` folder, and stop. Never pick one.
- No database at the derived path: run `drafting_data__migrate` on the path named, then call session entry again.
- Timeout or no response: retry once with identical arguments, then stop and quote the error verbatim.

<!-- atom id=draft.enter.keep ops=enter -->
**Keep for the whole session:** the database path, the case-data folder (the folder holding that database; in Cowork, request access to that folder itself, never a parent or the firm root, before writing there, and use the path the session sees), the draft folder returned, the matter identity returned, the session identity token minted, the session start stamp. Carry the token verbatim to every render call, and never state it in chat. If the token is ever lost or uncertain, stop before any job write, say so, name the jobs believed to be this session's and when each was locked, and ask. Never mint a replacement. A nightly session holds one token per run (`references/nightly-launch.md`).

<!-- atom id=draft.enter.responses ops=enter -->
**Response handling:**

| Response condition | Action |
|---|---|
| Page paths returned (`job_board_path`, `job_board_paths`, `matter_board_path`) | Present the page at `job_board_path` as a file card (section 7, `shared/present-files.md`); with `job_board_path` null and `job_board_paths` empty, present no page. Keep `matter_board_path`: the Litigation Strategy page is presented only when the practitioner asks for it (section 11, View pages). Give no link. Stage a page only on a remote-device-only host. |
| View page paths returned (`view_page_paths`) | Keep them. Present none at the fast open: a view page is presented only when the practitioner asks for it (section 11, View pages). |
| Page note returned (no draft folder) | Say the note in the fast open's closing line, carry on. |
| No `job_board_paths` field at all | Installed plugin predates the fixed pages: see `references/legacy.md`. |
| Opened Writing retired (`opened.filing_retired`) | State it is retired and offer recovery (section 7, Retired Writings in `references/filing-picker.md`). |
| Opening refused (`open_refused`) | Follow section 11's refusal handling for its code. The render that then succeeds supplies the board. |
| Migrated | Note the version move and the backup written in the fast open's closing line. Migration is housekeeping, never a conversation. |
| Migration refused (`migration_refused`) | The hop that drops the database's copy of counsel waits on the practitioner; the database stays at v42, listed and rendered as usual. Quote the refusal in one line, then present the drift rows and counsel offers at once (section 8). Once every row is decided, call session entry again. |
| `blocking` returned (`practice_config_unreachable`: no Writing can be saved this session) | State each member's `message` and `remedy` in the fast open's closing line. Do not enter the Opening: no intake, no Dispatch, no job assigned. Read-only work stays available (`drafting_forms__render`, `drafting_forms__board_card`, `/find-document`). Offer `/practice-data`'s settings repair in that line, the one repair path, and run it only on a yes; once it reports `case_data_root` set, call session entry again. Never create, heal or edit `probanda.json` here. |
| Matter lookup did not find the matter | Say its note in the fast open's closing line, carry on. Client identity fields render as labels only. |
| Session entry returns `server_outdated: true` | Say its `build_note` in the fast open's closing line, carry on. |
| `ingest_coverage` returned | Report it in the fast open's closing line (section 7 step 3, worded by `references/opening.md`). Never read a `/case-data` file for it. |
| Presentation-folder concept offered with no per-document path | Installed plugin predates it: see `references/legacy.md`. |
| A legacy hosted Work Board address reported | Run the hosted-board cleanup before anything else: see `references/legacy.md`. |
| No proceeding exists | Go to setup (section 8), then render, then continue. |
| A proceeding with no Writing is listed | It has a board of its own: see section 7. |
| Timeout or no response | Retry once with the same arguments, then stop and quote verbatim. |

<!-- atom id=draft.open.which-filing ops=enter -->
## 7. Open the Writing

Open the first Writing session entry lists that is not retired. When a caller has already identified the Writing, open that one instead: a live Writing opens directly, and a retired one goes straight to the recovery offer below. A caller who already knows the Writing's id passes it as `filing_id` to session entry. Session entry lists Writings in the order to present them; present that order and never ask or infer what produced it. No picker and no question about which Writing to open. A new Writing whose purpose the request does not state still takes SKILL.md's purpose question. Open it with the fast open below. A notice, not an approval pause.

<!-- atom id=draft.open.picker ops=filing_picker -->
When the practitioner asks to work on a different Writing or names one, when a retired Writing is named, when every Writing is retired, or when session entry lists a proceeding with no Writing, read `references/filing-picker.md`, which holds the Writing picker, the retired-Writings group and its recovery offer, and how a proceeding with no Writing opens and renders.

<!-- atom id=draft.open.fast ops=enter -->
**Fast open**, for an existing Writing or a pre-filing proceeding, straight after session entry. With a draft folder, session entry has opened the Writing (or proceeding), written the matter's pages once at their fixed paths, and returned their paths and that board as `opened`. With no draft folder session entry opens nothing, and section 11's no-draft-folder rule applies. Step 1 presents the opened Writing's or proceeding's Job Board page as a card, except on the fallback route on a remote-device-only host (`shared/present-files.md`), which stages and presents it in the round trip right after session entry returns.

<!-- atom id=draft.open.step-1 ops=open -->
1. **One chat line, and nothing else:** `Opened the <matter number> matter (Job Board <id>: <Writing title>), and the session is running.` For a pre-filing proceeding, name `Proceeding <id>` in place of the Job Board. The paths are not stated and no link is given. In the same turn, present the opened Writing's or proceeding's Job Board page as a file card (`shared/present-files.md`: `mcp__cowork__present_files`, with `SendUserFile` only as its fallback), by session entry's `job_board_path` and nothing else, never staged. The Litigation Strategy page is not presented at the opening. On the fallback route, a remote-device-only host instead stages that page in one `device_stage_files` call in the round trip right after session entry returns, which may share that round trip with the lapse-cleanup and intake writes, then presents the returned path with `SendUserFile` (`shared/html-pages.md`).
<!-- atom id=draft.open.step-2 ops=open -->
2. **Read the board.** Read `opened.board_summary` (matter, client, revision, to-do, unmet and met criteria). Then call `drafting_forms__board_card(lanes: ["live", "criteria"])` once; every later reading of the board in this turn is off that card. No render.
<!-- atom id=draft.open.step-3 ops=open -->
3. **At most one more line.** When session entry's `opened.board_changed` is true (or the intake's re-render reports it, when one ran), say in one line what moved on the board, naming only the jobs in `opened.board_moves` (or that re-render's) (added when `from` is null, removed when `to` is null, otherwise moved from column `from` to column `to`), and present the page at that result's `job_board_path` again as a file card (step 1). With `board_moves` empty the line says the board changed and no job moved; with it absent (no earlier render of this board recorded) the line makes no claim about movement. Session entry's exceptional notes (blocking, migrated, matter not found, server outdated, no draft folder), the lapse cleanup and the intake (section 14) join that line, or form it when the board did not change. With `blocking` returned, the lapse cleanup and the intake do not run and no Opening follows (section 6). Session entry's `ingest_coverage` joins or forms it too, as part of that one line. Its wording is `references/opening.md`, "The ingest-coverage clause". With files to ingest, make the offer that clause gives for each one, `/ingest` or, for a file that may be another version of a source case data holds, `/case-data`'s supersede of the pair, and run it only on a yes. Declining changes nothing. In an unattended run, a result other than the clean one goes into the run's report and the run continues: at session entry this is a notice, never a gate. The gate is the claim (`references/job-session.md`, "The input check"). The lapse cleanup and the intake run between step 2 and this line, and this line reads the intake's re-render. Otherwise say nothing, not even that the board is unchanged. Never a second line. The idle report (section 14) follows separately, one line per idle job.
<!-- atom id=draft.open.refresh ops=render -->
Off a remote-device-only host no page is ever staged: the card is the page's own file, presented again to refresh it.
<!-- atom id=draft.open.refresh-remote ops=render when=host:remote_device -->
On the fallback route, on a remote-device-only host, the card is a copy frozen at staging, so restaging is the refresh. When the intake's re-render, or any later render or `drafting_data__complete_job` result, reports `board_changed` true, that host stages and presents the page at that result's `job_board_path` again, alone (`shared/html-pages.md`).

<!-- atom id=draft.open.form-currency ops=form_currency -->
**Form currency.** When session entry returns `form_currency.warning`, say it verbatim as one line after the fast open's lines. Then say in one line that whether it affects this Writing is for `/legal-research`, and that the form is updated by the repo-session checklist at `form_currency.update_doc`. No date in either line is a deadline, and no deadline skill is invoked. The mockup carries the same line at the head of the venue document, rendered for the human and withheld from the forum.

<!-- atom id=draft.open.then-opening ops=open -->
Then the Opening (section 14). An empty board with no job of any status and no captured ideas goes straight to the outlining branch of that reference, after the statement of goals where one is due (section 14, "Statement of goals").
<!-- atom id=draft.job-only ops=route_reply,new_work -->
Sections 4, 9, 10, 12, 13 and 8's `/publish` hand-off run only inside an assigned job's approved plan; section 8 also runs when the practitioner asks to start a proceeding or Writing, or asks for a new Job Board for work that is not a Writing (a Job Board with no Writing); retirement and recovery follow `references/retire-filing.md`. An on-the-fly revision or reorder is not job-only (`references/revise-on-the-fly.md`), and neither is the practitioner's override (section 13, `references/assemble-then-gate.md`).

<!-- atom id=draft.s8.setup ops=setup -->
## 8. New matter setup

The proceeding, the forum, the document type, the venue and kind lookup, the recovery check and the response seam (items 1 and 2, which "Save first" below refers to) and the exit are in `references/new-matter-setup.md`. Read it when no proceeding exists or the practitioner starts a proceeding or Writing, or asks for a new Job Board for work that is not a Writing (a Job Board with no Writing).

<!-- atom id=draft.s8.counsel ops=counsel_of_record,setup -->
When session entry returns `parties_drift` rows, `counsel_offers` or `migration_refused`, or setup is about to ask for a party's counsel or address for service, read `references/counsel-of-record.md`, which holds why counsel of record and addresses for service are read live from case data and never elicited, how each drift row is confirmed, and the three answers to a counsel offer (apply, discard, hold). Present the rows after the fast open and before the Opening.

<!-- atom id=draft.s8.save-first ops=setup,letter -->
**Save first** (ADR 0023 D3). Write the proceeding, and the Writing once its document type is known, as soon as the practitioner confirms them, before any other work, a legal question the practitioner asks included. With the type not yet known, write the proceeding alone, with no recovery check: a pre-filing proceeding, with its own Job Board page. The recovery check runs when its Writing is created. With the type known, create the Writing after the recovery check (item 1 below) and before item 2, through `/drafting-data`'s creation write, never an ordinary write: it takes the tree key (the venue, or `_NoVenue` with the recipient) and the resolved kind, and stores the type's layout. The Writing's title names the Writing only ("Notice of Application", "Letter to opposing counsel re document production") and never holds the style of proceeding or the parties' names: the Job Board prints the style of proceeding from the proceeding's own record, and the creation write refuses a title ending in ` - <style of proceeding>` (`title_holds_style`). A letter's or an internal memo's save writes its two stock jobs too, `Draft the letter` and `Deliver`, by `/drafting-data`'s letter save idiom. A save under the `Availability letter` job writes `Deliver` alone. Whatever surfaces afterwards is captured as an idea or outlined as a job on that board, never made a to-do. "It isn't a filing, so it needs no record" is never a reason to skip this save: a letter or email to the forum or to another party is a Writing and is saved as one first, like any filing. Only a client letter (section 8, item 1; ADR 0004) and a reply on the reply route (`references/reply.md`; ADR 0040) are not Writings. Each is still saved onto one Job Board at its first save, attached by `/drafting-data`'s attach write as a pointer to the client letter's folder or the reply's file, never a Writing (ADR 0042; `references/letters.md` section 10). Asked to show the Job Board with nothing saved: if the session already has the confirmed proceeding and Writing kind, save them and render the board, with no offer and no question. If a fact is missing, say in one line that there is no board because nothing is saved yet, and ask only for that fact.

<!-- atom id=draft.s9 ops=substance -->
## 9. Substance: where content comes from

This section's rules are in `references/substance-and-revise.md`. Read it when an assigned job writes substance.

<!-- atom id=draft.s10 ops=substance -->
## 10. Deployment

This section's rules are in `references/substance-and-revise.md`. Read it when an item is elicited on a kind whose type file has a Deployment section.

<!-- atom id=draft.render ops=render -->
## 11. Render and present

**1. Identity.** Client name, client number, matter number from session entry only. Never look them up again. If the matter was not found, render label fields only.

**2. Render.** Call `drafting_forms__render` with the database path, the Writing, the three identity values, the session identity token as `session_token` (echoed back unchanged, used for nothing else), and session entry's draft folder as `draft_dir`. The server finds the presentation folder (below), writes every copy host-side and returns each document's presentation path and character length, not its text.

- To read work markers, name exactly one document in the call's document list. That one alone returns its text; all copies still refresh. Names: each `document_type` a render with no list returns. Never send a bad name to list them. The mockup's closing Legend explains each symbol on it, and the response's `symbol_notes` carries the notes written for the model.
- If the returned length exceeds roughly fifty thousand characters, read that document's presentation copy in pages, but only after confirming its revision line equals the revision the response reported. On mismatch, apply the sandbox mount-staleness workaround (`/environment-gauge`, a rename round trip) and read again.
- Name the Job Board by its document type, `Work_board` (its page is the Writing's `Job Board <id>.html`, but the tool refuses that name). Naming it returns `board_summary`, never the page (`shared/html-pages.md`); a render that does not name it returns no summary. The opening reads the board from session entry's `opened`. A render names `Work_board` only to open a different Writing; a re-check of the board is `board_card(lanes: ["live"])`, never a render. A board-only render with no presentation folder writes no copies and returns `pages_written: false`: it does not rewrite the Job Board, so it never licenses presenting or staging that page.
- A Job Board with no Writing renders by its own id in the Writing's place, with `draft_dir` only: the result's document list holds the `Work_board` entry alone, with `job_board_only: true`, so there is no mockup to read or present, and the tool refuses a filed render or `presentation_dir` for it.
- **No appeal deadline.** Never pass `appeal_deadline`. A drafting session never looks up a date, so the board never claims an appeal period expired.
- **Refusals:** retired Writing (board only, offer recovery, never retry); empty document list (installed bundle behind the database, surface and stop); refused presentation folder for a reason other than its name (say why and stop); a page path held by a file the server did not write (`shared/html-pages.md`); filed-face citation gate failure; `prose_format_gate_failed`, a general Writing's prose line flagged `🧩 <!-- format: ... -->` that is not printed wording (rewrite it, a blank as `________`); a refusal the kind's type file names. Each is surfaced and stopped on, never retried to force a result. Naming a document the Writing does not have fails loudly, read the failure, do not guess another name.

**3. Copies.** Nothing to write. The server already wrote each copy host-side, deliberately clear of the sandbox mount-staleness bug. Never write, edit, or re-create one.

<!-- atom id=draft.render.present ops=render,present_file -->
**4. Present.** Before presenting any file as a card other than the pages (a mockup copy, an enclosure, a report, a drafted email), read `references/present-files.md`, Present, which holds the one-call rule, enclosure reading, remote-device staging, refresh, the skip rule and the failure line. At the opening no mockup copy is presented (section 7); a mockup copy is first presented by a later render that writes it. The pages are never staged or presented by this step: section 7 presents them, and when a `render` or `drafting_data__complete_job` result reports `pages_written` true and `board_changed` true the page at that result's `job_board_path` is presented again as a card (section 7).

<!-- atom id=draft.render.layout ops=present_file -->
**5. Layout confirmation.** When a presented mockup carries an `[unverified: …]` or `[source changed: …]` tag, or the practitioner accepts or asks to re-snapshot a layout item, read `references/present-files.md`, Layout confirmation.

<!-- atom id=draft.render.view-pages ops=view_page -->
**View pages.** When the practitioner asks to see a view page by its name, present the `view_page_paths` entry with that `name` for the Writing they name, else the open Writing, from the latest session entry or render that returned `view_page_paths`. Present it as a file card by its `path` alone, with no render: `mcp__cowork__present_files` (`shared/present-files.md`), and only on its fallback route, on a remote-device-only host, one `device_stage_files` call for that page alone, then `SendUserFile` on the returned path. Only when no entry matches, render that Writing with `draft_dir` (item 2) and present the page from that render's `view_page_paths`. If it still has none, say so in one line. The page is never read, grepped or parsed, and the reply says nothing about what it shows: its data is `/drafting-data`'s and the mockups' (`shared/html-pages.md`). Asking for a view page takes no job and writes nothing. When the practitioner asks for the Litigation Strategy page, present it the same way, by session entry's `matter_board_path`, staged alone first on a remote-device-only host. After a ranking of the loose threads, the session presents the Loose Threads page the same way, from the re-render's `view_page_paths`, unasked: the request to rank is the request for the page (`references/loose-thread-triage.md`).

<!-- atom id=draft.render.folder ops=render -->
**The presentation folder.** The server resolves it from `draft_dir`: `<code> <filing folder>`, with or without a leading `YYYY-MM-DD `, directly under the draft folder. Never list the draft folder to find it. **The safeguard leads: rename only a dated folder the render reports as renameable (it holds at least one file, and only files this skill's renders write, a board file an older render left included), and never rename, overwrite or delete anything else.**

<!-- atom id=draft.render.folder-cases ops=presentation_folder -->
When session entry reported no draft folder, when a render refuses with `presentation_dir_dated` or `presentation_dir_ambiguous`, or after this session retitles a Writing, read `references/presentation-folder.md`, which holds each case (no draft folder, none or one undated, one dated, two or more, rename after a retitle) and when to pass `presentation_dir` instead of `draft_dir`.

<!-- atom id=draft.render.projection ops=render -->
**The presentation copy is a disposable projection.** The canonical mockup beside the database is the single source of truth. Every render overwrites the copy. Never read it back except the oversized-read case above, never edit it, never treat it as current, re-render instead. Deletable at any time, never goes to court or into a filed-face package. This is the one documented exception to the draft folder's never-overwrite rule.

**Render freely, never ask first.** Rendering is deterministic, cheap and read-only. A fresh render always beats a confirmation prompt.

<!-- atom id=draft.render.note-up ops=render when=unattended:false -->
**The note-up job.** When a render's result carries `note_up_due`, write those Proposals into the Writing's `Note up all cited authorities` job in the same turn, by `/drafting-data` §3k, which writes the job, adds them to it, or leaves them waiting while it is in progress or shelved. Ask nothing first: the job's text is fixed and comes from the record. Say in one line what was written, and nothing when nothing was. A single authority's `Note up: <item>` job is written only when the practitioner picks that one Proposal (`/drafting-data` §3, the fast path).

<!-- atom id=draft.s12 ops=substance,revise_on_the_fly -->
## 12. Revise

This section's rules are in `references/substance-and-revise.md`. Read it when the practitioner asks for a change. A request to reword one reviewed paragraph, or swap or move facts on a Writing, follows `references/revise-on-the-fly.md`.

<!-- atom id=draft.s13 ops=assemble -->
## 13. Assemble, then gate

This section's rules are in `references/assemble-then-gate.md`. Read it when the drafting conditions hold, the Writing is declared ready, or the practitioner asks for a court-ready Word document or PDF while a drafting criterion is unmet (the practitioner's override: publish at once, asking nothing first, with the unmet criteria on the document's NOT FINAL cover page).

<!-- atom id=draft.refs.header ops=none -->
## 15. References

| Trigger | File |
|---|---|
<!-- atom id=draft.ref.job-session ops=new_work -->
| The practitioner answered the opening line with a job or new work, or the session chose a job (section 14, Dispatch) | `references/job-session.md` |
<!-- atom id=draft.ref.take-over ops=take_over -->
| The practitioner names a job in progress in another session, or a taken-over, restored or released job is read back | `references/take-over.md` |
<!-- atom id=draft.ref.authorities ops=authorities -->
| A plan step touches an authority, a statement of law, or a research marker, or a job touches reserved material or a rejected item (section 4) | `references/authorities.md` |
<!-- atom id=draft.ref.evidence ops=evidence -->
| A plan step touches evidence, a witness statement, or an admission | `references/evidence.md` |
<!-- atom id=draft.ref.overstatement ops=overstatement -->
| The pre-review passes run, or a revision adds or changes an assertion after the overstatement review has run | `references/overstatement.md` |
<!-- atom id=draft.ref.letters ops=letter -->
| The Writing is a letter, a job calls for one, or the practitioner asks for a letter to their own client | `references/letters.md` |
<!-- atom id=draft.ref.delivery-check ops=open,letter -->
| A letter's `Deliver` job is open at the opening, the Sent write refuses with `sent_copy_mismatch`, or whether a letter went out or arrived is in question | `references/delivery-check.md` |
<!-- atom id=draft.ref.reply ops=reply_route -->
| The practitioner asks to reply to a message from the tribunal, a registry or another party's counsel, and not for a letter (section 1) | `references/reply.md` |
<!-- atom id=draft.ref.unstructured ops=unstructured -->
| The Writing's kind is `unstructured` or `unstructured-<recipient>`, the venue and kind lookup creates an Unstructured Writing (section 1), the Sent write succeeds on one, or the assigned job is `Make <title> a Structured Writing` | `references/unstructured.md` |
<!-- atom id=draft.ref.court-oral ops=court_oral -->
| None: kept for in-court oral advocacy and never routed | `references/court-oral.md` |
<!-- atom id=draft.ref.counsel-review ops=counsel_review -->
| The assigned job is `Prepare the review pages` or `Counsel's review of …` | `references/counsel-review.md` |
<!-- atom id=draft.ref.failed-scrutiny ops=scrutiny_review -->
| The assigned job's title starts with `Review scrutiny finding: ` | `references/authorities.md`, Failed scrutiny |
<!-- atom id=draft.ref.court-ready-assembly ops=court_ready -->
| The drafting conditions all hold, on a kind with no stock list the practitioner declares the mockup filing-ready, or the practitioner's override applies (section 13); where the kind's emitter is called lenient, missing data never stops it, only an integrity refusal does | `references/court-ready-assembly.md` |
<!-- atom id=draft.ref.pre-filing-gate ops=pre_filing -->
| A package exists as files | `references/pre-filing-gate.md` |
<!-- atom id=draft.ref.nightly-launch ops=nightly -->
| The `draft-nightly` scheduled task fires | `references/nightly-launch.md` |
<!-- atom id=draft.ref.retire-filing ops=retire -->
| Retirement chosen, the Writing is said to be finished, or a retired Writing is offered for recovery, or the practitioner asks to close or reopen a Job Board with no Writing | `references/retire-filing.md` |
<!-- atom id=draft.ref.legacy ops=legacy -->
| Session entry reported a hosted board or a plugin-predates condition (it opened a board but `opened` has no `board_summary`, or it returns no `job_board_paths` field at all), or a re-entered Writing shows loose-thread markers (the 🧵 marker on the mockup, not the Job Board's Loose Threads list) | `references/legacy.md` |
<!-- atom id=draft.ref.venue-and-kind-lookup ops=venue_lookup -->
| A venue or document type is chosen, or a drafting step needs what the venue requires (section 8, "Venue and kind lookup") | `references/venue-and-kind-lookup.md` |
<!-- atom id=draft.ref.unattended-run ops=unattended_run -->
| An unattended run starts: `/draft unattended <Writing title>` or the nightly launch (section 14) | `references/unattended-run.md` |
<!-- atom id=draft.ref.new-matter-setup ops=setup -->
| Session entry reports no proceeding, or the practitioner asks to start a proceeding or Writing, or names a document type or an incoming document to answer, or asks for a new Job Board for work that is not a Writing (section 8) | `references/new-matter-setup.md` |
<!-- atom id=draft.ref.substance-and-revise ops=substance -->
| An assigned job writes substance or sends a research question (section 9), an item is elicited on a kind whose type file has a Deployment section (section 10), or the practitioner asks for a change (section 12) | `references/substance-and-revise.md` |
<!-- atom id=draft.ref.assemble-then-gate ops=assemble -->
| The drafting conditions hold, the Writing is declared ready, an Opening announcement names section 13 (section 14), or the practitioner asks for a court-ready Word document or PDF while a drafting criterion is unmet | `references/assemble-then-gate.md` |
<!-- atom id=draft.ref.skills-invoked ops=hand_off -->
| Before handing work to another skill other than `/drafting-data` (section 5) | `references/skills-invoked.md` |
<!-- atom id=draft.ref.present-files ops=present_file -->
| A render or a job presents a file card other than the Litigation Strategy page and a Job Board page, a presented mockup carries an `[unverified: …]` or `[source changed: …]` tag, or the practitioner accepts or asks to re-snapshot a layout item (section 11, items 4 and 5) | `references/present-files.md` |
<!-- atom id=draft.ref.tools-not-found ops=tools_not_found -->
| The opening ToolSearch and its retry did not return `drafting_forms__open_session` (section 6) | `references/tools-not-found.md` |
<!-- atom id=draft.ref.filing-picker ops=filing_picker -->
| The practitioner asks for a different Writing or names a retired one, every Writing is retired, or session entry lists a proceeding with no Writing (section 7) | `references/filing-picker.md` |
<!-- atom id=draft.ref.counsel-of-record ops=counsel_of_record -->
| Session entry returns `parties_drift`, `counsel_offers` or `migration_refused`, or setup would ask for a party's counsel or address for service (section 8) | `references/counsel-of-record.md` |
<!-- atom id=draft.ref.presentation-folder ops=presentation_folder -->
| Session entry reported no draft folder, a render refuses with `presentation_dir_dated` or `presentation_dir_ambiguous`, or this session retitled a Writing (section 11) | `references/presentation-folder.md` |
<!-- atom id=draft.ref.opening-routes ops=route_reply -->
| The practitioner typed an instruction with the invocation or replies after the opening (section 14, Opening) | `references/opening-routes.md` |
<!-- atom id=draft.ref.opening ops=proposals -->
| An attended Opening runs the lapse cleanup or the intake, a session reads a job's `keys:` line or the Proposed and Shelved lanes, or the fast open's closing line reports `ingest_coverage` (sections 7 and 14) | `references/opening.md` |
<!-- atom id=draft.ref.opening-announcements ops=announce -->
| The card's completion criteria show every criterion above `counsel-review` met, or every gate step closed (section 14) | `references/opening-announcements.md` |
<!-- atom id=draft.ref.tangents ops=tangent -->
| The practitioner starts a read-only turn outside scope (section 14) | `references/tangents.md` |
<!-- atom id=draft.ref.loose-thread-triage ops=triage -->
| Dispatch found no job and the Loose Threads count is 20 or more, or the practitioner asks to rank or triage the loose threads (section 14, Dispatch) | `references/loose-thread-triage.md` |
<!-- atom id=draft.ref.loose-threads-work ops=route_reply,execute -->
| The practitioner says to work on the loose threads, or the held job's intent is to work them ("Working the threads without a pick") | `references/loose-thread-triage.md` |
<!-- atom id=draft.ref.suggestion-box ops=triage -->
| Loose-thread triage reaches the open `tooling` threads (section 14, Dispatch) | `references/suggestion-box.md` |
<!-- atom id=draft.ref.revise-on-the-fly ops=revise_on_the_fly -->
| The practitioner asks to reword one reviewed paragraph, or swap or move facts on a Writing (section 12) | `references/revise-on-the-fly.md` |
