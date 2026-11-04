# Call logs from any provider, with originals that can be produced

Status: goals confirmed by the practitioner in a grilling session on 2026-11-03. No design yet. This spec says what must be true and how to check it. How to build it is left to the design.

Replaces the second-provider route in `2026-11-03_call-log-store-spec.md` ("an adapter plus its own table"). That spec stays the source for the Telus archive facts and the rest of its decisions. Depends on `2026-11-03_defensible-time-entries-spec.md`, which stays the source for evidence chains and frozen invoice snapshots.

## Why

Probanda is for other lawyers too, but its call logs assume one carrier. Column layouts, date formats, file-name series and extension handling are all written for Telus, and adding a provider means changing code. FirstSetup only records the name of a tool it does not know. A lawyer on another provider has no route in without a developer.

The practitioner's own line moved from Telus to Rogers about 2026-08-31, so Probanda holds no calls after that date. A one-off Rogers fix would close the gap and teach nothing. Adding Rogers is the test of whether Probanda can take on a new provider at all.

Call records can stand behind an invoice line, so the import has to be defensible. If a client challenges a bill, the lawyer must be able to produce the original file a call came from. The documented call row does not name a source file. On 2026-11-03 the practitioner's source files sat in two sets of folders with different contents, and a set of 57 Telus zips was moved during the session, with the one zip searched for not found in either folder tree. Finding this out months later, during a dispute, may be too late to recover them.

## Goals

| # | Goal | Why it matters |
|---|---|---|
| 1 | A lawyer on any provider can bring in call logs from any file with rows and columns (CSV, Excel or zipped) without a developer | Probanda is for other lawyers too, so no provider can be a built-in assumption |
| 2 | Every call shows its provider and the path to its source file | A time claim must be defensible by showing where the record came from |
| 3 | The original can be produced whenever a call is challenged | This is the core need. Warnings and monitoring are only means to it |
| 4 | Billing shows calls logged through the bill date, or names the missing dates | A date with no coverage must never look like a day with no calls |
| 5 | Probanda warns before calls age out of a provider's history | A call the provider no longer keeps cannot be recovered |

The most demanding use is evidence behind an invoice. Proof outside billing, such as an affidavit, is not a target.

## Rules decided by the practitioner

**First use of a format.** The lawyer checks about 10 calls as Probanda read them, once per format. Later files load without asking. A file that does not fit the approved format stops and asks. The check exists because a misreading can raise no error: the Rogers export writes `11/03/2026` for 3 November, the earliest Telus files write dates day first, and one forwarded call takes two Rogers rows.

**An unusable file.** The lawyer gets a plain "no" and what to try next. A partial import that looks complete is never acceptable.

**What is monitored.** A finished file at a path is monitored. Anything else keeps only a reference: a Message-ID for email, a record id and the fetched copy for TimeCamp and calendars, and a path with no monitoring for a draft that is expected to change. The practitioner's test is whether a person would normally find the source by file path.

**A moved file.** If its contents are unchanged and it can be found, Probanda updates its record and shows no message. The change is available when someone asks.

**A changed or missing file that cannot be corrected.**

- Monitoring has no time limit.
- Within 3 years of the bill date, or of the call date if the call was never billed, Probanda warns.
- After 3 years it warns only if the matter's case data confirms an outstanding fee dispute. A dispute ends with a release or the exhaustion of appeal rights.
- If the case data is silent, the matter has none, or the call matches no matter, Probanda stays silent.
- The database entry date never starts the 3 years, because a bulk import would restart the clock on old calls.

**Fee disputes.** Probanda reads them from the matter's case data, and looks only when an old file has actually gone missing. The lawyer keeps no separate dispute record.

**Warnings.** One event produces one warning, however many files it affects.

**Up to date.** In billing, this means calls are logged through the date of the bill. It does not mean through yesterday every morning.

**Lookups.** Lookups by date, matter and number work the same for every provider's calls.

## Success criteria

Each can be checked by the practitioner.

