Read when: never whole. `skill_rules__applicable` serves this file one operation at a time (SKILL.md, "Rules for each step").
Assumes SKILL.md is loaded. These are SKILL.md's sections 4 to 13 and 15, moved verbatim under their numbers. Sections 6 and 7 and most of section 14 are `/work`'s.

<!-- atom id=draft.venue-rules ops=venue_lookup,setup -->
Venue- and kind-specific rules are in each kind's type file under `references/<Country>/<Jurisdiction>/<Venue>/Documents/`, found by the lookup in section 8.

<!-- atom id=draft.s4 ops=authorities -->
## 4. Authorities, reserve, rejection

This section's rules are in `references/authorities.md`, "Doctrine". Read it when a job touches an authority, reserved material or a rejected item.

Procedures: `references/authorities.md`.

<!-- atom id=draft.s5 ops=hand_off -->
## 5. Skills invoked

Before handing work to another skill other than `/drafting-data`, read `references/skills-invoked.md`, which lists each skill this one hands to and the condition for each.


<!-- atom id=draft.open.refresh ops=render -->
Off a remote-device-only host no page is ever staged: the card is the page's own file, presented again to refresh it.
<!-- atom id=draft.open.refresh-remote ops=render when=host:remote_device -->
On the fallback route, on a remote-device-only host, the card is a copy frozen at staging, so restaging is the refresh. When the intake's re-render, or any later render or `drafting_data__complete_job` result, reports `board_changed` true, that host stages and presents the page at that result's `milestone_path` again, alone (`shared/html-pages.md`).

<!-- atom id=draft.job-only ops=route_reply,new_work -->
Sections 4, 9, 10, 12, 13 and 8's `/publish` hand-off run inside an assigned job's approved plan for a structured filing. For a Writing drafted under `references/letters.md` or `references/unstructured.md` they run with no job, and a job handed over by `/work` is still worked as a job; section 8 also runs when the practitioner asks to start a proceeding or Writing, or asks for a new Work Board for work that is not a Writing (a Work Board with no Writing); retirement and recovery follow `references/retire-filing.md`. A quick edit is not job-only: a rewording, or the move, recast, remove, restore or kill of a paragraph, stated and approved in one exchange through `drafting_forms__preview_edit` and `drafting_forms__apply_edit`, and a reorder of material to be relied on (`references/revise-on-the-fly.md`). Neither is the practitioner's override (section 13, `references/assemble-then-gate.md`).

<!-- atom id=draft.s8.setup ops=setup -->
## 8. New matter setup

The proceeding, the forum, the document type, the venue and kind lookup, the recovery check and the response seam (items 1 and 2, which "Save first" below refers to) and the exit are in `references/new-matter-setup.md`. Read it when no proceeding exists or the practitioner starts a proceeding or Writing, or asks for a new Work Board for work that is not a Writing (a Work Board with no Writing).

<!-- atom id=draft.s8.counsel ops=counsel_of_record,setup -->
When session entry returns `parties_drift` rows, `counsel_offers` or `migration_refused`, or setup is about to ask for a party's counsel or address for service, read `references/counsel-of-record.md`, which holds why counsel of record and addresses for service are read live from case data and never elicited, how each drift row is confirmed, and the three answers to a counsel offer (apply, discard, hold). Present the rows after the fast open and before the Opening.

