# Audit: what each /bill-client step keeps, redoes or loses on a re-run

Findings for ticket #249, under map #246 "Resumable /bill-client". This file corrects the map's table "the state of each step today" and names where each write goes. It states no decision and recommends nothing.

Read against `main` on 2026-11-04.

**How each statement is marked**

- **[code]**: read in a script, a server source file or a test. The behaviour is enforced.
- **[skill]**: read in skill text. The model is told to do it, and nothing enforces it.
- **[state]**: checked on the maintainer's PC by a read-only query or file listing, as counts and dates only.
- **[inferred]**: reasoned from the marked sources. No run has shown it.
- **[unverified]**: needs a live run to prove.

`<work>` below means `<matter-data folder>`, as `shared/workspace-output-rule.md` resolves it.

## The corrected table

| Step | What survives today | Re-run behaviour | Where this differs from the map |
|---|---|---|---|
| 1: matter | The matter-data seed, if it had to be initialized | The profile read repeats. Initializing runs only if needed | The map calls steps 1 to 5 read-only apart from the import. This is a second write |
| 2: housekeeping | Whatever `/housekeeping` recorded, which is its own work | The hashes and the review-log lookup repeat | Not in the map. A failure stops the step, and nothing records why |
| 3-4: last invoice | Nothing of its own | The folder is listed and the PDF read again. The bill date, the last billed date and the time billed per date live only in the conversation | The map says the invoice record survives. Only the import in step 5 stores anything, and it never stores the per-date billed time |
| 5: cross-check | The invoice record, only when an import ran | Repeats safely, with one refusal: an import that moves the cutoff backward | Confirmed safe, but the import runs only when the records and the disk disagree, so a first run may store nothing |
| 6.1: `/triage-billing-dates` | One list file per calendar day, `phone-matches.json`, working files, the call archive in the timecamping DB, approved contact numbers | All of Phases 1 to 3 run again. Nothing reads the earlier list. The same day rewrites the file, and a later day writes a new one beside it | The map says a new list each time. The ticket says in place. Each is right for one case. Marking an older list superseded appears in no skill |
| 6.1: its evidence-store save | Nothing on this machine: 0 rows in the namespace | The skill gives no condition, and no gate holds a first save. The cause of the 2026-11-04 loss is not established (below) | The map says "nothing until approved". No skill or tool requires that for this save |
| 6.2: `/timecamping` | Fetched rows in `timecamping.db` and `time_pipeline.db`, proposals, determinations, TimeCamp edits, judged marks, `call_window`, `statement` and `marker` rows | A marked date is skipped whole. An unmarked date reruns Steps 0 to 7, and a re-fetch of a date asks for one pasted approval | The map names one DB. A "no" at Step 7 is stored nowhere. A new entry on a marked date is never looked at |
| 6.2: earlier proposals | 620 live committed proposals, all dated 2026-09-23 to 2026-10-09 | Their dates count as unjudged, so they are worked again | The cause is timing, not a failed write (below) |
| 6.3: uncovered time | Each block as a proposal, and a hand-entry stamp if that record ran | The block can be read back. The practitioner's choice to leave one for an estimate cannot | The map says the choices are not recorded. That is true of one of the two choices |
| 6.4: `/vet-billable-time` | `vetted.json`, the rates, the firm's clerical setting, the time entries, the two reports, `invoice_lines.json`, `line_map.json`, `time_entries.json` | Resumes at the first line `vetted.json` lacks. `tie_out.py final` rewrites its outputs. Re-running a fully vetted matter is described below | The map says "not yet checked". Answers to step 6's date questions other than an approved estimate reach the file only at step 7. `vetted.json` from an earlier bill blocks the next one |
| 7: chart | The workbook and the PNG | Refuses a taken output name, so a same-day re-run stops. A later day has a new workbook name | The map treats steps 7 to 9 as one row |
| 8: render | `invoice.json`, `disbursements.json`, each draft | `invoice.json` is rewritten. Disbursements are re-collected. Each render takes the next ` vN`. The Word or PDF answer and the tax rates shown are not kept | Confirmed, and the file holding disbursement rulings has no set path |
| 9: ready for signature | The bill number in `invoice.json`, the unmarked invoice | The "ready for signature" answer itself is not recorded, apart from the file's existence | Not in the map |
| After signature: `/issue-invoice` | The frozen copy, the invoice record and its locks | Resumes only from the same frozen copy. Any other content is refused | Not in the map, and included because it ends the bill |

