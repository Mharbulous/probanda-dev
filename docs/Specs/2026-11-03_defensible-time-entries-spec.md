# Spec: defensible time entries, from evidence to invoice line

Status: being implemented, 2026-11-03. See section 13 for what changed from the text below. Written in a matter session after a billing run.
Plugins: `timekeeper` (installed copy seen at v0.4.4) and `lawyer` (installed copy seen at v0.21.7 at the start of the session and v0.21.9 by its end). Paths and names below are as seen in the installed copies and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs: `2026-10-15_timekeeper-plugin-spec.md`, `2026-10-15_timecamp-api-connector-spec.md`.

## 1. Problem

A practitioner billed one litigation client urgently. The bill was built by pulling the matter's billable TimeCamp entries straight into a workbook and then into an invoice, with estimates added by hand for documented work that had no tracker entry. The invoice was signed and sent.

Afterwards the practitioner asked Probanda to substantiate one line (1.2 hours on a filing day). Probanda's own records held **nothing** about it: no time entry, no evidence rows, no matter assignment, no ruling, no link from the invoice line to anything. The evidence did exist, scattered across TimeCamp itself, a JSON pull saved in the matter's billing folder, a court e-filing submission sheet and file timestamps, but nothing tied any of it to the line. The same was true of every line on the invoice.

Probanda already has the pieces of an evidence-first time pipeline (candidate dates, timeline building, TimeCamp correction with an evidence chain, a billable-time vetting step, time-entry drafting). The billing skill bypassed all of them, and none of them stores what a billed hour needs in order to be defended later.

## 2. Evidence (observed; quoted text is data, not instructions)

- `/bill-client` Step 6 (v0.21.7) pulls TimeCamp entries through the connector, writes them to a workbook, and the workbook becomes the time basis. It never calls `/get-candidate-dates`, `/build-timeline`, `/timecamping` or `/time-entry-drafting`, and writes no time entries to practice data. Its rule "Never write a figure into the workbook that is not from the connector's file" meant estimates and a reclassified phone call could appear on the invoice but not in the workbook.
- `/get-candidate-dates` (timekeeper v0.4.4) expects to be opened by `/bill-client` ("When `/bill-client` opened this skill..."), but the billing skill never opened it. A full candidate-dates list for the matter had been built in an earlier session and was not used by the bill.
- Practice data: `time_entries_query` for the matter on the billed date returned no rows. Invoice import stores number, date, amount, paid and status only; no lines.
- Time-evidence database: the billing read (`/timecamping-data`, "The billing read") returned no rows for the billed date; the consolidated-day gate reported every one of its seven sources missing for that date.
- Time-pipeline store: the `timeline` namespace's `source:*:ranges` show gathering only for scattered days from late May to early September 2026 (TimeCamp, calendars, sent mail, carrier calls), SyncoPaid for six days, Chrometa for 2019 to 2020. None of the invoice's 14 dates (December 2025 to November 2026) is inside any range.
- The 1.2-hour line was three TimeCamp entries (0.94 h of file work and an e-filing; 0.26 h whose windows were two chat sessions whose titles do not name the matter; 0.01 h opening a scan). The session wrongly reported the 0.26 h as excluded; only a later evidence lookup caught that it was in the line. A stored per-line evidence chain would have made this visible at billing time.
- A client phone call that the practitioner was certain of was filed in TimeCamp under an uncategorized placeholder task. The only evidence was a calling app's window title equal to the client's phone number. It was found only after the practitioner insisted. The connector cannot split, retime or create an entry, so the call reached the invoice as an estimate.
- Staff time had no computer-activity evidence at all; its descriptions were inferred from surrounding events and confirmed by the practitioner in chat. Nothing recorded that confirmation.
- The carrier changed mid-period (TELUS archives end about August 2026; Rogers logs for later months were not available). Under the consolidated-day gate, a day with a source that can never be fetched can never be sorted.

## 3. Goal

### 3.1 The situation Probanda must handle reliably and efficiently

