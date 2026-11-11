---
name: "bill"
disable-model-invocation: true
description: "Use when the user asks to \"bill a client\", \"run billing for [matter]\", or \"prep the bill\" for a BC litigation matter: runs the whole path from the last invoice to an invoice ready for the lawyer's signature, with a billable time summary and an audit file beside it, and stops there. Sends and issues nothing."
---

<!-- billing v0.5.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| The bill record | Writing a step's record, or the bill's state |
| A bill already under way | Step 1 has found the matter |
| Step 1 — Identify the matter and client number | Starting billing for a matter, first |
| Step 2 — Look up the last invoice in the practice records | Before looking for the last invoice in the folder |
| Step 3 — Find the most recently sent bill | The records have been read and the last invoice must be located |
| Step 4 — Read the bill to find the exact last-billed date | Setting the start of the unbilled period |
| Step 5 — Cross-check against matter-data / practice-data | Verifying the last invoice or recording invoices |
| Step 6 — Run the time work | Carrying the matter from its dates of work to confirmed billable lines |
| Step 7 — The chart | The last signed invoice has a chart, or the practitioner asks for one |
| Step 8 — Render the draft invoice | The billable time summary has passed |
| Step 9 — Present the draft, make it ready for signature, and stop | The draft is rendered |

# /bill

One typed command takes one litigation matter from its last invoice to an invoice ready for the lawyer's signature, with a billable time summary and an audit file beside it. It runs every step below in order, in this conversation, and stops at the unsigned invoice. A DRAFT mark means the invoice is still a draft, and no mark means it is ready for signature. It sends nothing, issues nothing, records no invoice before the lawyer signs it and moves no trust money. Only the lawyer signs.

## The bill record

The bill in progress is recorded as it goes, so a fresh session on any computer learns where it stands from recorded data alone, never from a summary or a handoff. This skill reads and writes the record itself with `time_pipeline__list`, `time_pipeline__get` and `time_pipeline__set`, in namespace `bill`, which it owns. Those tools are on this plugin's `timekeeping` server, under whichever of `mcp__plugin_billing_timekeeping__<name>` and `mcp__remote-devices__plugin_billing_timekeeping__<name>` this host grants. Their descriptions send a caller to another skill first, and for this namespace that does not apply (ruled on #250). Never call `time_pipeline__delete` or `time_pipeline__bulk_apply` on it: a record is ended, never removed.

**Saving the bill record.** Every write to the record takes these four steps:

1. Read with `time_pipeline__list` as today, and keep each row's `sha256`.
2. Save with `time_pipeline__set`, passing `expect_sha256` for a key that was read, or `expect_absent: true` for a new key.
3. On `stale_write`: call `time_pipeline__get` for that key, make the same change to the value it returns, and save once more with the new hash.
4. On a second `stale_write`: say once, in plain words, that this step's progress was not saved, and carry on. This is the skill's existing rule for a failed write.

| Key | Value (a JSON string) |
|---|---|
| `<bill id>:bill` | `state`, `started_at`, `signed_invoice` (path, SHA-256 hash and number, or `first_bill`), `bill_number`, `superseded` (each final copy a reopen replaced), and `history` (each move with when and why) |
| `<bill id>:step:<step>` | `finished_at` and that step's row below |

