# Pre-filing consistency checks

Owned by `/drafting-data`. Run by `drafting_forms__pre_filing_check({ db_path, filing_id, package_dir })` — deterministic, read-only, no model call in its path — and consumed by `/draft` step 9, which presents the results and records the outcome on the gate job (`.claude/skills/drafting-data/SKILL.md` "Job and scrutiny operations" §14). Origin: the L8212 Claimant Opening Submissions package, 2026-09-14, where the exhibit cross-check was done by hand and a signed witness statement was found still carrying template placeholders ([#615](https://github.com/Mharbulous/CoClerk/issues/615), ADR 0016).

The gate sits **beside** the Writing lifecycle (`filing-checklists.md` §11), not inside it: no lifecycle state, no CHECK constraint. It is a precondition to the drafting → filed write of `filings.filed_on`, enforced by prose in `/draft`. **The gate reports; it never edits a document** (decision D4). A finding is fixed by a job the practitioner outlines, or waived with a one-line reason (§14).

## 0. What the tool reads

- **`package_dir`** — the folder holding the assembled package as it will go out: the written argument, every witness statement or affidavit (signed copies where they exist), the Index of Exhibits, and one file per exhibit named `Exhibit N - <description>.<ext>`. For a VanIAC round this is the mockup folder's `Package` subfolder (`<draft folder>\SUB <filing folder>\Package\`, where `/publish` with `publish-vaniac-package` and `/assemble` with `assemble-vaniac-package` write the package, whose index file is `Index.docx`), never the mockup folder itself, which also holds the Job Board; for a BSCS or BCCA kind it is the folder holding the court-ready documents step 8 produced. The folder must be an absolute path beneath the matter's `0. DRAFT*` folder and never inside a `privileged` or `disclosed` tree; the tool refuses anything else.
- **The Index of Exhibits** — the Writing's own `filing_documents` rows (every role but `witness_statement`), numbered in ordinal order exactly as the Evidence Index renders them. The index document in the package (`Index.docx` for VanIAC) is a projection of those rows and is scanned as a document, not read as the index.
- **Text** — PDF pages via the host's `pypdf`; DOCX bodies via the standard library. A PDF that will not open, or a host with no `pypdf`, is a hard error naming the fix (`pip install pypdf`), never a silent pass.

Every finding carries `document`, `page`, the offending line quoted verbatim (`quote`), one sentence saying what is wrong (`problem`), the conflicting value or document where there is one (`conflict`), and `severity`. Findings are sorted by document, page and quote, so two runs on the same package return identical JSON.

## C1. Exhibit numbering cross-check

- **Scans:** every non-exhibit document in the package (a file whose name does not begin `Exhibit N`) for `Exhibit N`, `Ex. N`, `Exhibits N and M`, `Exhibits N, M and P`, `Exhibits N to M` (ranges expand), each optionally preceded by a party qualifier (`the Respondent's Exhibit 4`).
- **Pass:** every cited number has an Index row **and** an `Exhibit N - …` file; every Index row has a file; every exhibit file has an Index row — subject to the three rounds rules below.
- **Rounds (#712).** A VanIAC package numbers exhibits across the whole proceeding, so a responsive round may cite an exhibit produced in an earlier one. Three consequences:
  - A **party-qualified** citation names the other side's exhibit and is skipped: it is neither in our Index nor in our package, by design. This is only sound because the firm's convention cites our own exhibits unqualified (the firm's VanIAC citation convention, recorded by `/draft`) — qualify one of our own and it escapes the check.
  - An exhibit **already delivered** with an earlier round (`filing_documents.provenance = 'already_in_court_file'`) keeps its original number and carries an Index row, but its file is deliberately absent. It is not reported missing. An `Exhibit N - …` file for one **is** a finding: the convention cites such an exhibit rather than re-shipping it.
  - A number belonging to the **proceeding but not to this Writing's Index** gets its own wording — the defect is the missing Index row, not the missing file, and only the row is reported.
- **Evidence:** the citing line, its document and page; the Index row (`Ex. N — label`) and the file name where each exists.
- **Severity:** normal.
- **Not judged:** whether the Index row and the file *describe the same document*. The tool returns an `index` array (exhibit number, Index label, file name) beside the checks for the practitioner to read; a mechanical description match failed on real data (the Index label "Demand letter of January 5, 2024" against the file "Demand Letter for Payment of $150,000 (January 5, 2024)"), so it is shown, not scored.

## C2. Unresolved-placeholder scan

- **Scans:** every non-exhibit document. Exhibit files are evidence copies of documents as they exist — a filed pleading's own `[ ]` checkboxes are not template text this party can resolve — and are never scanned.
- **Fires on pattern, not a list.** A square-bracketed run (it may wrap a line) is a placeholder when: a `$` immediately precedes it; it is empty or only underscores, spaces, dots or dashes; it contains two or more underscores; it contains `TBD`, `TBC`, `WIP`, `DATE`, `NAME`, `AMOUNT`, `INSERT`, `PLACEHOLDER` or `to be confirmed/inserted/determined/added/filled`; or it is an all-capitals word or phrase.
- **Suppressed, because they are ordinary legal text:** `[...]` and `[…]`; `[sic]`; `[emphasis added]` / `[emphasis in original]`; `[citation omitted]`; `[In Chambers]`; a four-digit year `[1998]`; a pinpoint `[para. 33]`, `[paras. 26, 34]`, `[p. 12]`; a single letter `[A]`; a bare number `[12]`. A lower-case editorial insert such as `[the defendant]` inside a quotation is also left alone, which means a lower-case prose placeholder with none of the trigger words (`[what they actually said]`) is **not** caught — a known limit of pattern matching; the practitioner's read of the mockup remains the backstop for those.
- **Pass:** no finding.
- **Severity:** **high** when the document is signed — its file name contains `signed`, or its text carries an e-signature audit page (`Final Audit Report`, `Status: Signed`, `Document e-signed by`, `Agreement completed`, `Signature Certificate`, `DocuSign`); normal otherwise.

C3, C4 and C5 ([#624](https://github.com/Mharbulous/CoClerk/issues/624)) compare the package against values the database fixes, never text against text alone. Nothing in two documents says that two different numbers or spellings were meant to be the same fact; only a database value can. Like C2, they scan only non-exhibit documents, and a finding in a signed document (`looksSigned`, C2) is **high**.

## C3. Cross-document figure consistency

- **Anchors:** the amount of every order sought on this Writing (`filing_orders` → `order_sought.amount`, not crossed out), and the `document_date` of every Index row (ISO `YYYY-MM-DD` only).
- **Extracts:** `$` amounts (`$150,000`, `$150,000.00`, `$ 150000`), compared to the cent, and full dates only (`January 5, 2024`, `Jan. 5th 2024`, `5 January 2024`, `2024-01-05`). A bare number or year is never a figure, so a citation year (`2019 BCSC 1123`, `[2019] 3 SCR 5`) or a pinpoint (`para. 150`) cannot fire.
- **Fires on an amount** that is a one-digit typo of an anchored amount: the same number of digits in cents, with one digit changed or two neighbouring digits swapped (`$150,500` against `$150,000.00`). An amount equal to any anchor passes. An amount with a different digit count is a different figure (`$15,000` interest beside a `$150,000` claim).
- **Fires on a date** only on a line keyed to an Index row, meaning the line cites that exhibit (`Exhibit N`, as C1 reads it) or contains its Index label as whole words. The date must differ from the row's `document_date` in exactly one of day, month or year, with no date on the line matching it (`The demand letter (Exhibit 1) is dated January 6, 2024` against Ex. 1's `2024-01-05`).
- **Evidence:** the line quoted, and the anchor as `conflict` (`order_sought #N: <wording>` or `Ex. N — <label> (document_date …)`).
- **Pass:** no finding.
- **Not judged:** a conflict between two figures the database does not record, hours totals (there is no anchor for them), and a date on a line that neither cites the exhibit nor names its label (`I sent the demand on January 6, 2024`). Comparing every date near an Index date raised a finding on every chronology date in the same month, so it was rejected (practitioner's decision, 2026-09-18).

## C4. Party name and style-of-cause consistency

- **Anchors:** every `parties.name` of the Writing's proceeding, and `proceedings.file_number`.
- **Finds variants** of each party name by a loose search: company suffix either way (`Ltd`/`Limited`, `Inc`/`Incorporated`, `Corp`/`Corporation`, `Co`/`Company`), periods optional, and a word of four or more letters may drop its last letter (`Holding` for `Holdings`). It finds file-number-shaped tokens by the file number's own letters, with any digits and optional separators.
- **Pass condition:** every match equals the database value after collapsing whitespace and case (`ACME HOLDINGS LTD.` passes for `Acme Holdings Ltd.`). A trailing period is read as sentence punctuation. A file-number-shaped token counts only when its digits equal the file number's or are one digit off. Any other token is a different number (a cited `Action No. S-987654`) and is left alone.
- **Evidence:** the line quoted, `problem` naming the variant exactly as written (`party name styled "Acme Holding Limited"`, `file number styled "VANIAC-2026-0421"`), and the database value as `conflict`.
- **Not judged:** a misspelling that changes more than one letter per word, a different digit count in the file number, and a `Ltd`/`Ltd.` difference at the end of a name.

## C5. Execution completeness

- **Scans:** every non-exhibit document `looksSigned` reports (C2), plus, for each witness statement or affidavit the Writing records (`documents.instrument`), the package file whose name begins with that document's label. A recorded instrument with no such file is itself a finding.
- **Pass:** on the last page before any e-signature audit page (`Final Audit Report`, `Signature Certificate`, `Certificate Of Completion`, `Document e-signed by`, `Agreement completed` — `looksSigned`'s markers less `DocuSign`, which stamps every page's envelope header) there is a full date (as C3 reads it) and no signer label with an unfilled slot after its colon (`Signed:`, `Signature`, `Sworn`, `Affirmed`, `Name`, `Per`, as in `Name: [NAME]`). Where the database names a deponent, that name also appears on the page. The first word after every `Status:` on the audit pages reads `Completed` or `Signed`, not `Sent`, `Out`, `Pending` or anything else, and audit pages with no `Status:` at all fail. `looksSigned` counts an audit page as a sign of signing even while its status is `Sent`, which this last test covers.
- **Evidence:** the offending line quoted (the unfilled signer line, the audit `Status:` text, or the page's last line), with the page.
- **Severity:** always **high**.
- **Not judged:** whether a signature is actually present. A rule of underscores (`Per: ______`) is not read as blank, because it survives in the extracted text under a real ink or image signature. For a signed document with no deponent in the database, the signer test is therefore only the absence of an unfilled slot. A last page with no extractable text (an image-only scan) fails with that reason rather than passing unread.

## C6. Exhibit file sanity

- **Scans:** every `Exhibit N - …` file.
- **Pass:** each opens and reports a page count above zero (a DOCX counts as one page).
- **Evidence:** `files: [{ file, pages }]` per exhibit; a finding names the file and quotes the reader's error (`file is empty (0 bytes)`, an unreadable PDF, a non-document extension).
- **`package_total_pages`** is the sum of page counts over **every PDF in the package folder**, exhibits and signed statements alike — on L8212 that is 143 pages across 18 files.

## Presenting a failed check

One check per ceremony, per `/show-me`: present the offending line's document as a highlighted page extract, the finding in orange, its `document` and page in the caption, and the finding's `quote` in full in a code block with the `conflict` value stated after it where there is one, then one labelled sentence of interpretation, then one plain-text decision: fix it (the practitioner outlines a job, Branch B) or waive it with a one-line reason (`/drafting-data` §14). Describing a finding is not presenting it.