> A practitioner needs to get a bill out **now** for **one** client matter. Their time records are behind: TimeCamp is not fully sorted, some time sits under placeholder or wrong tasks, some work was never tracked at all, and some evidence sources are unavailable for part of the period. They cannot afford to sort every client's time first.
>
> Probanda triages that one matter to the dates that matter, gathers and sorts only those dates' evidence, takes the practitioner's rulings where the evidence is ambiguous, produces an invoice ready to sign, and **stores, for every invoice line, the time entries and the evidence that substantiate it**, so that months or years later the practitioner can answer "what supports this charge?" with one lookup and without re-gathering anything.

Efficiency target: the work done is proportional to the one matter's billing period, not to the practitioner's whole time history. Reliability target: no line reaches an invoice without either an evidence chain or a recorded estimate basis, and nothing stored for an issued invoice can change afterwards.

### 3.2 What "defensible" means here

For any line of an issued invoice, Probanda can produce, without re-fetching anything:

1. The time entries the line was built from, with timekeeper, date, exact tracked seconds, start and end, and the rounding and policy steps that turned them into the billed hours.
2. For each entry, the evidence rows that place that time on this matter (tracker activity, calls, calendar, sent mail, documents, filings), each with its own timestamps.
3. The practitioner's rulings on anything the evidence did not settle, in their own words, with when they gave them.
4. For an estimate, the document or event it rests on, the minutes estimated and why, and who approved it.
5. Every trim, write-off or restoration applied to the line, with its reason.
6. The line's description as it appeared on the invoice, and the rate, its source document and effective date.
7. Proof that all of the above is what existed when the invoice issued (a frozen copy with a recorded hash).

### 3.3 Non-goals

- Sorting every client's time, or a firm-wide time audit. (The pipeline must support it later, but it is not this spec's situation.)
- Stating law about billing, trust withdrawal or record retention. Any rule of that kind comes from `/legal-research` and is recorded as a firm setting, never hard-coded.
- Writing TimeCamp without the practitioner's explicit approval per entry.
- Generating invoices for other firms' formats.

## 4. Data to save

Each type below says what it is for in the defence in §3.2, and what it must hold. Field names are illustrative; the schema owner chooses the final names.

### 4.1 Evidence (per practitioner)