## The ticket's named questions

### 1. Is the candidate list rewritten in place or written new?

Both. The name is `YYYY-MM-DD Candidate dates`, and the skill says "Rewrite the file in place on a re-run" (`.claude/skills/triage-billing-dates/SKILL.md:86`). [skill] A run on the same day rewrites. A run on a later day has a different name, so it leaves the old list and adds a new one. [inferred]

The instruction to mark an older list superseded appears in no skill: `triage-billing-dates`, `timecamping`, `vet-billable-time` and `bill-client` do not mention it. [skill] Nothing names the current list. `/vet-billable-time` takes "its candidate-dates file" from the caller (`.claude/skills/vet-billable-time/SKILL.md:19`). `tie_out.py` reads the one path it is given (`.claude/skills/vet-billable-time/scripts/tie_out.py:106`). [code]

### 2. Why was the triage evidence save lost on 2026-11-04?

**The cause is not established.** No log of that run exists on this machine, only the candidate lists it left.

Searched, with no record of the run found:

- All 197 Claude Code and Cowork session logs on the PC changed since 2026-11-03. None invokes or types `/bill-client`, `/triage-billing-dates` or `/vet-billable-time`, writes a candidate list, or writes to the `evidence` namespace. [state] A control confirmed the scan matches the form both a Skill call and a typed command take in a log.
- The map's wording. Its table text first appears in transcripts after the map was created at 2026-11-05T02:24:39Z, so the session that wrote it left no transcript here. [state]

What the stores show: [state]

- The `evidence` namespace holds **0 rows**. So no `triage`, `service_list`, `document`, `filing`, `received_mail`, `call_window`, `statement`, `marker` or `estimate` row has ever been saved or kept on this machine, not only the run's.
- `time_pipeline.db` was last modified on 2026-10-08, before the namespace existed.
- `timecamping.db` was last modified on 2026-11-03. It holds no proposal made after 2026-10-09.
- The case-data root holds no `timecamping`, `triage-billing-dates`, `vet-billable-time` or `bill-client` working folder.
- The matter files hold two candidate lists, last modified on 2026-11-03 and 2026-11-04. They hold no billable time audit, draft invoice, `vetted.json` or `judged-dates.jsonl`.

So the run reached Phase 3's first save, the list, and the list reached this machine's matter files, which sync. Its evidence rows did not reach this machine's store, and no log of the session that wrote the list is here. Whether the session ran on another machine or another route, and whether it wrote rows to a store that never reached this one, these facts do not say. [inferred] Whether the two lists say anything about the save was not read: a keyword search of them had not returned when this file landed.

Ruled out as a cause of a first save being held:

- **The skill text.** Phase 3's save carries no condition (`.claude/skills/triage-billing-dates/SKILL.md:88`). Its rule lists the save among the permitted writes, apart from the contact number, which alone needs a yes (`:14`). [skill]
- **The approval gate.** The hook's matcher covers `time_pipeline__delete`, `time_pipeline__bulk_apply` and `timecamp__update_entry`, not `set` (`source/timekeeper/plugin.json:23`). A `bulk_apply` that only adds passes (`source/timekeeper/hooks/one-way-gate.py:44`). [code]
- **A refused namespace.** The server takes any namespace string and knows no list (`source/lawyer/mcp/src/time-pipeline/backend.ts:20`, `source/lawyer/mcp/src/schema/time-pipeline.ts:29`). [code]