<!-- atom id=draft.s8.save-first ops=setup,letter -->
**Save first** (ADR 0023 D3). Write the proceeding, and the Writing once its document type is known, as soon as the practitioner confirms them, before any other work, a legal question the practitioner asks included. With the type not yet known, write the proceeding alone, with no recovery check: a pre-filing proceeding, with its own Work Board page. The recovery check runs when its Writing is created. With the type known, create the Writing after the recovery check (item 1 below) and before item 2, through `/drafting-data`'s creation write, never an ordinary write: it takes the tree key (the venue, or `_NoVenue` with the recipient) and the resolved kind, and stores the type's layout. The Writing's title names the Writing only ("Notice of Application", "Letter to opposing counsel re document production") and never holds the style of proceeding or the parties' names: the Work Board prints the style of proceeding from the proceeding's own record, and the creation write refuses a title ending in ` - <style of proceeding>` (`title_holds_style`). A letter's or an internal memo's save writes its stock job `Deliver` alone, by `/drafting-data`'s letter save idiom, and so does a save under the `Availability letter` job. Whatever surfaces afterwards is captured as an idea or outlined as a job on that board, never made a to-do. "It isn't a filing, so it needs no record" is never a reason to skip this save: a letter or email to the forum or to another party is a Writing and is saved as one first, like any filing. The one exception to "first" is an email request: its `.eml` is written and shown before the save, and the save follows in the same turn (SKILL.md, "An email request writes the `.eml` first"). Only a reply on the reply route (`references/reply.md`; ADR 0040) is not a Writing. It is still saved onto one Work Board at its first save, attached by `/drafting-data`'s attach write as a pointer to the reply's file (ADR 0042). Asked to show the Work Board with nothing saved: if the session already has the confirmed proceeding and Writing kind, save them and render the board, with no offer and no question. If a fact is missing, say in one line that there is no board because nothing is saved yet, and ask only for that fact.

<!-- atom id=draft.s9 ops=substance -->
## 9. Substance: where content comes from

This section's rules are in `references/substance-and-revise.md`. Read it when an assigned job writes substance.

<!-- atom id=draft.s10 ops=substance -->
## 10. Deployment

This section's rules are in `references/substance-and-revise.md`. Read it when an item is elicited on a kind whose type file has a Deployment section.

<!-- atom id=draft.render ops=render -->
## 11. Render and present

**1. Identity.** Client name, client number, matter number from session entry only. Never look them up again. If the matter was not found, render label fields only.

**2. Render.** Call `drafting_forms__render` with the database path, the Writing, the three identity values, the session identity token as `session_token` (echoed back unchanged, used for nothing else), and session entry's draft folder as `draft_dir`. The server finds the Writing's own folder (below), writes every mockup there host-side and returns each document's path and character length, not its text.