**A. Source evidence rows**, one family per source. Every row carries: source type, native id (the source's own id, the idempotent key), local date, start and end in UTC, the timekeeper, fetched-at, and the verbatim fields below. A row never stores another client's content beyond what the source row itself is.

| Source | Must hold |
|---|---|
| Tracker time entries (TimeCamp) | entry id, task id and task path at fetch time, tracked seconds, start, end, billable flag, locked/invoiced flag, note, last-modified |
| Tracker computer activity | application, window title, seconds, the entry id it counted toward |
| Screen captures (SyncoPaid or similar) | process, window title, capture time, reference to the image (never the bytes), OCR availability |
| Phone calls, carrier logs | number, direction (from the authoritative record), duration, result, extension, carrier, archive file it came from |
| Phone calls, calling-app windows | app, window title (a phone number), span; marked as an inferred call, with the number normalised to digits |
| Calendar events | calendar, title, start, end, all-day, attendees present, created/updated |
| Sent mail | Message-ID, folder, sent time, subject, To and Cc (never the body) |
| Received mail windows | Message-ID, received time, first evidence of opening, reply or forward time |
| Document events | path at the time, filename date, internal created/modified/last-modified-by/total-editing-time, PDF creation/modification, file hash |
| Court e-filing records | package id, submitted-by, submitted-at, document list, fees, receipt ids, file hash |
| Practitioner statements | verbatim words, when said, which date and matter they speak to (for example "I know for a fact that I called the client yesterday") |

**B. Source coverage log**, per source, per date: `fetched`, `empty`, `skipped` or **`unavailable` with a reason** (carrier changed, log past its retention window, tool not installed). A day can be sorted when every source has a terminal status; `unavailable` is terminal and is shown on every proposal and invoice line it affects.

**C. Triage list**, per matter, per billing run: date or range, strength, lawyer/staff, flags (suspicious, under-billed, inferred, unverified), the evidence that put the date on the list, and the run that produced it.

**D. Block proposals**: span, proposed matter, proposed client-readable description, evidence chain (source table plus row ids plus role), rationale, corroboration, conflicts, and status. Already present in the time-evidence database; must also allow a proposal with no tracker entry (see F).

**E. Determinations**: the practitioner's ruling on a proposal, verbatim, with time, the final matter and description, and whether it was approved, corrected, written off or rejected.

**F. Estimates**: for documented work with no tracker record. Basis (document event, filing record, sent mail, call record or practitioner statement, by row id), minutes, method (for example "document creation to PDF save"), reason, who approved and when. An estimate is a proposal with an estimate flag, so it travels the same chain to an invoice line.

**G. Non-billable markers**: window-title or application patterns the practitioner has ruled non-billable (their own software development, sessions about Probanda itself), and the ruling that created each.

### 4.2 Billing (firm-wide, multi-timekeeper)

**H. Time entries**: timekeeper, matter, date, start, end, exact tracked seconds, billed hours after rounding, the rule that rounded it, client-readable description, billable status, estimate flag, links to the proposal and determination ids and to the tracker entry ids, the invoice line it went to, and a lock set when the invoice issues.

**I. Adjustments**: trim, write-off, restoration or credit against a time entry or invoice line: amount, reason, who, when. Never an edit of the entry itself after it is locked.

**J. Billing settings**:
- Firm rules: billing increment, minimum per timekeeper per day, whether clerical staff work is billed, how non-billable markers apply, and the tax treatment of fees and of each disbursement kind.
- Rates per matter per timekeeper: the rate, effective date, and source document (the signed retainer agreement and any rate-change notice), plus a firm default rate per timekeeper.

**K. Invoices and their lines**: invoice number (from accounting), date, period, status, signed-copy path and hash, sent date, sent-copy path. Each fee line links to its time entries; each disbursement line links to its receipt or filing record (by hash, so one receipt saved twice counts once). It also records the trust application: balance before, amount applied, balance after, the instruction to accounting and its confirmation.

### 4.3 The frozen copy (per invoice, in the matter folder)

**L. Audit snapshot**, written when the invoice issues:
- a readable report, one section per line, giving everything in §3.2 for that line;
- a JSON export of exactly the evidence rows, proposals, determinations, estimates, entries and adjustments behind each line;
- the export's hash, recorded on the invoice (K).

## 5. Where it is stored

| Data | Store | Why |
|---|---|---|
| A to G (evidence, coverage, triage, proposals, rulings, estimates, markers) | **One SQLite database per practitioner**: the existing time-evidence database (`0. CASE DATA\_practice\timecamping.db`, per `/timecamping-data` Configuration, UNVERIFIED path) | The evidence is personal (screen, calls, calendar), relational (a line rests on many rows), and must keep stable row ids that proposals cite |
| H to K (time entries, adjustments, settings, invoices, lines, trust application) | **The firm practice database**, cloud-backed through Probanda's practice-records sync | These are firm records that cover several timekeepers (lawyer and staff) and several machines |
| C (readable copy) and L | **The matter's `0. DRAFT\BILLING` folder** | They travel with the client file and are read by people; L never changes after it is written |
| Ingest files and exports | **JSON Lines files**, transport only | Never the live record: no constraints, nothing joins them, they drift and multiply |

Consolidation: raw evidence currently has two homes, the time-evidence database's source tables and the time-pipeline store's `timeline` namespace (JSON strings in a key-value table). Make the time-evidence database the only home for raw evidence; keep the key-value store only for what it is still needed for, and migrate or retire its `timeline` role. Two copies of the same evidence will disagree.

Sync risk: the case-data root sits in a synced folder. A SQLite file written from two machines, or synced mid-write, can corrupt. The per-practitioner database must be written from one machine at a time; the firm records (H to K) go through the cloud-backed practice store, because the lawyer's and staff machines both write them. The frozen copy is write-once and safe in a synced folder.

Immutability: once an invoice issues, its lines, their time entries and their snapshot are locked. A later correction is an adjustment (I) or a credit on a later invoice, never an edit.

## 6. Target workflow for the situation in §3.1

1. **Triage** (`/get-candidate-dates`, to be renamed to say triage): for the one matter, list the dates since the last billed date that show work, drafts folder first, then sent mail, calls against the service list, filings and calendar. Save C. Fast first: stop once the dates are clear; thorough sources are an option, not the default.
2. **Gather** (`/build-timeline`): for the triage dates only, fetch every source and record B, including `unavailable` with its reason.
3. **Sort** (`/timecamping`): for each date, propose blocks with their evidence chains, catch calls from calling-app window titles and carrier logs, apply non-billable markers, propose estimates for documented work with no tracker entry, and take the practitioner's rulings (D, E, F). Write TimeCamp only on per-entry approval, including split and create.
4. **Vet** (`/vet-billable-time`): confirm each billable line's duration and description against the stored evidence; write the billable time summary.
5. **Record** (`/time-entry-drafting`): write H with its links; apply J's rounding and minimums, recording each as I.
6. **Bill** (`/bill-client`): build the invoice only from H, with rates from J, disbursements from receipts, tax treatment from J and the trust position; write K; produce the signing copy from the firm's invoice template. Refuse a line with no evidence chain unless it is a recorded estimate.
7. **Issue**: on the practitioner's word that it is signed, lock H, I and K, write L, instruct accounting on the trust application, and record the sent copy and date when it goes.
8. **Defend** (new operation): given an invoice number and a line, return §3.2's seven items from stored records only.

## 7. Required changes by component

### timekeeper
- `/get-candidate-dates`: rename to a triage name; state the urgent-one-matter situation in its description; order sources for speed (drafts folder first); hand its dates to `/build-timeline`; keep saving C in `BILLING`.
- `/build-timeline`: run for an explicit date list for one matter; support historical dates (carrier archives, older sent-mail folders); write `unavailable` with reason as a terminal coverage status.
- `/timecamping`: estimates as proposals (F); calling-app window titles matched against service-list numbers as call evidence; non-billable markers (G); practitioner statements as evidence rows; staff time with no activity evidence handled by surrounding-event inference plus a recorded confirmation.
- TimeCamp connector: split, retime and create entries behind per-entry approval; activity reads filtered by entry, task or time window (one day's unfiltered activity read was about 785,000 characters).
- `/vet-billable-time`: the required gate before `/bill-client`; writes the per-line mapping that L is built from.
- `/time-entry-drafting`: writes H with proposal, determination, tracker and estimate links.
- `/timecamping-data`: schema additions for A (new source families: document events, filing records, practitioner statements, calling-app calls), B's `unavailable`, F, G; the consolidation in §5.

### lawyer
- `/bill-client`: replace Step 6's raw pull with steps 1 to 5 of §6 for any undecided dates; build lines from H only; write K and L; template-based invoice; trust-application instruction to accounting; record sent.
- `/practice-data`: add H's links and lock, I, J (including rates with source documents and firm defaults), K's lines and trust application; a read that returns §3.2 for a line (the defend operation).
- `/invoice-reviewing`: before signing, check that every line has evidence or an estimate basis and that hours tie to H.
- Firm assets: an invoice template and a firm style guide stored beside the letterhead.

## 8. Constraints that must still hold

- Sources are read-only, except TimeCamp writes on per-entry approval. Nothing deletes evidence.
- Inference waits for evidence assembly (the consolidated-day gate), with `unavailable` as an honest terminal state, never a silent skip.
- No deadline is computed or stated by these skills; the trust-withdrawal and retention rules come from `/legal-research` and are stored as settings.
- No mail body, document text or screenshot bytes are copied into the billing records; evidence rows hold metadata and references, as today.
- Staff time is labelled as staff time; a staff description is never presented as the lawyer's work.
- The practitioner never sees a table, field, tool or internal name; the defend output is in plain words.
- No client content in tests, logs or this spec; fixtures are invented.

## 9. Options considered (streamline first, additions last; one recommended)

1. **Recommended.** Route `/bill-client` through the existing timekeeper pipeline for the triage dates only, extend the existing time-evidence database and practice database as in §4 and §5, and add the frozen copy. Mostly wiring and schema additions; no new store.
2. Keep the raw-TimeCamp billing path and attach the frozen copy only (pull, snapshot, bill). Cheap, and it would have answered the 1.2-hour question with TimeCamp data, but it stores no rulings, misses misfiled calls and untracked work, and leaves estimates without a basis.
3. A new dedicated billing-evidence database per matter. Rejected: duplicates evidence that is per-practitioner by nature, and a matter-level store cannot hold cross-matter rulings such as non-billable markers.

## 10. Implementation plan

1. Verify every UNVERIFIED path and behaviour in this spec against HEAD; append a verification table.
2. Schema: add §4.1 additions to the time-evidence database and §4.2 additions to the practice database, as additive migrations; regenerate the canonical schema files.
3. Consolidate raw evidence into the time-evidence database (§5); migrate existing `timeline` rows; keep reads working during the move.
4. Timekeeper skill changes in §7, behind the existing approval rules.
5. TimeCamp connector split, retime and create, and filtered activity reads.
6. Billing skill changes in §7; invoice template; trust-application instruction; sent recording.
7. The defend operation and its plain-language output.
8. Tests with invented fixtures (§11). Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of defensible time entries complete!`, then what you streamlined, what you verified and what you assumed without verifying.

## 11. Implementation criteria

1. For an issued invoice in a fixture, the defend operation returns, for every fee line, at least one time entry and either an evidence chain or an estimate basis, plus rate source, description and adjustments, with no network call.
2. `/bill-client` refuses to place a fee line that has neither an evidence chain nor a recorded estimate basis, and says which line and why in plain words.
3. A fixture day with one source `unavailable` can be sorted; every proposal and line built from it shows the unavailable source and its reason.
4. A calling-app window whose title equals a service-list number, inside an entry on another task, produces a call proposal on the matter.
5. A window matching a non-billable marker inside a matter entry is excluded from billed time, and the exclusion appears as an adjustment with its marker.
6. After issue, any attempt to edit a locked time entry or invoice line fails; a correction is recorded as an adjustment.
7. The frozen JSON export's hash, recomputed, matches the hash stored on the invoice; the readable report covers every line.
8. One receipt saved under two names produces one disbursement line.
9. A billing run for one matter fetches evidence only for that matter's triage dates (measured by the coverage log), not for the whole period.
10. Re-running the billing run before issue changes nothing that was already approved and creates no duplicate proposals.

## 12. Open questions for the practitioner

1. The firm's billing increment, minimum per timekeeper per day, and whether clerical staff work is billed (§4.2 J).
2. Which window-title patterns are always non-billable (§4.1 G).
3. Whether the trust-application instruction to accounting is an email, a form, or a record in the practice database only.
4. How long the frozen copies must be kept, and whether they belong in the client file (to be answered through `/legal-research`, not assumed).

## 13. Verification against HEAD, and decisions (2026-11-03)

Read against a52974ff and the working tree. "Refuted" means the code says otherwise.

| Spec | Finding | Evidence |
|---|---|---|
| §2, §7 `/bill-client` Step 6 is a raw pull | Stale. Step 6 runs candidate dates, `/timecamping` and `/vet-billable-time` since df131b34. It still records no time entries | `.claude/skills/bill-client/SKILL.md` Step 6 |
| §5 H to K are cloud-backed, which solves two machines | Refuted. The cloud holds kinds, states, tags, links and keyed hashes, and sync returns no clear values. H to K are written from the billing machine only. `practice.db` sits in the same synced folder, with the same risk as any SQLite file | `source/lawyer/mcp/src/practice/store.ts`, `cloud/items/README.md` |
| §5 merge `timeline` into the time-evidence database | Dropped (decision 1). It would deepen reliance on the Commandments' Exception, break `/time-sorting` and need a table for the Chrometa rows | The Exception, `.claude/skills/time-sorting/SKILL.md` |
| §6.2 a separate Gather step | Dropped. `/timecamping` already invokes `/build-timeline` per date, and a re-fetch asks for a pasted approval | `.claude/skills/timecamping/reference/sources.md` |
| §6.5, §7 `/time-entry-drafting` writes H | Changed. `/vet-billable-time` writes H. Drafting is off this path by the 2026-11-02 decision, and it reads `timesort`, not proposals | `.claude/skills/time-entry-drafting/SKILL.md` |
| §4.1 D allow a proposal with no tracker entry | Already allowed. The billing read joins from entries, so such a proposal never returned | `.claude/skills/timecamping-data/SKILL.md` |
| §2 an unfetchable source can never be sorted | Overstated. `skipped` releases the gate today; `failed` does not | `splice.sql` gate |
| §7 connector split, retime and create | Dropped (decision 2). The write format is unverified and hand entry stays | `source/lawyer/mcp/src/timecamp/tools.ts` |
| §7 firm style guide | Not built. Nothing would read it | |
| §5 database path | Confirmed | `source/lawyer/mcp/src/timecamping/backend.ts` |

**Decisions by the practitioner, 2026-11-03:**

1. New evidence kinds go in an `evidence` namespace of the generic `time_pipeline.db`. No schema change. `unavailable` is the `skipped` status with `error_detail` starting `unavailable: <reason>`.
2. The connector gains filtered reads only. No split, retime or create.
3. `/bill-client` stops at the unsigned draft. A typed `/issue-invoice` locks, freezes and saves a draft email to accounting.
4. Documented work with no tracker time gets a proposed estimate, held for approval. The practitioner may approve, correct or write it off, or enter the time by hand instead.

**Changes made while building:**

- K is first written at issue, in the one write that locks H, not as a draft. A draft invoice record would move the matter's billing cutoff before anything was billed.
- An invoice's lock state reads as `issue_state`, because its data already has a payment `status`. After issue, payment and sending can still be recorded; the billed figures cannot change.
- The rounding rule is stored on the invoice line, because rounding applies to a person's day and not to one entry. A person-day under the minimum and each approved exclusion are adjustments (I).
- The evidence for each line travels in `line_map.json` and is frozen with it, so `lawyer` reads a file and names no timekeeper tool.
- Spec 2026-11-03_firm-invoice-template-and-style-guide-spec.md owns the invoice template and the style guide, and 2026-11-03_cso-submission-sheet-disbursements-spec.md owns reading filing fees. `collect_disbursements.py` is the shared de-duplicator.
- Connector filtered reads and the call-log store landed separately (2142c066, 84439771).

**Criteria added to §11:**

11. A Strong candidate date with no tracker entry yields a proposed estimate line, labelled as an estimate, citing the date's evidence and held for approval. The candidate list itself is never proof of time.
12. An approved estimate reaches the invoice, and provenance (tracker or estimate) is kept per row.
13. The phone-number scan runs on every `/bill-client` run before the time basis is written. Titles are normalised to digits and matched against every service-list number, which come from case data and are never guessed. Each match reports date, start, end, entry id and task, and flags a match off the matter's task or with entry id 0. No step needs a carrier portal.
14. A window matching a non-billable marker inside a matter entry is shown as a proposed write-off with its matched seconds, for the practitioner's decision on that entry, never dropped silently. This runs at `/vet-billable-time` even on a date `/timecamping` did not judge. An approved exclusion reduces the seconds that go into the person-day total, before the under-0.1 h rule applies, and is recorded as an adjustment with its marker. Patterns live in one place that holds no client content and is read on every run.