The bill id is `<matter number>:<YYYYMMDD-HHMMSS>`, stamped when the record is created. It is new at every start-over, so an old bill's keys are never overwritten. Keys under `<bill id>:item:` are reserved. A path inside the matter's folder is recorded relative to that folder, because the bill may resume on another computer. A resumed bill keeps the working folder its record names, even the older `<matter-data folder>\bill-client\`, and only a new bill uses `<matter-data folder>\bill\`. To change a value, read it, change it, and write the whole value back by the four steps above. If a write fails, say once, in plain words, that this step's progress was not saved, and carry on.

| `state` | The practitioner hears | Entered when | Left when |
|---|---|---|---|
| `in_progress` | Under way | Step 5 finishes, or a reopen | The yes at Step 9, a start-over, or issue |
| `ready_for_signature` | Waiting for signature | The yes at Step 9, which closes the billing period at once | A reopen, a start-over, or issue |
| `ended_issued` | Issued | `/issue-invoice` records the invoice | Never |
| `ended_started_over` | Started over | The practitioner confirms a start-over | Never |

Each step writes its row when it finishes, from what it already holds. A step that stops writes nothing. Compute a hash as Step 3 does.

| Step | Done when | Row |
|---|---|---|
| 1 | Profile read | Matter number and client number |
| 2 | Records read and the folder listed | When checked, the latest recorded invoice number (or none), and each file name and hash looked at |
| 3 | Invoice chosen | Signed invoice's path and hash, or first bill |
| 4 | Dates read | Bill date, last billed date, each billed date with its time, and whether a date was assumed |
| 5 | Records agree or are imported | Invoice number read from the document, and any import |
| 6.1 | List saved | List's path and hash, last date covered, count per strength, and the phone matches' path |
| 6.2 | Every Strong and Medium date is judged or reported, and the Weak offer is answered | The path and hash `review_date__export` returned for `judged-dates.export.jsonl`, each date left without a mark and why, and the Weak answer |
| 6.3 | The page has no flagged block left | The path and hash `time_review__export_blocks` returned for `blocks.json`, each flagged block the practitioner answered by its act, and each date left unjudged and why |
| 6.4 | Tie-out passed and time entries recorded | The saved `vetted.json` path and hash, last date covered, fees and hours printed, and the reports' paths and hashes |
| 7 | Chart saved or not needed | Whether one is needed, the image's path, and the hash of the lines it drew |
| 8 | Render passed | Word or PDF, tax rates shown, each disbursement ruling, draft path and version, figures printed, and the hash of the lines used |
| 9 | The copy with no DRAFT mark is rendered | The yes and when, the bill number, and the final copy's path, hash and figures |

## A bill already under way

After Step 1, call `time_pipeline__list` once, with namespace `bill` and prefix `<matter number>:`. A bill is live if its `<bill id>:bill` value holds `state` `in_progress` or `ready_for_signature`. With no live bill, go to Step 2 as a new bill. If two are live, tell the practitioner when each started and ask which to carry on with. The other ends only by a start-over.

**Ready for signature.** Say the invoice is waiting for signature, present the final copy as a file card, and say that this bill adds nothing more, so new work goes to the next bill. Offer to reopen, and stop. If Step 9 has no row, the yes was given but the final copy was never made. First finish Step 9's render from Step 8's recorded files. If the hash of the lines no longer matches Step 8's row, render nothing, say so, and offer to reopen.

**In progress.** Test whether Steps 2 to 5 still stand, without reading the invoice:

- Hash the recorded signed invoice and compare it with the record.
- List `2. SOLICITOR CLIENT`. A newer signed invoice is one dated after the recorded one, or bearing a later invoice number. A file missing from Step 2's row that could be an invoice could be one, so count it as one.
- On a first bill, the test is that the folder still holds no signed invoice.

If the hash matches and there is no newer signed invoice, Steps 2 to 5 count as done: carry their recorded facts forward and go to Step 6. Read the invoice only when a later step needs what only the invoice holds, as Steps 7 and 8 do. Otherwise, say in plain words what changed and redo Steps 2 to 5 as usual. If Step 3 then lands on the same invoice, their rows are rewritten on this bill. If it lands on another, this bill no longer describes the matter's last invoice: say so, offer a start-over, and stop.

**The status.** Before going on, say in plain words when the bill started, what is settled, and the next step. Only Steps 1 to 5 can be settled. Steps 6 to 9 run again, whatever their rows say, and they ask what they ask on any run. The candidate list in 6.1 is not rebuilt: it is kept in the store, and the run searches only the days after its last covered date and the leads still open. Say so only as a plan for this run, never as done. Never call any of them done, kept or saved, because a practitioner who is told a step is kept will not check it. If rows exist for them, say only how far the earlier run got and when. For example:

> This bill started on 29 October. The last invoice, INV#12345, billed to 14 September, still matches, so I am not checking it again. An earlier run got as far as a draft on 30 October, but the time work and everything after it run again. Next is the time work.

**Reopen,** only from Ready for signature, and only when the practitioner asks for it and says why. Set `state` to `in_progress`, add the reopen to `history`, and add the final copy to `superseded`. Tell the practitioner that the unmarked copy stays on disk, is now superseded and should not be signed. Neither rename nor move it. The bill keeps its number. Then run the test above.

**Start-over,** only on the practitioner's confirmation, from either live state. First say what it means: the evidence, the time judgments and the TimeCamp changes already made stay, the drafts stay on disk, and everything else is asked afresh, except that line answers already given at vetting stay in use for now. On their yes, set `state` to `ended_started_over`, add it to `history`, and go to Step 2. Step 5 creates a new bill.

## Step 1 — Identify the matter and client number

Open the matter's workspace folder (e.g. `...\L8166 LindaleJ re Parental Loan`). The matter number is the leading token of the folder name (`L8166`). The client number is **not** derivable from the folder name — get it from matter-data:

- Invoke the `matter-data` skill's `profile` operation for the matter. It reports the client number, client name, matter number and short name.
- If the matter has never been initialized in matter-data, the `matter-data` skill's `initialize` operation will look up the client/matter via `practice-data` `matter-lookup` and seed it — do this before continuing.

Then check for a bill already under way, as that section says, before Step 2.

## Step 2 — Look up the last invoice in the practice records

The practice records hold every invoice `/issue-invoice` recorded and every invoice imported at Step 5, so they are read first. File names are not trusted on their own.

1. Invoke the `practice-data` skill's `invoice-data` operation for the matter number. Take the latest recorded invoice by issue date. A row `/issue-invoice` recorded carries the signed copy's path and hash. An imported row may carry neither.
2. List the files in `2. SOLICITOR CLIENT` and compute each one's SHA-256 hash (`sha256sum` in bash works fine). Note any signed invoice dated after the latest recorded one, or bearing a later invoice number.
3. If the records hold no invoice and no import date, practice-data has never been populated for this matter: say so to the practitioner rather than silently trusting the folder. Carry on with Step 3.

## Step 3 — Find the most recently sent bill

- **The records hold an invoice and the folder holds no newer signed invoice.** The most recently sent bill is the latest recorded invoice. Its PDF is the signed copy at its recorded path, or else the file in `2. SOLICITOR CLIENT` bearing its invoice number. If a recorded hash does not match the file, say so and treat it as the next case.
- **The records hold no invoice for the matter, or the folder holds a signed invoice newer than the latest recorded one.** Take the newest invoice file in `2. SOLICITOR CLIENT`, read it as Step 4 does, and verify and record it as Step 5 does.
- **Still no single last signed invoice** (no candidate, or two that could each be the last): ask the practitioner that one question, which file is the last signed invoice, or whether this is the matter's first bill.

Record the chosen file's path and its SHA-256 hash, or that this is the first bill.

## Step 4 — Read the bill to find the exact last-billed date

Read the invoice PDF. Call `pdf_pages__images` for it first, and read a page it returns as `scanned` only from its PNGs, never from the PDF or its text layer, and a `born_digital` page with `Read` `pages:` (`/matter-data`'s design decision #71). Every invoice PDF read below is read the same way. If the tool refuses, say so with its reason and read the PDF no other way. Look at the time-entry bar chart (or itemized list) and find the single latest date with a billed entry — **read the axis/labels precisely, do not eyeball or round to the invoice date.** An invoice that lists no service dates has nothing to read: take its invoice date as the last billed date, and tell the practitioner that is an assumption.

Sanity-check: the last billed date should be on or before the invoice date. If it's after, something is wrong — recheck.

Record the bill date, the last billed date and each billed date with the time billed on it. Step 6 passes them on.

## Step 5 — Cross-check against matter-data / practice-data

Use the rows Step 2 read to compare what practice-data holds with the invoice read at Step 4.

- If the practice-data invoices don't match what's on disk, **verify before recording anything**: open each candidate invoice PDF, as Step 4 reads one, and confirm (a) it bears a lawyer's signature, and (b) the invoice number printed inside the document matches the invoice number in the file name. Never trust the file name alone for invoice number, date, or amount — read the PDF.
- Once verified, invoke the `practice-data` skill's `import-invoices` operation to record each invoice's matter number, invoice number, issue date, `date_to` (the last billed date, left out when the invoice lists no service dates), amount, amount paid and status. Leave amount paid and status blank unless the document itself gives positive evidence of what was actually paid — a static invoice PDF only proves the amount *billed*, not what happened to it afterward.

**Create the record.** With no live bill, make a bill id and write `<bill id>:bill` with `state` `in_progress`, `started_at` now, and `signed_invoice`, using `time_pipeline__set`. Then write the rows for Steps 1 to 5. This is the first write, because the bill is identified by its last signed invoice. Until here, an interrupted bill simply redoes these steps. With a live bill whose Steps 2 to 5 were redone on the same invoice, rewrite its rows and `signed_invoice` instead.

## Step 6 — Run the time work

Write each numbered item's row in the bill record as it finishes.

This step needs the billing plugin. If no billing skill is in your skill list, tell the practitioner that the time work needs the billing plugin installed, and stop. Never tally time from the TimeCamp web app: a figure that did not come from the connector is not used.

1. **Candidate dates.** Invoke `/triage-billing-dates` for the matter, giving it the last invoice's facts from Step 4 or its row, so the PDF is read once. The list lives in the store as `candidate_date` records, so a resume adds only the new days and open leads. Give the later steps the `candidates.json` export it returns, not the Markdown file.
2. **Judge the days.** **In Cowork, stop here,** before `/timecamping` starts. In Cowork (this host grants the data tools as `mcp__remote-devices__plugin_lawyer_data__<name>`), a day's review cannot finish, because SyncoPaid's screen captures can be read only on the PC, and the time review page that shows a judged day is served on the PC only. Tell the practitioner so, that the candidate list is saved, and how to carry on: open a Code-tab session in the desktop app, in the matter's folder, and type `/bill`. Do not retry or probe in Cowork. Everywhere else, invoke `/timecamping`'s parallel mode (its "Parallel mode" section) with the candidate list and this bill's id as the holder. It gathers, picks and reads screenshots, and has the day reviewers judge every Strong and Medium date, strongest first, putting no question to the practitioner. It never changes TimeCamp. Offer the Weak dates once, as a group, and judge them only on the practitioner's yes.
   - **First use on a matter that has a `judged-dates.jsonl`** (in `<matter-data folder>\timecamping\`): before invoking `/timecamping`, call `review_date__import_file` with that path, `judged_by` the practitioner, and `dry_run` true. Tell the practitioner the count it would add, and call it again with `dry_run` false on their yes.
   - **A date judged in chat before the page existed** is marked judged but has no blocks, so the page has nothing to show for it. The parallel mode judges such a date once more to build them, and `/bill` says which dates it is judging again and why. It never builds blocks from the old chat answers.
   - **When `/timecamping` returns,** call `review_date__export` for the candidate list's first and last dates, with `out_path` `<matter-data folder>\timecamping\judged-dates.export.jsonl`, and give that path to `tie_out.py` as its judged dates file.
   - **On a resume,** run the parallel mode's resume step, so a TimeCamp entry changed since the day was judged returns its block to flagged.
3. **The page.** Serve the review page as `/timecamping`'s "The review page" says, and give the practitioner the address. Only flagged blocks need action: Approve, Correct, Write off, Split or Merge on the page. Wait for each click and handle it as that section says, until `time_review__read_day` reports every date from the candidate list's first to its last as `clear`, or the practitioner says to stop. A block the practitioner leaves flagged is listed with its date, and the bill goes no further. The session never creates a TimeCamp entry, and it records no approval itself: only a click does.
4. **Export and tie out.** Call `time_review__export_blocks` for the candidate list's first and last dates, with `out_path` `<matter-data folder>\vet-billable-time\blocks.json`. Invoke `/vet-billable-time` with the matter, the candidate list (the `candidates.json` export), the last billed date, the retainer PDF and that file. It turns the reviewed blocks into the vetted lines, records the time entries, writes the billable time summary and the audit file to the `BILLING` folder, and writes `invoice_lines.json` and `line_map.json` to its working folder. Every figure on the invoice comes from that file, and a line with neither evidence nor an estimate basis cannot reach it. Each invoice line carries the ids of its blocks, so it can be opened on the page. A step that stops stops this skill: report it and go no further.

## Step 7 — The chart

If the last signed invoice has a time-entry bar chart, or the practitioner asks for one, read `references/chart.md` and build it from `invoice_lines.json`, then save the chart as a PNG in `<matter-data folder>\bill\`. Otherwise go to Step 8. Either way, write this step's row.

## Step 8 — Render the draft invoice

Ask once whether the practitioner wants Word or PDF. `scripts/render_invoice.py` fills the firm's invoice template, and its docstring is the contract for its inputs. It recomputes every amount and refuses a figure that does not tie. The layout is the template's: never lay out an invoice in this conversation. Run it with the host Python (`python`; if that is the WindowsApps stub, the interpreter `COCLERK_PYTHON` names) in a shell that reaches the matter folder. In Cowork, first request access with `request_cowork_directory`. If no shell can reach it, say so and stop.

1. **The template** is the `invoice_template` path `practice_data__firm_profile` returns. If it is null, build it once:
   - The `letterhead` path must not be null. If it is, tell the practitioner a firm letterhead must be registered, and stop.
   - The profile's `style` is the firm's style guide. If it is absent, ask the practitioner for its values (`scripts/build_invoice_template.py`'s docstring lists them, and `chart_series` gives each roster key a color), read them back, and set `style` with `practice_data__upsert_firm_profile` on their approval.
   - Write `wording.json` from the closing and the paragraphs after it in the last signed invoice read at Step 4, with `{{AUTHOR_NAME}}` for the lawyer's name, and with no amount. Run `scripts/build_invoice_template.py` with `--out <matter-data folder>\bill\Invoice template.docx`. Images come only from the letterhead: never take one from a signed document.
   - Present that file as a file card (`shared/present-files.md`) and ask the practitioner to correct it in Word and say whether to save it as the firm's template. Only on their yes, pass its path as `invoice_template` to `practice_data__upsert_firm_profile`. Otherwise stop.
2. **Write `invoice.json`** in `<matter-data folder>\bill\`. The our-reference, addressee, delivery and Re lines and the salutation come from the last signed invoice read at Step 4, never an amount. If this is the matter's first bill, ask the practitioner for them once. The invoice date is today. The bill number is `DRAFT` until Step 9: never assign one. The letterhead's tokens come from the firm profile and the matter's file number. `chart` is the PNG from Step 7, if there is one.
3. **Taxes.** Work each tax's rate from the last signed invoice's printed tax and fees, and show the rates to the practitioner once before rendering.
4. **Trust.** If the last signed invoice states trust applied, set `trust_balance` to the matter's balance from `practice_data__trust_summary`. The invoice only states it.
5. **Disbursements.** They come only from this item's output, plus any the practitioner adds, passed with its receipt file through `--receipts`. Run `scripts/collect_disbursements.py` (its docstring is the contract) with `--cso-dir` once each for the matter's disbursements folder and `4. LAWYER BRIEF\CSO`, `--from` the day after the last billed date (none on a first bill), `--to` today, `--billing-settings` a file holding the firm profile's `billing_settings`, and `--out` `<matter-data folder>\bill\disbursements.json`.
   - In plain words and with its file name, show the practitioner every line with a flag and every entry in `undecided`, `needs_scanned_route`, `unread`, `other_files` and `outside_period`. Never decide a flagged line or a tax status for them.
   - Read each `needs_scanned_route` and `unread` file as Step 4 reads a PDF, and pass its fees back through `--receipts`, unless the practitioner says it holds no fee.
   - Put their answers in `--decisions` and re-run. Never edit the output.
   - Render only once every entry has been shown and every such file is settled. Nothing else checks this.
6. **Render** with `--lines` the `invoice_lines.json`, `--template` the path above, `--disbursements` the file from item 5, `--out-dir` the `BILLING` folder, `--out-name` `YYYY-MM-DD Draft invoice re <matter short name>`, and `--pdf` if the practitioner asked for PDF. A taken name gets the next ` vN`. A refusal stops this step: tell the practitioner what it says, and never edit a figure to get past it. On a pass, write this step's row.

## Step 9 — Present the draft, make it ready for signature, and stop

Present the draft, the summary and the audit file as clickable file cards (`shared/present-files.md`). State the fees, disbursements, taxes, total, trust applied and amount due the render printed, and show the summary's gaps section in full. Ask whether the draft is ready for signature. A change means a new draft, from the step it touches.

Only on their yes, set the bill's `state` to `ready_for_signature` and add the yes to `history`, because the yes closes the billing period at once. Then ask for the bill number from accounting, and never assign one. On a reopened bill, ask instead "Still INV#<bill number>?", and a yes accepts it. Set it as `bill_number` in `invoice.json` and in the bill's value, and repeat Step 8's render with `--ready-for-signature` and `--out-name` `YYYY-MM-DD INV#<bill number> re <matter short name>`. Write this step's row. Present that invoice as a file card. Say that it carries no DRAFT mark because it is ready for signature, that nothing was sent, issued, recorded or moved, and that the signature is the lawyer's to add. Then stop. Tell the practitioner that once it is signed, `/issue-invoice` records it, locks its support and writes the frozen copy.