- To read work markers, name exactly one document in the call's document list. That one alone returns its text; every mockup still refreshes. Names: each `document_type` a render with no list returns. Never send a bad name to list them. The mockup's closing Legend explains each symbol on it, and the response's `symbol_notes` carries the notes written for the model.
- If the returned length exceeds roughly fifty thousand characters, read that document's mockup in pages, but only after confirming its revision line equals the revision the response reported. On mismatch, apply the sandbox mount-staleness workaround (`/environment-gauge`, a rename round trip) and read again.
- Name the Work Board by its document type, `Work_board` (its page is `Work Board.html` in the Writing's folder, but the tool refuses that name). Naming it returns `board_summary`, never the page (`shared/html-pages.md`); a render that does not name it returns no summary. The opening reads the board from session entry's `opened`. A render names `Work_board` only to open a different Writing; a re-check of the board is `board_card(lanes: ["live"])`, never a render. A board-only render with no `draft_dir` writes no page and returns `pages_written: false`: it does not rewrite the Work Board, so it never licenses presenting or staging that page.
- A Work Board with no Writing renders by its own id in the Writing's place, with `draft_dir` only: the result's document list holds the `Work_board` entry alone, with `milestone_only: true`, so there is no mockup to read or present, and the tool refuses a filed render or `presentation_dir` for it.
- **No appeal deadline.** Never pass `appeal_deadline`. A drafting session never looks up a date, so the board never claims an appeal period expired.
- **Refusals:** retired Writing (board only, offer recovery, never retry); empty document list (installed bundle behind the database, surface and stop); refused Writing folder (`draft_dir_missing`, `presentation_dir_ambiguous`, or a `presentation_dir` refused for a reason other than its name: say why and stop); a page path held by a file the server did not write (`shared/html-pages.md`); filed-face citation gate failure; `prose_format_gate_failed`, a general Writing's prose line flagged `🧩 <!-- format: ... -->` that is not printed wording (rewrite it, a blank as `________`); a refusal the kind's type file names. Each is surfaced and stopped on, never retried to force a result. Naming a document the Writing does not have fails loudly, read the failure, do not guess another name.

**3. Mockups.** Nothing to write. The server already wrote each mockup host-side. Never write, edit, or re-create one.

<!-- atom id=draft.render.present ops=render,present_file -->
**4. Present.** Before presenting any file as a card other than the pages (a mockup, an enclosure, a report, a drafted email), read `references/present-files.md`, Present, which holds the one-call rule, enclosure reading, remote-device staging, refresh, the skip rule and the failure line. A letter, email or memo mockup is presented only as SKILL.md ban 20 allows. At the opening no mockup is presented (section 7); a mockup is first presented by a later render that writes it. The pages are never staged or presented by this step: section 7 presents them, and when a `render` or `drafting_data__complete_job` result reports `pages_written` true and `board_changed` true the page at that result's `milestone_path` is presented again as a card (section 7).

<!-- atom id=draft.render.layout ops=present_file -->
**5. Layout confirmation.** When a presented mockup carries an `[unverified: …]` or `[source changed: …]` tag, or the practitioner accepts or asks to re-snapshot a layout item, read `references/present-files.md`, Layout confirmation.

<!-- atom id=draft.render.view-pages ops=view_page -->
**View pages.** When the practitioner asks to see a view page by its name, present the `view_page_paths` entry with that `name` for the Writing they name, else the open Writing, from the latest session entry or render that returned `view_page_paths`. Present it as a file card by its `path` alone, with no render, with the card tool `shared/present-files.md` chooses, and only on its `SendUserFile` route, on a remote-device-only host, one `device_stage_files` call for that page alone, then `SendUserFile` on the returned path. Only when no entry matches, render that Writing with `draft_dir` (item 2) and present the page from that render's `view_page_paths`. If it still has none, say so in one line. Right after presenting a view page, call `drafting_data__record_viewed` with `db_path` and `paths` the one `view_page_paths` path presented (never a staged path), so the Work Board puts its tile first and stops dashing it. The call may share its round trip with any call that does not depend on it, and a refusal is quoted in one line. The page is never read, grepped or parsed, and the reply says nothing about what it shows: its data is `/drafting-data`'s and the mockups' (`shared/html-pages.md`). Asking for a view page takes no job and writes nothing but that record. When the practitioner has the Arguments page open and the discussion turns to one submission, counter-argument, rebuttal or killed submission, call `drafting_forms__focus_view_page` with `db_path`, that `view_page_paths` entry's `filing_id`, `page: "Arguments"`, the section, and `item`, the card's record (a submission's id, or `raised:<id>` or `anticipated:<id>`), or `number` when the practitioner names the card by its tag, so the page moves to it. Never read the page to check, and quote a refusal in one line. When the practitioner asks for the Litigation Strategy page, present it the same way, by session entry's `matter_board_path`, staged alone first on a remote-device-only host, with no `drafting_data__record_viewed` call: that page, like a Work Board page, is no thumbnail. After a ranking of the loose threads, the session presents the Loose Threads page the same way, from the re-render's `loose_threads_path`, unasked, with no `drafting_data__record_viewed` call: the request to rank is the request for the page (`work/references/loose-thread-triage.md`).

<!-- atom id=draft.render.folder ops=render -->
**The Writing's folder.** Each Writing has one folder directly under the draft folder, named after the document: its title, with or without a leading `YYYY-MM-DD `. The server finds it, keeps it on a retitle, and writes the mockups, their archive and the Work Board page there. Never list the draft folder to find it. Its name never carries a type's code, a stock type's name or an id. **The safeguard leads: never rename, overwrite or delete anything in it yourself.**

<!-- atom id=draft.render.folder-cases ops=presentation_folder -->
When session entry reported no draft folder, when a render refuses with `draft_dir_missing` or `presentation_dir_ambiguous`, when a render returns `writing_folder_rename`, or after this session retitles a Writing, read `references/presentation-folder.md`, which holds each case and when to pass `presentation_dir` instead of `draft_dir`.

