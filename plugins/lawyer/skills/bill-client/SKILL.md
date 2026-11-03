---
name: "bill-client"
disable-model-invocation: true
description: "Use when the user asks to \"bill a client\", \"run billing for [matter]\", or \"prep the bill\" for a BC litigation matter: runs the whole path from the last invoice to a draft invoice for the lawyer's signature, with a billable time summary and an audit file beside it, and stops there. Sends and issues nothing."
---

<!-- lawyer v0.21.9 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Step 1 — Identify the matter and client number | Starting billing for a matter, first |
| Step 2 — Check housekeeping on "2. SOLICITOR CLIENT" before trusting file names | Before reading file names to find the last invoice |
| Step 3 — Find the most recently sent bill | Housekeeping is current and the last invoice must be located |
| Step 4 — Read the bill to find the exact last-billed date | Setting the start of the unbilled period |
| Step 5 — Cross-check against matter-data / practice-data | Verifying the last invoice or recording invoices |
| Step 6 — Run the time work | Carrying the matter from its dates of work to confirmed billable lines |
| Step 7 — The chart | The last signed invoice has a chart, or the practitioner asks for one |
| Step 8 — Render the draft invoice | The billable time summary has passed |
| Step 9 — Present the draft and stop | The draft is rendered |

# /bill-client

One typed command takes one litigation matter from its last invoice to a draft invoice for the lawyer's signature, with a billable time summary and an audit file beside it. It runs every step below in order, in this conversation, and stops at the unsigned draft. It sends nothing, issues nothing, records no invoice before the lawyer signs it and moves no trust money. Only the lawyer signs.

## Step 1 — Identify the matter and client number

Open the matter's workspace folder (e.g. `...\L8166 LindaleJ re Parental Loan`). The matter number is the leading token of the folder name (`L8166`). The client number is **not** derivable from the folder name — get it from matter-data:

- Invoke the `matter-data` skill's `profile` operation for the matter. It reports the client number, client name, matter number and short name.
- If the matter has never been initialized in matter-data, the `matter-data` skill's `initialize` operation will look up the client/matter via `practice-data` `matter-lookup` and seed it — do this before continuing.

## Step 2 — Check housekeeping on "2. SOLICITOR CLIENT" before trusting file names

Before reading file names to find the last invoice, confirm housekeeping has already been run on `2. SOLICITOR CLIENT`:

1. List files in that folder, compute SHA-256 hashes (`sha256sum` in bash works fine).
2. Invoke the `matter-data` skill's housekeeping-log operation in `lookup` mode with the list of `{file_name, file_hash}` pairs.
3. If every non-conforming file already has a review row (matched by name or hash), housekeeping is up to date — no action needed.
4. If there are files that fail the naming grammar (`file-naming/scripts/name_gate.py`, against `file-naming/references/code-registry.md`) **and** are not yet in the review log, stop and ask the practitioner to run `/housekeeping` on that one folder, then continue once they confirm it is done. `/housekeeping` ships in the `file-manager` plugin: if it is not available in this session, say that naming those files needs `file-manager` (or the practitioner renaming them by hand), and stop. Do not skip this — file names are how the next step finds the invoice.

## Step 3 — Find the most recently sent bill

With housekeeping current, invoice files sort by name (`YYYY-MM-DD INV#nnnnn ... signed.pdf`). Pick the latest date. This is "the most recently sent bill."

## Step 4 — Read the bill to find the exact last-billed date