Still open, each a way this could have happened and none shown to be what did: [inferred]

- **A rule outside the skill.** The map's constraints say "every evidence save needs the practitioner's approval", and its table says "nothing until approved". The skills require approval only for an estimate (`.claude/skills/vet-billable-time/SKILL.md:47`) and for replacing rows through `bulk_apply`. A session holding the rule the map states would hold the save, which fits "held to the end".
- **Older installed copies.** The sentence entered the skill in `9460e388` (2026-11-03 14:19), and Timekeeper 0.4.5 is the first bump after it. On this PC at this audit, one synced folder holds 0.6.1, which has the save and the store, and another holds 0.3.11, which has neither. The Claude Code plugin cache holds 0.2.1 and 0.2.2. Their `timecamping-data` has no evidence store section, and their `time-pipeline-data` lists three namespaces and calls a fourth an anti-pattern. A session reading a new triage skill and an old gatekeeper would find no store to save to. [state for the copies]
- **Three hops with no format.** The sentence names no tool, key or row shape. It sends the reader to `/timecamping-data`, whose table names the families and which sends the reader on to `/time-pipeline-data`. [skill]
- **No detector.** Nothing notices a missed save. The last sentence of the skill returns only the list's path (`:102`). `tie_out.py` reads the list file and never the triage rows. The only reader of an `evidence:` source is `.claude/skills/practice-data/scripts/defend_line.py:47`, which reads a frozen copy. [code]

Separately, the store says "saving again changes nothing" (`.claude/skills/timecamping-data/SKILL.md:89`). `set` overwrites whatever it finds (`.claude/skills/time-pipeline-data/SKILL.md:39`). A `bulk_apply` counts a key as replaced only when its value differs (`source/lawyer/mcp/src/kv/backend.ts:159`), and a replacing call waits for a pasted approval. So a re-saved row whose value changed, such as a row holding a date's evidence, can stop for approval. [code for the counting, inferred for the row]

### 3. Why were committed proposals from earlier sessions not marked judged?

Because the marks did not exist when those proposals were made, and nothing writes one afterwards.

- `judged-dates.jsonl` first appears in `df131b34` on 2026-11-03. Every live committed proposal on this machine dates from 2026-09-23 to 2026-10-09: 593 after a ceremony and 27 silent. 431 were written back. [state]
- The only writer is the model, inside `/timecamping`'s candidate-list section, once a date's run ends (`.claude/skills/timecamping/SKILL.md:276`). A correction run for a date outside that section appends nothing. [skill]
- The key is `date` alone, with `judged_at`. It holds no proposal id, entry id, bill or person. The file is per matter, while proposals are per practitioner. [skill]
- `tie_out.py` reads only that file (`.claude/skills/vet-billable-time/scripts/tie_out.py:133`), and its check never looks at proposals (`:160`). [code]

Consequences: [inferred]

- A date whose proposals are all committed still fails `tie_out.py pull` until it is worked again.
- A mark never goes stale. A TimeCamp entry added or changed on a marked date is skipped by `/timecamping`.
- A mark for one matter means nothing to another, so a day shared by two matters is worked once for each.
- The mark's condition includes "the practitioner has answered Step 7 for each entry", and a "no" at Step 7 leaves no record (`.claude/skills/timecamping/SKILL.md:254`). After a session ends, an entry declined and an entry never asked about look the same.

The re-run rule has two versions. `/timecamping-data` says a re-run supersedes the prior proposals unless they are terminal (`.claude/skills/timecamping-data/SKILL.md:148`). `/timecamping`'s candidate-list section says to keep a live proposal with the same span and matter "whatever has been answered about it" (`.claude/skills/timecamping/SKILL.md:277`). [skill] Which one a run follows is [unverified].

### 4. Is nothing recorded at the uncovered-time stop?