<!-- atom id=draft.render.projection ops=render -->
**The mockup is a projection of the database.** The database is the single source of truth, and the mockup in the Writing's folder its only copy. Every render overwrites it, archiving the previous copy when the revision moved. Never read it back except the oversized-read case above, never edit it, never treat it as current, re-render instead. It never goes to court or into a filed-face package. This is the one documented exception to the draft folder's never-overwrite rule.

**Render freely, never ask first.** Rendering is deterministic, cheap and read-only. A fresh render always beats a confirmation prompt.

<!-- atom id=draft.render.note-up ops=render when=unattended:false -->
**The note-up job.** When a render's result carries `note_up_due`, write those Proposals into the Writing's `Note up all cited authorities` job in the same turn, by `drafting-data/references/jobs-create.md` §3k, which writes the job, adds them to it, or leaves them waiting while it is in progress or shelved. Ask nothing first: the job's text is fixed and comes from the record. Say in one line what was written, and nothing when nothing was. A single authority's `Note up: <item>` job is written only when the practitioner picks that one Proposal (`drafting-data/references/jobs-create.md` §3, the fast path).

<!-- atom id=draft.s12 ops=substance,revise_on_the_fly -->
## 12. Revise

This section's rules are in `references/substance-and-revise.md`. Read it when the practitioner asks for a change. A request to reword one reviewed paragraph, to move, recast, remove, restore or kill a paragraph on a Writing, or to swap or move its material to be relied on, is a quick edit and follows `references/revise-on-the-fly.md`.

<!-- atom id=draft.s13 ops=assemble -->
## 13. Assemble, then gate

This section's rules are in `references/assemble-then-gate.md`. Read it when the drafting conditions hold, the Writing is declared ready, or the practitioner asks for a court-ready Word document or PDF while a drafting criterion is unmet (the practitioner's override: publish at once, asking nothing first, with the unmet criteria on the document's NOT FINAL cover page).

<!-- atom id=draft.refs.header ops=none -->
## 15. References

