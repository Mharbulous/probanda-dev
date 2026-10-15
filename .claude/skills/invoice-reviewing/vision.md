# Invoice-Reviewing — Vision & Design Philosophy

**Date:** 2026-04-23

## 1. Theme & Design Philosophy

### Vision Statement

Invoice-reviewing is a read-only QA skill within CoClerk, a Claude Cowork plugin for BC litigation practice management. It reads draft invoice data and the time entries that underlie it from the shared database, then produces a structured checklist of potential billing issues — missing entries, unusual amounts, client/matter mismatches, and formatting problems — before the invoice reaches the client. It does not modify the database, generate invoices, or make collection decisions. Its sole purpose is to give the practitioner a final accuracy check at the point when a draft invoice is ready to send.

### Design Principles

**1. Read-only — never modify DB state.**
Invoice-reviewing reads time entries and invoice data; it never writes, updates, or deletes. Any skill that begins annotating records, updating status flags, or writing "reviewed" markers has violated the boundary between QA and action. The practitioner decides what to do with findings; this skill only surfaces them.

**Violation:** After flagging a time entry as likely misattributed, the skill updates the time entry's `description` to reflect the suspected correct matter. This modifies the authoritative record based on a guess, which could corrupt billing data.

**2. Surface every issue — never silently pass a draft.**
Every detected anomaly must be reported, even if the list is long. The practitioner may decide each item is intentional — but they cannot decide anything about an issue they were never shown. A clean bill of health means the skill found nothing; it does not mean the skill stopped looking after finding the first problem.

**Violation:** The skill finds five potential issues but surfaces only the two it judges most serious, deciding the others are probably fine. The practitioner sends the invoice. One of the suppressed issues turns out to be a billing error.

**3. Cite the data, not just the conclusion.**
Every flag must state which record triggered it, what value was observed, and why it is anomalous. "Unusual amount on matter 1042" is not actionable. "Time entry #447 (2.5 hrs, 2026-04-18, matter 1042) is 3× the median entry duration for this matter" is actionable.

**Violation:** The output lists "possible time entry gap between Apr 10 and Apr 18" without citing the specific entries before and after the gap, the number of days, or the matter it applies to.

**4. Warn when data is stale (Design Principle 3.6).**
If the time entry data or invoice data was last updated more than a configurable threshold ago, that staleness must be flagged before the checklist is presented. A review based on a three-week-old time entry import is not a review of the current draft.

**Violation:** The skill produces a clean checklist without mentioning that the time entry data in the DB is from an import three weeks ago. The practitioner sends the invoice, unaware that last week's entries were never imported.

**5. Show all findings, even if zero issues found.**
When no issues are detected, the skill must state that explicitly — and state which checks it performed and against which data. "No issues found" is meaningless without knowing what was checked.

### Litmus Test

**"Does this require determining whether a draft invoice accurately reflects the work performed on a matter?"**

- "Does this time entry belong on this matter?" — **Yes**, invoice-reviewing checks this
- "Is this entry duration unusual for this matter?" — **Yes**, invoice-reviewing checks this
- "Are there time entries from the billing period that weren't included?" — **Yes**, invoice-reviewing checks this
- "Does the invoice total match the sum of line items?" — **Yes**, invoice-reviewing checks this
- "Which clients have unpaid invoices?" — **No**, that is ar-follow-up
- "How much WIP is unbilled?" — **No**, that is wip-tracker
- "What is the current retainer balance?" — **No**, that is retainer-tracking
- "Should I send this invoice or follow up on the prior one first?" — **No**, that is a judgment call for the practitioner


## 2. Purpose

### Audience

A sole BC litigation practitioner preparing to send invoices to clients. The practitioner has already assembled a draft invoice in their practice management system (LEAP or similar) and wants a final accuracy check before the invoice leaves the office.

### Pain Points