Partly. `/bill-client` itself records nothing at that stop (`.claude/skills/bill-client/SKILL.md:69`). [skill]

- The block is stored, as a proposal whose rationale says `UNCOVERED — no TimeCamp entry` (`.claude/skills/timecamping/reference/inference.md:247`), and the uncovered read returns it (`.claude/skills/timecamping-data/SKILL.md:67`). [skill]
- "I entered it by hand" has a record, `entered_by_hand_at`, on an explicit confirmation (`.claude/skills/timecamping-data/SKILL.md:149`). `/bill-client`'s stop does not name it, so whether a billing run reaches it is [unverified].
- "Leave it for an estimate" has no record of any kind. The block just stays listed. A resumed session cannot tell it from a block never asked about.
- A hand entry shows up in the next pull, so its effect is kept even if its answer is not. [inferred]

### 5. What happens on vetting again?

Confirmed: answers save to `vetted.json` before the next line shows, and re-entry starts "from the first line it does not hold" (`.claude/skills/vet-billable-time/SKILL.md:37`). [skill] The model writes the file by hand, and no script checks it until `final`. Confirmed: on a pass, `tie_out.py final` rewrites the two reports and three data files (`.claude/skills/vet-billable-time/scripts/tie_out.py:471-485`). On a fail it writes nothing (`:14`). [code]

**Re-running a fully vetted matter, by the code path:**

1. Step 1 pulls the entries again, from the day after the last billed date to today. [skill]
2. `tie_out.py pull` re-checks the window, the connector totals and the judged marks. [code]
3. Step 3 re-reads proposals and re-scans the markers. Its results are not compared with `vetted.json`. [skill]
4. Step 4 repeats. Saved rates and the clerical setting are not asked again, and the rates and any blank-note list are shown again. [skill]
5. Step 5 finds every line held and shows none. [skill]
6. Step 6 has no resume rule. An approved estimate is in `estimates`, but the skill does not say to skip the question. Other date answers enter `vetted.json` at step 7 (`candidates`, `.claude/skills/vet-billable-time/SKILL.md:51`), so an answer given and not yet written is lost. [skill]
7. `final` needs `--run-started`, "when this bill's time work began", which nothing records. A later value narrows the scope check (`tie_out.py:280`). [code]
8. `final` passes and rewrites. A different `--date` writes new report names and leaves the old ones. `invoice_lines.json`, `line_map.json` and `time_entries.json` are overwritten. [code]
9. `upsert_time_entries` updates by matter and `source_key` and adds none (`source/lawyer/mcp/src/tools/practice/billing.ts:44`, `cloud/items/rules.sql:220`, test `practice-billing.unit.test.mjs:38`). A locked entry is left alone and named. [code]

**What changes between runs:**

| Change in TimeCamp | Result | Mark |
|---|---|---|
| A new entry | It has no line, so step 5 shows it. Until then `final` fails with "has no line" (`tie_out.py:198`) | [code] |
| An entry removed | Its line fails as "matches no connector entry" (`tie_out.py:199`, test `test_missing_line_and_stray_line`). Its practice record stays open, because the upsert never removes | [code], record [inferred] |
| An entry's duration or note changed | Nothing compares it. The old answer stands, and the new duration bills. `check_accuracy` is the only guard, on the invoice total | [inferred] |

**The next bill.** `vetted.json` sits at one path per matter and no step clears or archives it, `/issue-invoice` included. Its old entry ids fall outside the next bill's window, so they fail as stray lines. [inferred from code] The same goes for marks, which stay but harmlessly, because earlier dates fall outside the new window. Whether this happens in practice is [unverified], because no second bill has run.

**A failed final leaves the old pass.** A later failure writes nothing, so the earlier `invoice_lines.json` keeps its `passed_on` stamp. `render_invoice.py` checks only that a stamp exists (`.claude/skills/bill-client/scripts/render_invoice.py:115`), so it would render the old lines. [inferred from code]