| Trigger | File |
|---|---|
<!-- atom id=draft.ref.take-over ops=take_over -->
| The practitioner names a job in progress in another session, or a taken-over, restored or released job is read back | `references/take-over.md` |
<!-- atom id=draft.ref.authorities ops=authorities -->
| A plan step touches an authority, a statement of law, or a research marker, or a job touches reserved material or a rejected item (section 4) | `references/authorities.md` |
<!-- atom id=draft.ref.evidence ops=evidence -->
| A plan step touches evidence, a witness statement, or an admission | `references/evidence.md` |
<!-- atom id=draft.ref.posture-check ops=pre_claim,plan_readback,substance,revise_on_the_fly -->
| A job will write or revise a passage that rests on a procedural step (a deadline, a direction, a waiver, an order's effect, the stage the proceeding is at), or such a passage comes up while writing substance (sections 9 and 12) | `references/posture-check.md` |
<!-- atom id=draft.ref.overstatement ops=overstatement -->
| The pre-review passes run, or a revision adds or changes an assertion after the overstatement review has run | `references/overstatement.md` |
<!-- atom id=draft.ref.letters ops=letter -->
| The Writing is a letter or email, a job calls for one, or the words of any letter, email or covering note are to be drafted or revised, whose words the scrivener writes | `references/letters.md` |
<!-- atom id=draft.ref.delivery-check ops=open,letter -->
| A letter's `Deliver` job is open at the opening, the Sent write refuses with `sent_copy_mismatch`, or whether a letter went out or arrived is in question | `references/delivery-check.md` |
<!-- atom id=draft.ref.reply ops=reply_route -->
| The practitioner asks to reply to a message from the tribunal, a registry or another party's counsel, and not for a letter (section 1) | `references/reply.md` |
<!-- atom id=draft.ref.source-trace ops=letter,reply_route,present_file -->
| A letter, email or memo mockup is about to be presented, or any email is about to be written, after the scrivener has returned its text (SKILL.md ban 20) | `references/source-trace.md` |
<!-- atom id=draft.ref.reliance-check ops=letter,reply_route -->
| The scrivener's `sources` hold an entry with a `fact_id`, or the practitioner asks to verify the facts a draft or paragraph relies on | `references/reliance-check.md` |
<!-- atom id=draft.ref.unstructured ops=unstructured -->
| The Writing's kind is `unstructured` or `unstructured-<recipient>`, the venue and kind lookup creates an Unstructured Writing (section 1), the Sent write succeeds on one, or the assigned job is `Keep the layout of <title> for next time` (a job written before 2026-10-22 has the old title `Make <title> a Structured Writing`) | `references/unstructured.md` |
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
<!-- atom id=draft.ref.retire-filing ops=retire -->
| Retirement chosen, the Writing is said to be finished, or a retired Writing is offered for recovery, or the practitioner asks to close or reopen a Work Board with no Writing | `references/retire-filing.md` |
<!-- atom id=draft.ref.venue-and-kind-lookup ops=venue_lookup -->
| A venue or document type is chosen, or a drafting step needs what the venue requires (section 8, "Venue and kind lookup") | `references/venue-and-kind-lookup.md` |
<!-- atom id=draft.ref.unattended-run ops=unattended_run -->
| An unattended run starts: `/draft unattended <Writing title>` or the nightly launch (section 14) | `references/unattended-run.md` |
<!-- atom id=draft.ref.new-matter-setup ops=setup -->
| Session entry reports no proceeding, or the practitioner asks to start a proceeding or Writing, or names a document type or an incoming document to answer, or asks for a new Work Board for work that is not a Writing (section 8) | `references/new-matter-setup.md` |
<!-- atom id=draft.ref.substance-and-revise ops=substance -->
| An assigned job writes substance or sends a research question (section 9), an item is elicited on a kind whose type file has a Deployment section (section 10), or the practitioner asks for a change (section 12) | `references/substance-and-revise.md` |
<!-- atom id=draft.ref.assemble-then-gate ops=assemble -->
| The drafting conditions hold, the Writing is declared ready, an Opening announcement names section 13 (section 14), or the practitioner asks for a court-ready Word document or PDF while a drafting criterion is unmet | `references/assemble-then-gate.md` |
<!-- atom id=draft.ref.skills-invoked ops=hand_off -->
| Before handing work to another skill other than `/drafting-data` (section 5) | `references/skills-invoked.md` |
<!-- atom id=draft.ref.present-files ops=present_file -->
| A render or a job presents a file card other than the Litigation Strategy page and a Work Board page, a presented mockup carries an `[unverified: …]` or `[source changed: …]` tag, or the practitioner accepts or asks to re-snapshot a layout item (section 11, items 4 and 5) | `references/present-files.md` |
<!-- atom id=draft.ref.tools-not-found ops=tools_not_found -->
| The opening ToolSearch and its retry did not return `drafting_forms__open_session` (section 6) | `references/tools-not-found.md` |
<!-- atom id=draft.ref.filing-picker ops=filing_picker -->
| The practitioner asks for a different Writing or names a retired one, every Writing is retired, or session entry lists a proceeding with no Writing (section 7) | `references/filing-picker.md` |
<!-- atom id=draft.ref.counsel-of-record ops=counsel_of_record -->
| Session entry returns `parties_drift`, `counsel_offers` or `migration_refused`, or setup would ask for a party's counsel or address for service (section 8) | `references/counsel-of-record.md` |
<!-- atom id=draft.ref.presentation-folder ops=presentation_folder -->
| Session entry reported no draft folder, a render refuses with `draft_dir_missing` or `presentation_dir_ambiguous` or returns `writing_folder_rename`, or this session retitled a Writing (section 11) | `references/presentation-folder.md` |
<!-- atom id=draft.ref.opening-announcements ops=announce -->
| The card's completion criteria show every criterion above `counsel-review` met, or every gate step closed (section 14) | `references/opening-announcements.md` |
<!-- atom id=draft.ref.tangents ops=tangent -->
| The practitioner starts a read-only turn outside scope (section 14) | `references/tangents.md` |
<!-- atom id=draft.ref.revise-on-the-fly ops=revise_on_the_fly -->
| The practitioner asks to reword one reviewed paragraph, to move, recast, remove, restore or kill a paragraph on a Writing, or to swap or move its material to be relied on (section 12) | `references/revise-on-the-fly.md` |