**Pre-send errors go uncaught.** Invoices assembled from time entries accumulated over weeks are prone to quiet errors: an entry drafted under the wrong matter, a duplicate, an entry from a prior billing period that should have been caught before, or a gap where work was clearly performed but no entry was recorded. These errors are invisible during normal billing workflow and only surface when a client questions the bill — after it has already been sent.

**No systematic cross-check exists.** The practitioner can read through a draft invoice manually, but there is no structured process for checking it against the underlying time entry data in the database. The review is ad hoc and only catches what the eye happens to notice. A tool that systematically compares the draft against the record catches things a manual read-through misses.

**BC litigation invoices carry professional obligations.** Accounts rendered to clients must accurately reflect the work performed. An inflated or inaccurate invoice is not just a business problem — it can attract LSBC attention and damage the client relationship. The cost of a billing error is asymmetric: a client who receives a correct invoice notices nothing, but a client who receives a wrong invoice notices immediately.

### Value Proposition

Invoice-reviewing gives the practitioner a structured, data-driven QA pass over every draft invoice before it reaches the client. By reading the same time entries and invoice data that the billing workflow produced, it catches the class of errors that manual review misses — misattributed entries, unusual amounts, missing entries, and formatting inconsistencies — and presents them as an actionable checklist the practitioner can work through before sending.

### Killer Use Case

A practitioner is about to send a month-end invoice for a complex litigation matter. They invoke invoice-reviewing before sending. The skill surfaces that one time entry is attributed to the wrong matter number (a transposition in the file number), that there is a four-day gap with no recorded entries during a period when a hearing occurred, and that one entry's duration is 4× the median for similar entries on this matter. The practitioner corrects the attribution error, adds the missing hearing entry, and confirms the long entry was a multi-day drafting session. The corrected invoice goes out clean.


## 3. North Star

An invoice reviewed by this skill before sending should reach the client with zero billing errors attributable to missing, misattributed, or anomalous time entries. The proximate measure is: every issue surfaced by the checklist is either corrected or consciously accepted by the practitioner before the invoice is sent. The skill succeeds when the practitioner trusts the review enough to use it before every send, not just when something already feels wrong.


## 4. Non-Goals

- **Drafting or generating invoices** — invoice-reviewing checks drafts; it does not create them
- **Collection or AR follow-up** — what to do about unpaid invoices belongs to ar-follow-up
- **Trust accounting or LSBC compliance** — out of scope for the entire plugin
- **Billing rate setting or fee arrangement decisions** — practitioner judgment, not skill scope
- **Modifying time entries or invoice records** — read-only; the practitioner makes all corrections
- **Approving or sending invoices** — the skill produces a checklist; sending is a practitioner action
- **Substantive legal judgment about whether work was necessary** — the skill checks data integrity, not the merit of the work performed


## 5. Foundations

Invoice-reviewing is constitutively a read-only skill. It queries the shared SQLite database via `practice-data` — it never opens a direct connection, never writes a row, and never modifies a record. This is not a preference to be revisited per feature; a skill that writes is a different kind of skill. All state that persists between sessions — time entries, invoice records, matter assignments — is owned by the data-layer skills that wrote it. Invoice-reviewing reads that state and presents findings; it does not participate in maintaining it.

**The shared database is the source of truth, not the draft invoice as presented.** The review is meaningful precisely because it cross-checks the draft against an independent record. If invoice-reviewing were to accept the draft at face value and only check internal consistency, it would miss the entire class of errors it exists to catch — entries present in the DB but absent from the draft, or entries on the draft attributed to a matter that doesn't match the DB record.

**Invoice data enters the DB only through invoice-tracking.** Invoice-reviewing does not import, parse, or accept raw invoice files. If the invoice data is not in the shared DB, the skill must say so and tell the practitioner to run invoice-tracking first. Bypassing the data layer to parse a raw CSV directly would produce a review that is inconsistent with what every other skill sees.


## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