### 6. Steps 7 to 9

- **` vN`: confirmed.** `free_stem` never overwrites (`.claude/skills/bill-client/scripts/render_invoice.py:147`, test `test_second_render_never_overwrites`). [code] The ready-for-signature render takes the same route under its own name.
- **Disbursements re-collected: confirmed.** `collect_disbursements.py` rereads every receipt and folder, then overwrites `--out` (`.claude/skills/bill-client/scripts/collect_disbursements.py:285`). [code]
- **Where rulings go.** They go in the `--decisions` file, `{line_key: {charged, taxable}}` (`:31`). [code] `/bill-client` says "Put their answers in `--decisions`" and names no path or file (`.claude/skills/bill-client/SKILL.md:91`), and the same holds for `--receipts`, which carries fees read from scans. [skill] A session that keeps those files can reuse them, and one that does not asks again. Line keys come from the file's hash, so they hold across runs (`:33`). An unknown key stops the run (`:231`, test `test_a_decision_settles_the_tax_status_and_an_unknown_key_stops`). A ruling on a line now outside the period is also unknown, because `settle` sees only lines inside it (`:274-278`). [inferred from code]
- **`freeze_invoice.py` on a second run.** The same content reports the existing files and rewrites only `issue_records.json`. Any other content is refused as `already_frozen` (`.claude/skills/bill-client/scripts/freeze_invoice.py:137-145`, tests `test_the_frozen_copy_is_never_rewritten` and `test_an_issue_that_stopped_can_resume_from_the_same_copy`). [code] `practice_data__issue_invoice` then refuses a second issue (`source/lawyer/mcp/src/tools/practice/billing.ts:160`). [code]
- **The chart.** `build_chart.py` refuses any output that exists (`.claude/skills/bill-client/references/build_chart.py:84`), and `chart.md` stops and asks on a taken workbook name (`.claude/skills/bill-client/references/chart.md:19`). The name holds today's date. [code and skill]

### 7. Steps 1 to 5

Not quite read-only apart from the import. Step 1 may seed matter-data (`.claude/skills/bill-client/SKILL.md:32`), and step 2 may send the practitioner to `/housekeeping` in another plugin (`:41`). [skill]

The import does repeat safely. [code]

- A row with a number upserts by matter and number (`cloud/items/rules.sql:219`).
- `date_to` is sent only when the row carries it (`source/lawyer/mcp/src/tools/practice/invoices.ts:156`).
- An already issued invoice takes only what happened since (`:164`).
- A move of the cutoff backward refuses the whole import until confirmed (`:131`).
- A row with no number replaces the matter's other rows with no number (`:44`). This is the one case where repeating changes what was stored.

The billed dates with their time, from step 4, reach no store. "Step 6 passes them on" (`.claude/skills/bill-client/SKILL.md:53`) means by conversation, and `/triage-billing-dates` re-reads the PDF when not given them (`.claude/skills/triage-billing-dates/SKILL.md:22-26`). [skill]

## Each step's writes

