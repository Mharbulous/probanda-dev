# Plan: BCSC applications on amended Rule 8-1 (B.C. Reg. 105/2026)

**Status (2026-10-21).** Approved by Brahm. All four questions are answered, each with the recommended option (end of this file). Nothing is built.

## Context

From 2026-10-01 a BCSC application is served before anything is filed:

| Step | Who | Rule |
|---|---|---|
| Serve the unfiled notice and its evidence on every party of record and every person affected | Applicant | 8-1(3) |
| Serve the unfiled response and its evidence within 5 business days, or 21 days under Rule 9-7 | Respondent | 8-1(9) |
| Serve reply affidavits within 3 business days, or 5 under Rule 9-7 | Applicant | 8-1(13) |
| Set down by filing Form 33.01 (Notice of Hearing of Application) with the notice as served and the unfiled affidavit originals, once responses are in or the time has run | Applicant | 8-1(14.1), (14.4) |
| Serve the filed Form 33.01, at least 4 business days before the hearing | Applicant | 8-1(14.5) |
| File reply affidavits 2 business days before the hearing | Applicant | 8-1(14.6) |
| File its served response and affidavits after set-down and before the hearing, and bring copies | Respondent | 8-1(14.7) |
| Provide the application record (Form 30.001 cover, index), 5 to 2 business days before, with a separate copy of the notice with its orders sought marked | Applicant | 8-1(15), (15.1) |
| Serve the record index by 2 business days before the hearing | Applicant | 8-1(17) |
| Reset an application adjourned generally by filing Form 33.01 and serving it 2 business days before | Applicant | 8-1(21.1) |

A contempt application is served personally on the alleged contemnor (22-8(11)). The OIC has no transitional clause.

Probanda still runs the old order:

- The `File and serve` stock job files and then serves, and /prepare offers it to both sides.
- Nothing produces Form 33.01 or Form 30.001.
- No stock job covers set-down, reply affidavits or 14.7.
- No /assemble subskill builds a BCSC record.
- The Writing lifecycle has no "served" state.
- The gate wording says "ready to file".

Deadlines are already modelled in `.claude/skills/shared/docket-clerk/references/bcsc-rules.md` (application sections), and they stay with the docket-clerk. This plan changes no date logic.

Sources:

- `C:\Users\BrahmDorst\Git\Coclerk\Engineering\bcsc-rules-inputs\oic-264-2026.txt`: Schedule 1 ss. 1 and 5, and Form 33.01 at lines 472-528.
- `sccr-168_2009_01.txt:1919-1983`: the 8-1(15) to (17) text before amendment.
- `sccr-form-30.001.txt`: Form 30.001.

## Rules for every step

- **No schema migration.** There is no drafting-data schema migration, for two reasons:
  - Any edit to `migrations.sql` or `schema.sql` adds new problems to `check_publishable.py --new-since`: a changed file hash and new DDL lines.
  - A migration would deepen reliance on the COMMANDMENTS Exception.
- **No dates in job text.** No date, or value derived from one, goes in any stock job or in /prepare text (`prepare/SKILL.md` §7). A hearing date is content the practitioner gives. It is recorded in `hearing_details` and printed on Forms 33.01 and 30.001, never in a job.
- **Fixed titles stay.** `File and serve` and `Pre-filing consistency gate` are fixed once shipped. `File and serve` stays in every title list, so existing boards keep working.
- **Old rule or new rule is told apart by the tool, never by a date.**
  - A Notice of Application or Application Response with a `sent_copy_id` was recorded by the new `record_served`.
  - One without a `sent_copy_id` was filed the old way, by `record_filed`.
  - `record_filed` never writes `sent_copy_id` (`filed-write.ts:52-62`). `record_sent` refuses any Writing that is not general (`sent-write.ts:288`).
- **Wait for the other two sessions.** Start only after both uncommitted sessions have committed: the v77->v78 step-status work, and the v78->v79 Form 33 work. Between them they touch `render-work-board.ts`, `dispatch.ts`, `schema-gen.ts`, `query.ts`, `jobs-gate.md`, draft `dispatch.md`, `opening-routes.md`, `filing-checklists.md`, `render-application-response.ts` and `render-form33-filed-face.ts`. Re-read every cited line once they land.
- **Commit as you go.** Commit each step by pathspec, and push it when its check passes.

## Step 0. Wait for the other sessions

**Check:** `git status --short` lists none of the files named above.