Read the invoice PDF. Call `pdf_pages__images` for it first, and read a page it returns as `scanned` only from its PNGs, never from the PDF or its text layer, and a `born_digital` page with `Read` `pages:` (`/matter-data`'s design decision #71). Every invoice PDF read below is read the same way. If the tool refuses, say so with its reason and read the PDF no other way. Look at the time-entry bar chart (or itemized list) and find the single latest date with a billed entry — **read the axis/labels precisely, do not eyeball or round to the invoice date.** An invoice that lists no service dates has nothing to read: take its invoice date as the last billed date, and tell the practitioner that is an assumption.

Sanity-check: the last billed date should be on or before the invoice date. If it's after, something is wrong — recheck.

Record the bill date, the last billed date and each billed date with the time billed on it. Step 6 passes them on.

## Step 5 — Cross-check against matter-data / practice-data

Invoke the `practice-data` skill's `invoice-data` operation for the matter number to see what practice-data thinks the last invoice date is.

- If it returns no rows and no import date, practice-data has never been populated for this matter — flag this to the user rather than silently trusting the PDF-derived date.
- If the practice-data invoices don't match what's on disk, **verify before recording anything**: open each candidate invoice PDF, as Step 4 reads one, and confirm (a) it bears a lawyer's signature, and (b) the invoice number printed inside the document matches the invoice number in the file name. Never trust the file name alone for invoice number, date, or amount — read the PDF.
- Once verified, invoke the `practice-data` skill's `import-invoices` operation to record each invoice's matter number, invoice number, issue date, `date_to` (the last billed date, left out when the invoice lists no service dates), amount, amount paid and status. Leave amount paid and status blank unless the document itself gives positive evidence of what was actually paid — a static invoice PDF only proves the amount *billed*, not what happened to it afterward.

## Step 6 — Run the time work

This step needs the timekeeper plugin. If no timekeeper skill is in your skill list, tell the practitioner that the time work needs the timekeeper plugin installed, and stop. Never tally time from the TimeCamp web app: a figure that did not come from the connector is not used.

1. **Candidate dates.** Invoke `/get-candidate-dates` for the matter, giving it the last invoice's facts from Step 4, so the PDF is read once.
2. **Judge the days.** Invoke `/timecamping` with the candidate list. It works the Strong and Medium dates, strongest first, and every change it makes to TimeCamp waits for the practitioner's approval.
3. **Time only the practitioner can enter.** Give the practitioner `/timecamping`'s list of possible unbilled time, and stop until they say they have entered it in TimeCamp by hand or have decided not to. The session never creates an entry.
4. **Vet the lines.** Invoke `/vet-billable-time` with the matter, the candidate list, the last billed date and the retainer PDF. It writes the billable time summary and the audit file to the `BILLING` folder, and `invoice_lines.json` to its working folder. Every figure on the invoice comes from that file. A step that stops stops this skill: report it and go no further.

## Step 7 — The chart

If the last signed invoice has a time-entry bar chart, or the practitioner asks for one, read `references/chart.md` and build it from `invoice_lines.json`, then save the chart as a PNG in `<matter-data folder>\bill-client\`. Otherwise go to Step 8.

## Step 8 — Render the draft invoice

Ask once whether the practitioner wants Word or PDF. `scripts/render_invoice.py` renders it, and its docstring is the contract for its inputs. It recomputes every amount and refuses a figure that does not tie. Run it with the host Python (`python`; if that is the WindowsApps stub, the interpreter `COCLERK_PYTHON` names) in a shell that reaches the matter folder. In Cowork, first request access with `request_cowork_directory`. If no shell can reach it, say so and stop.

1. **The letterhead** is the `letterhead` path `practice_data__firm_profile` returns. If it is null, tell the practitioner a firm letterhead must be registered, and stop.
2. **Write `invoice.json`** in `<matter-data folder>\bill-client\`. Copy the layout and fixed wording from the last signed invoice read at Step 4: the reference lines, the addressee, the delivery line, the salutation, the Re line, the closing without any signature, and the paragraphs after it. If this is the matter's first bill, ask once which signed invoice to copy. Only layout and wording come from that invoice, never an amount. The invoice date is today. The bill number is `DRAFT`: never assign one. The letterhead's tokens come from the firm profile and the matter's file number.
3. **Taxes.** Work each tax's rate from the last signed invoice's printed tax and fees, and show the rates to the practitioner once before rendering.
4. **Trust.** If the last signed invoice states trust applied, state the matter's balance from `practice_data__trust_summary`, as a statement only.
5. **Render** with `--lines` the `invoice_lines.json`, `--letterhead` the path above, `--out-dir` the `BILLING` folder, `--out-name` `YYYY-MM-DD Draft invoice re <matter short name>`, and `--pdf` if the practitioner asked for PDF. A taken name gets the next ` vN`. A refusal stops this step: tell the practitioner what it says, and never edit a figure to get past it.

## Step 9 — Present the draft and stop

Present the draft, the summary and the audit file as clickable file cards (`shared/present-files.md`). State the fees, taxes and total the render printed, and show the summary's gaps section in full. Say that nothing was sent, issued, recorded or moved, and that the signature is the lawyer's to add. Then stop. If the practitioner later gives you the signed invoice in this conversation, verify and record it as Steps 4 and 5 do.