| Step | Write | Goes to | On a re-run |
|---|---|---|---|
| 1 | Matter seed | `/matter-data` `initialize` | Skipped once initialized [skill] |
| 5 | Invoice record | `practice_data__import_invoices`: `practice.db`, with hashes in the cloud | Upserts [code] |
| 6.1 | Candidate list | `<draft folder>\BILLING\YYYY-MM-DD Candidate dates` | Same day rewrites, later day adds [skill] |
| 6.1 | Phone matches | `<work>\triage-billing-dates\phone-matches.json`, by `scan_windows.py phones` | Overwritten [skill] |
| 6.1 | Call archive | `timecamping_data__bulk_upsert`: `telus_calls`, `source_fetch_log` | Upserts, ids stable [skill] |
| 6.1 | Triage, service list, document, filing and received-mail rows | `time_pipeline__set` or `bulk_apply`, namespace `evidence` | `set` overwrites. A changed value through `bulk_apply` waits for approval [code] |
| 6.1 | A contact's number | `practice_data__upsert_contact`, on a yes | The list replaces [skill] |
| 6.2 | Timeline rows | `/build-timeline`: `time_pipeline__bulk_apply`, namespace `timeline` | One pasted approval per date (`.claude/skills/build-timeline/SKILL.md:276`) [skill] |
| 6.2 | Source rows and fetch log | `timecamping_data__bulk_upsert` | Upserts [skill] |
| 6.2 | Proposals, determinations, hand-entry stamp | `timecamping_data__execute` | `proposals` has no unique key, so a blind re-run duplicates (`.claude/skills/timecamping-data/SKILL.md:144`) [skill] |
| 6.2 | TimeCamp change | `timecamp__update_entry`, each with a pasted approval | Skips a locked entry, re-reads each after writing [skill] |
| 6.2 | `call_window`, `statement`, `marker` rows | namespace `evidence` | As above [skill] |
| 6.2 | Judged mark | `<work>\timecamping\judged-dates.jsonl`, appended by the model | Never removed [skill] |
| 6.4 | Each answer, and approved estimates | `<work>\vet-billable-time\vetted.json`, written by the model | Resumes from it [skill] |
| 6.4 | Approved estimate, marker | namespace `evidence` | As above [skill] |
| 6.4 | Rates, clerical setting | `practice_data__upsert_rate`, `upsert_firm_profile` | Upsert by matter, person and date (`cloud/items/rules.sql:221`) [code] |
| 6.4 | Reports | `<draft folder>\BILLING\<date> Billable time audit.md` and `summary.md` | Same `--date` rewrites, a new one adds [code] |
| 6.4 | Lines, map, entries | `<work>\vet-billable-time\invoice_lines.json`, `line_map.json`, `time_entries.json` | Overwritten on a pass only [code] |
| 6.4 | Time entries | `practice_data__upsert_time_entries` | Updates, leaves locked ones alone [code] |
| 7 | Workbook, chart | `BILLING\<date> TimeCamp Time report ...xlsx`, PNG in `<work>\bill-client\` | Refuses a taken name [code] |
| 8 | Template, once | `<work>\bill-client\Invoice template.docx`, then the firm profile | `--out` must not exist (`build_invoice_template.py`) [code] |
| 8 | Invoice facts, disbursements | `<work>\bill-client\invoice.json`, `disbursements.json` | Rewritten [skill], overwritten [code] |
| 8, 9 | Draft and ready invoice | `BILLING`, `.docx` and optionally `.pdf` | Next ` vN` [code] |
| Issue | Frozen copy, records, invoice | `BILLING\<date> Invoice <number> audit.json` and `.md`, `issue_records.json`, `practice_data__issue_invoice` | Same copy resumes, otherwise refused [code] |

**Scripts that write nothing of the bill's own:** `blank_staff_notes.py` only prints (`.claude/skills/vet-billable-time/scripts/blank_staff_notes.py:8`). `cso_pdf.py` only reads, for `collect_disbursements.py`. `line_map.py` builds what `tie_out.py` writes. `practice_data__insert_time_entry` and `set_time_entries_billable` exist (`source/lawyer/mcp/src/tools/practice/writes.ts:177`, `:196`), but no step of this path calls them. The path uses `upsert_time_entries`.

## What needs a live run

- Why the 2026-11-04 save was lost, and which installed copies that run read.
- The next bill on a matter with a `vetted.json` from the last one.
- A candidate-list run on a date with committed proposals and no mark, and which of the two re-run rules it follows.
- `/bill-client` reaching the manual-completion record at the uncovered-time stop.

This audit ran no script against client data and made no live billing run. It did not read `references/uno-gotchas.md`, which holds chart mechanics and no write. It read the first lines of `build_chart.py`, `build_invoice_template.py` and `cso_pdf.py` and searched the rest.