## Step 1. A `served` lifecycle state. Release: lawyer

Changes in `source/lawyer/mcp/src/submission/forms/lifecycle.ts`:
- Add `SERVED_KINDS = {notice_of_application, application_response}`.
- Add the state `served` with the label "Served".
- Derive it in the `filed` slot: a served kind with `filed_on` set and `sent_copy_id` set.
- Heard, Decided, Entered and Retired still win.
- A venue's `letter` is not a served kind, so it stays "Filed".

**Check:** extend `test/lifecycle.unit.test.mjs` with four cases:
- a served Notice of Application reads `served`;
- the same Writing without `sent_copy_id` reads `filed`;
- a served Writing with a past hearing date reads `heard`;
- a letter with `sent_copy_id` reads `filed`.

## Step 2. New tool `drafting_data__record_served`. Release: lawyer

New file `source/lawyer/mcp/src/submission/forms/served-write.ts`, modelled on `filed-write.ts`.

- **Inputs:** `{db_path, filing_id, served_on, served_copy_path?}`.
- **Refusals,** each writing nothing:
  - `invalid_served_on`
  - `not_found`
  - `job_board_only`
  - `writing_retired`
  - `already_filed`
  - `not_served_kind`
  - party drift (from `partiesSnapshotStatements`)
  - `revision_moved`
- **One transaction,** in the order of `sent-write.ts:343-358`:
  1. the revision guard;
  2. the party snapshot (`guard_filings_parties_snapshot` needs it first);
  3. a `documents` row `Served copy — <title>`, with `document_date` set to the service date;
  4. `sent_copy_id` set to that row;
  5. `filed_on` set to the service date.

**Why this freezes the right thing.** Setting `filed_on` freezes the Writing at service: its exhibits, layout, clauses, recipients, party snapshot and prose (`schema.sql:695-906`). That is correct, because 14.4(b) files "the notice of application served under subrule (3)". `sent_copy_id` is a plain foreign key with no trigger on it (`schema.sql:667`).

**What it leaves out.** There is no signer snapshot, copy comparison or pre-send hold. `record_filed` has none of these either.

**Registration and related changes:**
- Register the tool in `dispatch.ts` and `schema-gen.ts`.
- `record_filed` refuses a served Writing with a new code, `served_writing`. The code points to the set-down job. Its inputs do not change.

**Check:**
- New test `test/served-write.db.test.mjs`. It covers:
  - what is written;
  - the lifecycle reading `served`;
  - exhibits frozen;
  - every refusal writing nothing.
- Add `record_served` to the call list in `job-board-only.db.test.mjs`.

## Step 3. Milestone text and stock titles. Release: lawyer

Changes in `render-work-board.ts`:
- **One constant.** Export one `STOCK_TITLES` set, built from the existing titles plus the new ones in Step 4.
- **Before-gate skip.** Extend it (today `startsWith("File and serve")`) to the two Serve titles.
- **Goal text.** It reads "Served on <date>" for a served Writing.
- **Card verb.** It becomes "send", "serve" (the two served kinds) or "file".
- **Hearing-date message.** On an unserved Notice of Application, drop the "Only the hearing date remains to be recorded" branch. Under the new rule the hearing date comes at set-down, after service.

**Check:** in `forms-render-workboard.db.test.mjs`:
- "Awaiting your approval to file." becomes "…to serve." for the Notice of Application fixture.
- Add a served case that reads "Served on".
- Add the new titles to the stock-title and before-gate tests.
- A drift test asserts that the bold titles in `jobs-stock.md` §3b equal `STOCK_TITLES`.

## Step 4. Stock jobs and drafting-data text. Release: litigator

Every new or revised stock job has `kind='work'` and `filing_id` set to the lead Writing. This text is fixed once shipped.

