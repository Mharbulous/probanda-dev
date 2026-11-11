# How Probanda bills a client: the `/bill` process

Based on commit `c9154155` on `main` of probanda-dev (lawyer 0.25.10, timekeeper 0.8.8), 2026-11-06. Screenshot review updated against commit `a0ac8923` plus the `timekeeper:screenshot-reader` change, 2026-11-06. The installed copies on this PC (lawyer 0.25.5, timekeeper 0.8.5) have the same skill text apart from version comments. Steps 2 and 3 and the skill's name (`/bill`, formerly `/bill-client`) updated against commit `f308fe7a`, 2026-11-10.

This is the prose for a planned diagram. It describes the process as built, not as it might be improved.

## 1. What the process promises

`/bill` takes one matter from its last signed invoice to a new invoice ready for the lawyer's signature. It sends nothing, issues nothing, records no invoice before signature and moves no trust money. `/issue-invoice` does the recording, after the lawyer signs.

The promise about completeness is narrower than "every minute is billed". It is that every **day with an indicator of work** since the last invoice is either:
- billed, from evidence or an approved estimate, or
- written off with a reason, or
- listed as unexplained, with a reason.

A script, not the model, refuses to produce invoice lines until that is true (section 4).

## 2. Who takes part

### Skills

| Plugin | Skill | Role in billing |
|---|---|---|
| lawyer | `/bill` | The conductor. Runs Steps 1 to 9 in order, keeps the bill record, renders the invoice. Typed by the practitioner. |
| lawyer | `/matter-data` | Supplies the client number (profile). |
| lawyer | `/practice-data` | Invoice history, invoice import, firm profile (template, letterhead, style, billing settings), rates, trust balance, time-entry records. |
| lawyer | `/show-me` | The presentation rules for every question asked of the practitioner: one decision per question, the actual evidence shown. |
| lawyer | `/issue-invoice` | After signature: freezes the record, issues the invoice, ends the bill. |
| timekeeper | `/triage-billing-dates` | Builds the candidate dates list. |
| timekeeper | `/timecamping` | Reviews each candidate date's whole day, corrects TimeCamp, and lists possible unbilled time. |
| timekeeper | `/build-timeline` | Fetches each day's raw evidence for `/timecamping`. |
| timekeeper | `/timecamping-data` | The time-review database: evidence tables, the evidence gate, proposals, determinations. |
| timekeeper | `/time-pipeline-data` | The key-value store holding the bill record (`bill`), the timeline and the evidence store. |
| timekeeper | `/vet-billable-time` | Vets every TimeCamp line, ties out, and writes the invoice lines. |

### Custom agents and helpers

| Agent | Where | Role |
|---|---|---|
| A background helper on Sonnet (general-purpose, no custom type) | `/triage-billing-dates`, Phase 2 | Scans the range's TimeCamp computer activity for the matter's keywords and returns matching stretches. Reads only. |
| `timekeeper:screenshot-reader` (Haiku 5.5, effort high, fixed in its file) | `/timecamping` Step 5 and `/triage-billing-dates`, Phase 2 | Views up to 5 decrypted screenshots of one stretch and reports what each shows: on screen, identifiers, unchanged or not, unreadable parts. Holds only `Read`, and a hook lets it open only `.png` files in a `syncopaid-screens` folder and refuses a dispatch that sets its model or effort. Judges no matter and no billing. |
| `lawyer:scrivener` | `/issue-invoice` Step 4 | Writes the body of the trust-transfer email to accounting. |
| `lawyer:delivery-checker` | `/issue-invoice`, "When it went out" | Checks whether the invoice was sent and delivered before anyone asks. |

Every screenshot a model reads goes to `timekeeper:screenshot-reader`. Apart from it, `/bill`, `/timecamping` and `/vet-billable-time` dispatch no custom agent.

### Data stores