1. In a fresh session using only what an installed user has, with no change to Probanda's code, Probanda loads `2026-11-03_15-40-23_CallDetails.csv` (312 rows, 2026-09-05 to 2026-11-03). The practitioner checks about 10 calls and approves. Each forwarded call counts once.
2. Telus still works: all 2,084 calls are present, and billing lookups return the same results as before.
3. Any Rogers or Telus call within the 3-year period shows its provider and the path of a file that exists.
4. Moving a source file updates the record with no message.
5. Deleting a guarded file produces one warning. Deleting a whole folder also produces one.
6. Deleting a file past the 3 years stays silent, unless the matter's case data shows a dispute, and then it warns.
7. Giving it a PDF produces a plain "no" with what to try next, and imports nothing.
8. Starting a bill shows calls logged through the bill date, or names the missing dates.

If anyone has to change Probanda's code to get criterion 1 to pass, the test has failed.

## Constraints

- **Messages are priced at scale.** Every message a protocol can produce must be justified across every file and every process, never as one event. "A single needless message" does not exist.
- **Nothing from the practitioner's practice ships publicly.** The public version carries no Telus or Rogers setup, because samples blur the line between the app and one practice and raise the risk of disclosing client information. General know-how, such as date order and one call taking two rows, may ship. Telus keeps working on the practitioner's own machine.
- **Commandments 3, 5, 7 and the Exception.** Client information stays on the User's Machine. Probanda reads and may copy a lawyer's source files, and never changes or moves them. The design must show how its local storage obeys Commandment 5, and must not rely on the Exception more than Probanda does now.
- **No prompt-injection shape.** A warning must never depend on non-user text telling the model to act (context-engineering rule 19).
- **Layering.** `timekeeper` may name only `lawyer`, which holds the case data the dispute check reads.

## Non-goals

- PDF statements, for now.
- Monitoring email, TimeCamp, calendars or drafts.
- Other file sources such as e-filing receipts and finished documents. They come later under the same rule, as separate changes.
- Automatic daily delivery of call logs.
- The 2019 to 2021 Rogers usage files and iPhone logs as required history, unless a noted fee dispute reaches them.
- Any billing run, which is context for this work and not part of it.

## Known limits, accepted

- Passing on Rogers alone tests one new format, so it cannot prove a third would work.
- Other file sources stay unprotected until they are added.
- After 3 years, a dispute that is not in the case data gets no warning.
- A disappearing email or TimeCamp entry goes unnoticed until someone looks it up.

## Assumptions, confirmed by the practitioner

- A wrongly imported call costs a correction or a refund, not a regulatory problem.
- The 3-year period is the same for every lawyer. Other jurisdictions might need a different one.
- The 3-year rule sets how far back existing Telus calls must link to their zips. Older calls may link too, but it is not required.

## Open for the design

- **Linking a call to a bill.** The 3 years run from the bill that relied on the call. `.claude/skills/practice-data/scripts/defend_line.py` answers from a frozen snapshot of an issued invoice, so that link may exist only for invoices issued since snapshots began. A billed call with no recorded link would look never billed, and its 3 years would run from the call date, which ends the warnings early. This was not put to the practitioner.
- **Calls with no known history limit.** Goal 5 can fire only when the provider's limit is known. Whether a limit is known, and from where, is unsettled.
- **When a warning reaches the lawyer.** The practitioner asked to hear quickly, while recovery is possible. Probanda runs only inside a session, so the design must say what triggers the check.
- **Existing readers of provider names.** `telus_calls` appears in the schema, `references/splice.sql`, `references/backfill.sql`, the assembly gate, the source registry, `source/lawyer/mcp/src/timecamping/calls.ts` and `defend_line.py`. Goal 1 needs these to stop depending on one provider. A database rename or removal of a tool's inputs would make the release a minor one under the version rule in `CLAUDE.md`.
- **The calls tool.** `timecamping_data__calls` is in the source but was absent from the installed tools in the 2026-11-03 session. The cause was not checked.

## Facts still unknown

- Whether Rogers limits how far back an export can go. The export starts about 60 days before the day it was downloaded, and the line moved about 5 days earlier than that start.
- Where the 57 moved Telus zips went. Their names do not match the 235 zips in the main archive, so they may be the only copies. This affects goal 3 for those calls.

Not checked: whether stored call rows record a source file in the database itself. The statement above comes from the row contract in `.claude/skills/build-timeline/reference/TelusConnect.md`.