| Title | Offered | Intent | Steps | Scope |
|---|---|---|---|---|
| `Serve the application` | Notice of Application, after the gate | `Serve a copy of this unfiled notice of application, with the affidavits and other materials it relies on, on every party of record and every other person the orders sought may affect, and record the service.` | `Serve the unfiled notice and its affidavits and materials on each person entitled to them` · `Record the notice as served, with the copy served` · `Affidavit of service, or n/a` | `('filings', id)`, `('documents', NULL)` |
| (contempt variant, same title) | as above, for a contempt application | as above | Step 1 becomes `Serve the unfiled notice and its affidavits and materials on each person entitled to them, and on the alleged contemnor by personal service` | as above |
| `Serve the response` | Application Response, after the gate | `Serve a copy of this unfiled application response, with any affidavits and other materials not already served, on the applicant and every other party of record, and record the service.` | `Serve the unfiled response and its affidavits and materials on the applicant and each other party of record` · `Record the response as served, with the copy served` · `Affidavit of service, or n/a` | `('filings', id)`, `('documents', NULL)` |
| `Set down for hearing` | Notice of Application, when the practitioner says each response is in or its time has run | `Set this application down for hearing: file a notice of hearing of application with the served notice and the originals of its served affidavits and materials, then serve the filed notice of hearing on each application respondent.` | `Prepare the notice of hearing of application (Form 33.01)` · `File it with the served notice of application and the originals of its served affidavits and materials not yet filed` · `Record the hearing date and time it sets, and save the filed copies` · `Serve the filed notice of hearing on each application respondent` · `Affidavit of service, or n/a` | `('hearing_details', NULL)`, `('documents', NULL)` |
| `Reply affidavits` | Notice of Application, optional, with set-down | `Serve the applicant's reply affidavits on each application respondent, then file their originals before the hearing.` | `Serve the reply affidavits on each application respondent` · `File the originals of the served reply affidavits` · `Affidavit of service, or n/a` | `('documents', NULL)` |
| `File the served response` | Application Response, when the practitioner says the notice of hearing was filed or served | `File the served application response, with the originals of its served affidavits and other materials not yet filed, after the notice of hearing is filed and before the hearing, and bring copies to the hearing.` | `File the served response with the originals of its served affidavits and materials not yet filed` · `Save the filed copies` · `Bring copies of the filed materials to the hearing` | `('documents', NULL)` |
| `Application book` (title kept) | Notice of Application, after set-down | `Prepare the application record: its Form 30.001 cover and index, bound with the filed notice of application, the responses served on the applicant and the filed and served evidence relied on; serve the index; and provide the record, with a marked copy of the notice, to the registry.` | `Render the cover page (Form 30.001) and the index` · `Bind the record in the rule's order and fill in the page numbers` · `Prepare a separate copy of the filed notice with the orders sought in Part 1 marked` · `Serve the index on each application respondent` · `Provide the record and the marked copy to the registry` | none |
| `Reset for hearing` | Notice of Application adjourned generally (Question 2) | `Reset this application, adjourned generally, for hearing: file a notice of hearing of application and serve the filed copy on each application respondent.` | `Prepare the notice of hearing of application (Form 33.01)` · `File it and record the new hearing date and time` · `Serve the filed notice of hearing on each application respondent` · `Affidavit of service, or n/a` | `('hearing_details', NULL)`, `('documents', NULL)` |

The registry filing at set-down, or under 14.7, is a step in these jobs. The filed copy is saved as an unlinked `documents` row, the same pattern `File and serve` already uses for affidavits of service (`jobs-stock.md:32`). It is not a lifecycle state. See Question 1.

Text to change:

- **`jobs-stock.md`:**
  - the §3b table;
  - the prefix rule, extended to the two Serve titles;
  - the "six jobs" count;
  - the job text above.
- **`jobs-gate.md`:**
  - the SQL exclusion list: put the new titles before `'Draft the letter'`, so the substring that `test_migrate_engine.py` asserts survives;
  - the prose;
  - the intent (the title is kept), which becomes "ready to file or serve";
  - the completion line, which now also allows `record_served`.
- **`filing-checklists.md`:**
  - §11: add the Served row and the `record_served` write;
  - §11: a served Writing's `filed_on` is its service date, so a registry rejection at set-down never clears it;
  - §2: the hearing date is recorded at set-down.
- **`pre-filing-checks.md`:** "drafting → filed" becomes "drafting → served or filed".
- **drafting-data `SKILL.md`:** add a routing row for `record_served`.

**Check:**
- `python -m unittest` in `.claude/skills/drafting-data/tests` passes.
- A new test runs the jobs-gate SQL against each new title and gets no row back.

## Step 5. /prepare stages. Release: litigator

Update `.claude/skills/prepare/SKILL.md` (description, §4 and §6). Each stage is read off the board and the practitioner's own words, never off a date.