| Store | Holds |
|---|---|
| The bill record (time-pipeline store, namespace `bill`) | Where each bill stands: its state, its last signed invoice, one row per finished step. A fresh session resumes from it. |
| The time-review database (`timecamping.db`, one per practitioner) | Each day's evidence from seven sources, the fetch log the gate reads, proposals, and the practitioner's answers. |
| The review-date records (time-pipeline store, namespace `item`, one per date) | Which dates have been reviewed, and which a run holds now. `/bill` exports the judged ones to `<matter-data folder>\timecamping\judged-dates.export.jsonl` for the tie-out. |
| The practice database | Invoices, rates, time entries, firm profile, trust. |
| TimeCamp | The system of record for time entries. Each entry has exactly one task. |

## 3. The process, step by step

### Step 1: Identify the matter

`/bill` takes the matter number from the folder name and the client number from `/matter-data`'s profile. A matter never set up is set up first. Then it reads the bill record. A bill already under way is resumed (see "Resuming" below). Otherwise a new bill starts.

### Step 2: Look up the last invoice in the records

`/bill` reads the matter's recorded invoices from `/practice-data` first, because file names are not trusted on their own. It then hashes every file in `2. SOLICITOR CLIENT` and notes any signed invoice newer than the latest recorded one.

### Step 3: Find the last invoice

The latest recorded invoice is the most recently sent bill, unless the records hold none or the folder holds a newer signed invoice. Then the newest invoice in the folder is read and verified as Steps 4 and 5 do.

**Human:** only when it is still unclear which file is the last signed invoice, the practitioner is asked that one question.

### Step 4: Read the last billed date

`/bill` reads the invoice PDF itself, scanned pages from images. It reads the exact latest date with billed time from the bar chart or itemized list, never rounding to the invoice date. It records each billed date with its hours. An invoice with no service dates uses its invoice date, and the practitioner is told that is an assumption.

### Step 5: Cross-check the records

`/practice-data`'s invoice history is compared with what is on disk. Where they differ, each candidate invoice PDF is opened to confirm the signature and the invoice number printed inside it. The verified invoices are then imported. Amount paid is left blank unless the document proves it.

The bill record is created here, because a bill is identified by its last signed invoice.

### Step 6.1: Candidate dates (`/triage-billing-dates`)

This narrows the unbilled period to the days with any indicator of work on the matter. For L145, 168 days became 97 candidate dates.

1. **The service list:** every party, counsel, staff member and witness, with their email addresses and phone numbers.
2. **The sources,** fastest first:
   - the drafts folder and other matter folders (documents dated by file name and internal metadata, never by modified date)
   - sent mail, deduplicated by Message-ID
   - calls in the carrier's call archive, matched to the service list
   - court filings
   - the calendar
   - TimeCamp entries on the matter's task, for all users
   - a phone-number scan of every TimeCamp window title, which runs on every run
   - the background helper's keyword scan of computer activity
   - SyncoPaid captures, only when SyncoPaid's evidence access is on. **Review point:** any screenshot is viewed by `timekeeper:screenshot-reader`.
3. **Reconcile with the last bill:**
   - a date the bill already covers is dropped, unless the evidence shows more work than was billed ("under-billed")
   - if the bill is over three months old, earlier dates are written off without review
   - otherwise a date before the last billed date that the bill missed is kept and flagged "suspicious"
4. **Save:** the list goes to `BILLING\YYYY-MM-DD Candidate dates.md`. Each date has a strength (Strong, Medium or Weak) and a Lawyer, Staff or Both label. The evidence behind each date goes to the evidence store.

**Human:** saving a newly found phone number to a contact waits for the practitioner's yes.

### Step 6.2: Review each day (`/timecamping`)

In Cowork, the bill stops here, because the screen captures can be read only on the PC. Elsewhere, `/timecamping` takes the Strong dates, then the Medium dates, each oldest first. Each date is claimed first: a date already judged, or held by another run, is skipped, and a Staff-only date is not reviewed.

For each date:

1. **Fetch** the day's evidence from seven sources through `/build-timeline`: TimeCamp entries, TimeCamp computer activity, SyncoPaid screen captures, the call archive, Google Calendar, the iCloud calendar and sent mail. **Human:** a fetch that replaces stored rows waits for a pasted approval.
2. **The evidence gate.** The day's evidence can be read only through one sanctioned query. That query returns nothing but a violation line if any registered source lacks a final status for the day. This is enforced by the database query, not by an instruction to the model.
3. **Read the whole day,** for every client. Lines from different sources stay separate, never merged.
4. **Group and propose.** Each block of time gets a proposed matter and note, by the named presumptions (P1 to P10) and the evidence doctrine. **Review point:** before any block resting on screen captures is proposed, the session decrypts its first, middle and last captures (more where the window title changes matter) and `timekeeper:screenshot-reader` views them. The proposal records the viewed capture ids. A block of client work that no entry covers is flagged as **uncovered**: possible unbilled time.
5. **Decide.** A grid sorts each proposal:
   - a silent commit, where the evidence names the matter outright, or
   - a question to the practitioner, where it rests on a leap, indirect evidence (a calendar entry, TimeCamp's own label) or a conflict.

   **Human:** every question is the practitioner's to answer, under `/show-me`. **Presentation point:** the practitioner sees the block's actual screenshots and those around it, and any capture that failed to decrypt is named as a gap.
6. **Write back, dry run first.** A report lists every change ready for TimeCamp. **Human:** nothing is written until the practitioner says to commit. Then each entry is written one at a time, and each is re-read to confirm it. Locked (invoiced) entries are skipped.
7. **Mark the date judged** only when no proposal is pending and every entry's write-back has been answered.

At the end, `/timecamping` returns the possible unbilled time list, each date left without a mark and why, and the offer of the Weak dates. **Human:** the Weak dates are reviewed only on a yes.

### Step 6.3: Uncovered time

**Human:** for each possible unbilled block, the practitioner either enters the time in TimeCamp by hand or leaves it for an estimate. The session never creates a TimeCamp entry.

### Step 6.4: Vet the lines (`/vet-billable-time`)

1. **Pull** the matter's billable TimeCamp entries since the last billed date.
2. **First tie-out** (`tie_out.py pull`, described in section 4). An unjudged date goes back to `/timecamping`.
3. **Join** each entry to its review decision. An entry with none is flagged "no evidence", which includes every staff entry. Non-billable window patterns the practitioner ruled on before are matched and proposed as write-offs.
4. **Rates, initials and firm rules** come from the practice database, or from the retainer letter. **Human:** a missing rate, missing initials, and whether clerical staff work is billed are each asked once.
5. **Vet each line, one at a time. Human:** the practitioner confirms, corrects or writes off every line. A "no evidence" line bills only with the practitioner's confirmation and an estimate. Each answer is saved before the next line is shown.
6. **Flags from the candidate list. Human:**
   - each under-billed or suspicious date: bill it as a late line, or write it off
   - each Strong or Medium date with no TimeCamp time, each uncovered block, and each phone call found off the matter's task: approve, correct or write off a proposed estimate, or enter the time by hand
7. **Final tie-out** (`tie_out.py final`). On a pass it writes the billable time summary and audit file to `BILLING`, plus `invoice_lines.json`, the line map and the time entries.
8. **Record the time entries** in the practice database.

### Step 7: The chart

If the last signed invoice had a time-entry bar chart, or the practitioner asks for one, a chart is built from `invoice_lines.json` only.

### Step 8: Render the draft

**Human:** the practitioner chooses Word or PDF.
- **Template:** if the firm has no invoice template yet, one is built from the registered letterhead and the last invoice's closing wording. **Human:** the practitioner corrects it in Word and approves saving it.
- **Invoice details:** the addressee, Re lines and salutation come from the last signed invoice. The invoice date is today. The bill number stays `DRAFT`.
- **Taxes:** each rate is worked out from the last invoice and shown to the practitioner once.
- **Trust:** the trust balance is stated if the last invoice stated trust applied. Nothing moves.
- **Disbursements:** `collect_disbursements.py` collects receipts and Court Services Online sheets from the day after the last billed date to today, counting each fee once. **Human:** every flagged line, undecided tax status, unread file and out-of-period item is shown, and the practitioner decides each one. Probanda never guesses a tax status.
- **Render:** `render_invoice.py` recomputes every amount and refuses anything that does not tie (section 4).

### Step 9: Ready for signature

The draft, the summary and the audit file are presented, with the summary's gaps section in full. **Human:** the practitioner says whether the draft is ready for signature. That yes **closes the billing period** at once: new work goes to the next bill. **Human:** the bill number comes from accounting, and Probanda never assigns one. The unmarked copy is then rendered. **Human:** only the lawyer signs.

### After signature: `/issue-invoice`

**Human:** this runs only on the practitioner's word that the invoice is signed.
1. **Read** the signed PDF: confirm the signature, and take the figures from the document.
2. **Freeze** the record (`freeze_invoice.py`). A total that differs from the vetted time stops it.
3. **Issue** it in the practice database, which locks the records. **Human:** this is one-way, so it needs the practitioner's approval. The bill record moves to "Issued".
4. **Trust:** if trust is applied, `lawyer:scrivener` drafts an unsent email to accounting. **Human:** the practitioner names the recipient and sends it.
5. **Delivery:** later, `lawyer:delivery-checker` checks whether the invoice went out before the practitioner is asked. A correction after issue is recorded as an adjustment, never an edit.

### Resuming, reopening and starting over

- **Resuming:** a fresh session re-tests Steps 2 to 5 cheaply, by hashing the recorded invoice and looking for a newer signed one. Steps 6 to 9 always run again.
- **Reopening:** a bill waiting for signature can be reopened on the practitioner's request, with a reason. The unmarked copy is then superseded.
- **Starting over:** this needs the practitioner's confirmation. It keeps the evidence, the review decisions and TimeCamp changes, and asks everything else afresh.

## 4. How the process makes sure all the work is billed

Each guard below names what enforces it. A script check refuses outright; a skill rule depends on the model following it.

| # | Guard | What it catches | Enforced by |
|---|---|---|---|
| 1 | The start of the period is read from the signed invoice itself, then hash-checked on every resume | Starting from the wrong invoice, or from a rounded date | Skill rule; hash test |
| 2 | Candidate dates come from up to nine independent sources, not from TimeCamp alone | A day of work TimeCamp never recorded under the matter | Skill rule |
| 3 | Reconciliation against the last bill: "under-billed" and "suspicious" flags | Work the last bill missed or under-counted | Skill rule |
| 4 | Each date's whole day is reviewed, for every client | Matter time sitting in another client's entry, or in a review queue. On L145's 30 reviewed dates this was up to 44% of the matter's time. | Skill rule |
| 5 | The evidence gate: no reading until all seven sources report for the day | A judgment made on partial evidence | **Database query** |
| 6 | Uncovered time is listed for hand entry or an estimate | Work with no TimeCamp entry at all | Skill rule |
| 7 | Write-back puts each corrected entry on the right task, one at a time with a re-read | The bill pulls only the matter's own task, so a judgment not written back is not billed | Skill rule; re-read |
| 8 | First tie-out: entries are inside the period, tie to TimeCamp's own count and hours, and every Strong and Medium non-staff date is judged | Missing or stray entries, and unreviewed dates | **`tie_out.py pull`** |
| 9 | One line per entry, each billed line with evidence or a confirmed estimate, and every write-off with a reason | An entry silently dropped, or billed without support | **`tie_out.py final`** |
| 10 | Coverage: every Strong and Medium candidate date is billed, written off or listed unexplained, with a reason | A candidate day that simply vanished | **`tie_out.py final`** |
| 11 | Run scope: evidence fetched during this run stays on this matter's dates | A stray fetch that pads the bill | **`tie_out.py final`** |
| 12 | Accuracy: the draft's fees must be within 80% to 120% of a "perfect-tracking" total built from what each line's evidence supports | A bill far above or below what the evidence shows | **`tie_out.py final`** |
| 13 | The renderer recomputes every amount, and refuses lines without a pass stamp, a line with no evidence or estimate basis, an undecided disbursement, or an old dollar figure in the template wording | A figure that does not tie reaching the page | **`render_invoice.py`** |
| 14 | Disbursements are counted once each across receipts and court sheets, with every doubtful fee flagged rather than dropped | A missed or double-counted fee | **`collect_disbursements.py`** |
| 15 | The yes at Step 9 closes the period, and issue locks the records | Work billed twice across two bills | Bill record; practice database lock |

## 5. Where completeness is not guaranteed

These are facts about the current build, not proposals.

- **The judged mark is per matter.** A day reviewed in full for one matter counts as unreviewed for every other matter, so the same day can be reviewed again for each matter billed.
- **A judgment counts only once it reaches TimeCamp.** If an approved move is never written back, the bill misses that time, or bills time that belongs elsewhere. On L145, 4.19 h judged as L145 still sit on other tasks, and 2.56 h judged as other matters still sit on L145.
- **A re-run of a day replaces earlier decisions** for that day that have not been written back, for every matter.
- **Staff time is never reviewed day by day.** Staff lines are vetted from their notes and the surrounding evidence.
- **Weak dates are reviewed only on request.**
- **Sources have limits.** Sent mail before its `copy_from` date cannot be searched. The call archive covers only the carrier on file (L145: calls after 31 August show only through window titles). Received mail with no reply is checked only when the practitioner asks for a thorough list.
- **Days outside the candidate list are never reviewed.** A day with work but no indicator in any source cannot become a candidate.
- **The 80% to 120% accuracy check** compares the bill with its own evidence. It cannot see work no source recorded.

## 6. Every point where the practitioner acts

| Where | What the practitioner does |
|---|---|
| Start | Types `/bill`. Chooses which bill to continue, if two are live. |
| Step 3 | Says which file is the last signed invoice, only if asked. |
| Step 6.1 | Approves saving a new phone number to a contact. |
| Step 6.2 | Pastes approval for a replacing evidence write. Answers each day's questions. Says "commit". Gives a yes per TimeCamp change. Accepts or declines the Weak dates. |
| Step 6.3 | Enters uncovered time by hand, or leaves it for an estimate. |
| Step 6.4 | Supplies any missing rate, initials and clerical-billing rule. Confirms, corrects or writes off every line. Rules on under-billed and suspicious dates and on each estimate. |
| Step 8 | Chooses Word or PDF. Corrects and approves the template, and the firm style if absent. Sees the tax rates. Decides every flagged disbursement. |
| Step 9 | Says the draft is ready for signature. Gives the bill number from accounting. |
| Signature | The lawyer signs. |
| `/issue-invoice` | Says the invoice is signed. Approves issuing it. Names the trust email's recipient and sends it. Reports accounting's confirmation. |
| Any time | Asks for a reopen, with a reason, or confirms a start-over. |

## Sources

`plugins/lawyer/skills/bill/SKILL.md` and its `scripts/` (`render_invoice.py`, `collect_disbursements.py`, `freeze_invoice.py`, `build_invoice_template.py`) and `references/chart.md`; `plugins/lawyer/skills/issue-invoice/SKILL.md`; `plugins/timekeeper/skills/triage-billing-dates/SKILL.md`; `plugins/timekeeper/skills/timecamping/SKILL.md` and `reference/inference.md`; `plugins/timekeeper/skills/timecamping-data/SKILL.md`; `plugins/timekeeper/skills/vet-billable-time/SKILL.md` and `scripts/tie_out.py`; `plugins/timekeeper/skills/build-timeline/SKILL.md` (Step 4); `plugins/timekeeper/skills/time-pipeline-data/SKILL.md` (Bulk apply). The L145 figures come from read-only queries of the time-review database on 2026-11-06.