| Stage | Notice of Application | Application Response |
|---|---|---|
| 1. Opening | `Availability letter`, as now | as now |
| 2. After the gate | `Serve the application` | `Serve the response` |
| 3. Responses in, or their time has run (the practitioner's words) | `Set down for hearing`, with `Reply affidavits` optional | `File the served response`, once the practitioner says the notice of hearing was filed or served |
| 4. After set-down | `Application book` | none |
| 5. Adjourned generally | `Reset for hearing` | none |

`File and serve` is no longer offered. It stays in the title lists for boards that already hold it. Question 3 covers applications without notice and applications filed before 2026-10-01.

**Check:** a grep shows that every title `prepare/SKILL.md` names is in `jobs-stock.md` §3b, and that no stage text holds a date.

## Step 6. /draft text. Release: litigator (all seven if `shared/` changes)

- **`draft/references/dispatch.md`:** the before-gate skip also covers the two Serve titles.
- **`draft/references/pre-filing-gate.md:25-27`:** "ready to file" becomes "ready to file or serve". A Writing is never recorded as served or filed while a step is open.
- **`draft/SKILL.md`** ("after `record_filed` or `record_sent`" at :72) and **`shared/procedural-history.md:24`:** `record_served` also triggers the procedural-history entry "Served <title>".
- **`draft/references/opening-routes.md`:** a rejection at set-down never clears a served Writing's `filed_on`.
- **`draft/references/retire-filing.md`:** the adjourned-generally route (Question 2).
- **`GLOSSARY.md`:** add "ready to serve" to the avoid lists beside "ready to file".

**Check:**
- A grep for "ready to file" finds only the glossary avoid lists and text about the old rule.
- Every line naming `record_filed` as a procedural-history trigger also names `record_served`.

## Step 7. /publish: Forms 33.01 and 30.001. Release: litigator

Add `form-33.01` and `form-30.001` to `REGISTRY` in `publish-bcsc-form/scripts/harness.py`, on the generate-only `form-123` pattern. Each form needs:
- a template, built from the OIC text (lines 474-525) and `sccr-form-30.001.txt`;
- a builder in `fill_plain.py`, with caption and convert wiring;
- a style guide;
- rows in the SUBSKILL tables and `kinds.json`;
- an identity file under `publish/references/CAN/BC/BCSC/Documents/`.

Form 33.01:
- **Service dates and orders sought.** Service dates come from the served copies, and the orders sought from the Notice of Application's Part 1.
- **Hearing details.** The hearing date, time, place and estimates are the practitioner's content.
- **Reset mode.** It has a reset mode for 21.1.

Form 30.001:
- It takes the record type and the rule reference, so a petition record can use it later.

Read how `fill_plain.py` dispatches a new form before building it.

**Check:**
- New harness tests render each form from a fixture.
- `form-currency.unit.test.mjs` returns `warning: null` for both forms.

## Step 8. Verify the Form 33 conformance done by the other session

Another session is conforming Form 33 (the Application Response) to B.C. Reg. 105/2026. Its v78->v79 hop adds `hearing_details.hearing_date_position`, and it has template and emitter changes. This plan does not redo that work.

**Check, after that session lands:**
- `application-response.md` `conformed_to` lists B.C. Reg. 105/2026.
- The "dated" preamble no longer prints the notice's `filed_on` as its filing date. See `render-form33-filed-face.ts`, `fill_subs_form33.py`, `assembly-input-contract.md` and `filing-checklists.md` §5.
- Anything missing is raised with Brahm, not patched with a further migration.

## Step 9. /assemble: new `assemble-bcsc-record` subskill. Release: litigator

New folder `.claude/skills/assemble/subskills/assemble-bcsc-record/`, holding:
- `SUBSKILL.md`;
- a binding contract;
- `record_manifest.py`, which orders the contents by 8-1(15)(b) as amended, with every served response and respondent evidence under (v.1), and refuses affidavits of service and authorities under (15)(d);
- `paginate_record.py`, modelled on `assemble-bcca-book/scripts/paginate_book.py`, which builds the cover, index, tabs and page numbers;
- `mark_orders.py`, which makes the separate marked copy of the notice (15.1), by the PyMuPDF method of `show-me/scripts/highlight_pages.py`. show-me ships in lawyer, so the script is not imported across plugins.

The subskill also writes the index alone as a PDF, for service under (17). Add it to the router list in `assemble/SKILL.md`. Petition records (16-1(11)) come later, once 16-1(11) has been read.

**Check:** `tests/test_record_manifest.py` (order and refused tabs) and `tests/test_mark_orders.py` (highlight on the Part 1 paragraphs) pass.

## Step 10. Build, check, release

Run, in order:
1. `npm test` in `source/lawyer/mcp`
2. `python scripts/build_plugin.py`, then `--check`
3. `python scripts/check_plugin.py`
4. `python scripts/check_layering.py`
5. `python scripts/check_file_ops.py`
6. `python scripts/check_publishable.py --new-since origin/main`
7. `/release`, releasing lawyer and litigator together so no skill names `record_served` before the server has it

**Check:** all pass, and no new publishable problem is reported.

## Schema changes and version consequence

**No schema change.** The plan uses only existing columns:
- the served state is `filed_on` + `sent_copy_id` + a `documents` row;
- the filed copies and the hearing date use existing `documents` and `hearing_details` columns.

**Every release is a patch:**

| Plugin | Bump | Why |
|---|---|---|
| lawyer | patch | One new tool, one new refusal code and new labels. No existing tool's inputs change. An old copy shows a served notice as "Filed on <service date>" and its `record_filed` refuses it. That is a misread label, not damaged data. |
| litigator | patch | Skill text, stock jobs, new forms and a new subskill. |
| all seven | patch | Only if `shared/procedural-history.md` changes. |

## Risks

- **Moving line numbers.** Line numbers will move, because every overlapping file is being edited by another session.
- **Old data reads "Filed".** Served Writings recorded by an old copy, or through `record_filed`, read "Filed".
- **"Heard" after adjournment.** After an adjournment the lifecycle reads "Heard" until a new hearing date is recorded. This is true today too.
- **Transition undecided.** It is not settled which rule governs an application filed or served before 2026-10-01 and heard after it (`bcsc-rules.md`, "Transition, not decided here").

## Out of scope

- **bcsc-rules.md rows** for 14.7, 20 and 21.1, and the tension between 22-1(7)(b) and 21.1. This is docket-clerk work. 22-8(11) is already recorded in that file.
- **The transition question.** It is a question of law for /legal-research.
- **A stale pointer.** `form-currency.ts` points at `publish/subskills/publish-bcsc-form/references/form-update.md`. The checklist is actually at `.claude/commands/form-update.md`.

## Questions for Brahm

**Answered 2026-10-21.** Brahm chose the recommended option on all four: Served until Heard with no Filed state, keep an adjourned-generally Notice of Application live, keep `File and serve` for notices filed before 2026-10-01 and offer no service job for an application without notice, and let anyone record service.

1. **Is the registry filing of a served Writing a lifecycle state?**
   - Recommended: no. Filing is a step in the set-down or 14.7 job, with an unlinked `documents` copy, and the board reads "Served" until "Heard".
   - Alternative: the lifecycle shows "Filed". That needs a filed-copy row found by its label text, or a schema column.
2. **A Notice of Application adjourned generally.**
   - Recommended: do not retire it. `draft/SKILL.md` says "Never retire a Writing to pause it". It stays live, and /prepare offers `Reset for hearing`.
   - Alternative: retire it as now, and reverse the retirement on reset through the recovery write in `filing-checklists.md` §11.
3. **Applications without notice, and notices filed before 2026-10-01.**
   - Recommended: /prepare offers no service job for an application without notice, and keeps offering `File and serve` only where the practitioner says the notice was filed before 2026-10-01.
   - Alternative: drop `File and serve` from /prepare entirely.
4. **Who may record a Writing as served?**
   - Recommended: anyone, as with `record_filed`, because staff often serve.
   - Alternative: roster lawyers only, as `record_sent` requires.

## Verified while planning

- **Read in full:**
  - the OIC;
  - 8-1(15) to (17) before amendment;
  - Form 30.001;
  - `prepare/SKILL.md`;
  - `jobs-stock.md`;
  - `filed-write.ts` and `sent-write.ts`;
  - the `filings` table and its freeze triggers in `schema.sql`;
  - the application sections of `bcsc-rules.md`;
  - the problem matching in `check_publishable.py`;
  - the other sessions' migration hops v77->v78 and v78->v79.
- **Read by the planning agent and cited by line, not reread here:**
  - `lifecycle.ts`;
  - the `render-work-board.ts` title lists, card text and readers of `filed_on`;
  - `retire-filing.md`;
  - the harness registry.
- **Not read:**
  - `fill_plain.py`'s form dispatch;
  - `shared/deadline-isolation.md`'s service-date handoff;
  - Rule 16-1(11).
