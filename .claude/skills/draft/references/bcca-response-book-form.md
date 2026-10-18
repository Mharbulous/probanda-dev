# BCCA application and response book form requirements

Canonical reference for the form of a BC Court of Appeal chambers **application book** and **response book** (civil), and the **written argument** inside either. This is the document a renderer change is checked against: every requirement below carries a pinpoint citation, and anything uncited is marked as an inference.

Scope: BC Court of Appeal only, civil chambers stay and leave applications. Not BCSC (see `/publish` with `publish-bcsc-form`), not VanIAC.

## Contents
- 1. Instruments and currency
- 2. Why the completion instructions bind
- 3. Response book: required parts in order (e-CI §1.2)
- 4. Application book: required parts in order (e-CI §1.1)
- 5. Outer cover page: complete field set
- 6. Written argument: its own cover page, parts, and format
- 7. Table of contents: required shape
- 8. Technical and e-filing requirements
- 9. Paper filing deltas (fallback only)
- 10. Multi-party boilerplate
- 11. Mechanics affecting the book
- 12. Citation style
- 13. Sources on file

---

## 1. Instruments and currency

| Instrument | Version relied on | Currency verified |
|---|---|---|
| *Court of Appeal Rules*, B.C. Reg. 120/2022 | Consolidated to 2026-08-25; last amended by B.C. Reg. 56/2026 (2026-04-07) | 2026-08-30 |
| *Court of Appeal Act*, S.B.C. 2021, c. 6 | Current to 2026-08-25 | 2026-08-30 |
| *Interpretation Act*, R.S.B.C. 1996, c. 238 | Current to 2026-08-25 | 2026-08-30 |
| **E-filing Completion Instructions**: Application and Response Books for Leave to Appeal (Civil Rules 11 to 16) and/or Stay of Proceedings/Execution (Civil Rules 20 and 21) | Last Updated **2025-09-29** | 2026-08-30, SHA-256 match |
| **Paper Filing Completion Instructions** (same title) | Last Updated **2025-09-29** | 2026-08-30, SHA-256 match |
| **Registrar's Filing Directive** | Issued 2022-07-18, Updated **2025-09-04** | 2026-08-30, SHA-256 match |
| Practice Directive — Chambers Applications (Civil & Criminal) | Issued and effective **2026-08-04** | 2026-08-30 |
| Practice Directive — Citation of Authorities (Civil & Criminal) | Issued 2026-08-24, **effective 2026-09-08** | 2026-08-30 |
| Practice Directive — Style of Proceedings (Civil & Criminal) | 2022-09-12 | 2026-08-30 |
| Practice Directive — Publication Bans, Sealing Orders, and Anonymization Orders (Civil & Criminal) | 2024-06-10 | 2026-08-30 |
| Template `ca_book_cover_page.dotx` | Last Updated 2023-12-20 | 2026-08-30 |
| Template `written_argument_general.dotx` | Last Updated 2023-12-20 | 2026-08-30 |

**Verification method (2026-08-30).** The three PDFs held at `Engineering/bcca-response-inputs/` were re-downloaded from bccourts.ca and compared by SHA-256; all three are byte-identical to the live versions:

| Local file | SHA-256 |
|---|---|
| `ci_response_book_leave_stay_e.pdf` | `7b09f8666c865fc757f920b049f2eaee3e4b404742dc03e83b6251ab33100a89` |
| `ci_response_book_leave_stay_paper.pdf` | `5256ed112579137b4ebe3500291d00b40ef328e8e9de23edde6780b1bd1fdcf8` |
| `coa_filing_directive.pdf` | `0acdf64d571f82c5ab9cc398530f6f38b3a26b560259c228c02ae813914fb236` |

Live e-CI URL: `https://www.bccourts.ca/Court_of_Appeal/practice_and_procedure/completion_instructions/application_books/e_completion_Instructions_application_response_books_leave_stay.pdf` (paper twin at `paper_completion_instructions_application_response_books_leave_stay.pdf`). Filing Directive: `https://www.bccourts.ca/Court_of_Appeal/documents/new_rules_filing_directive_how_to_file_materials_final.pdf`. Corroborated by the court's own *Summary of Changes: Civil Court Forms, Completion Instructions and Templates* (updated 2026-04-07), which lists no completion-instruction revision after 2025-09-29.

**Re-check trigger.** Confirm currency before relying on this document for a filing more than ~3 months after 2026-08-30, and always re-check the practice-directive index — two directives bearing on this material were issued in August 2026 alone.

Citations below use "e-CI §" for the e-filing completion instructions and "paper-CI §" for the paper version. Note the paper version mis-numbers its written-argument format section as a second **§2.1** (p. 5); cite it as "paper-CI second §2.1".

---

## 2. Why the completion instructions bind

The Rules prescribe **who files, what the document is called, and when**. They prescribe almost nothing about what a book looks like — that is delegated to the registrar. The chain:

1. *Court of Appeal Act*, s. 38(1): "the registrar may issue directives respecting the filing of documents in the court's registries, including directives that specify (a) the form and manner in which documents must be filed, (b) the number of copies of a document that must be filed, and (c) **instructions for the completion of documents**."
2. s. 38(2): "The registrar **may refuse to accept a document for filing** if it is filed contrary to a directive issued under subsection (1)."
3. R. 1(1): "'completion instructions' means the instructions issued by the registrar for completion of documents".
4. R. 21(2): "A response book under this rule **must be prepared in accordance with the completion instructions**." (Same formula for the application book at R. 20(3), and for the leave response book at R. 14(2).)

A departure from the completion instructions is therefore both a directive breach (Act s. 38(2)) and, through R. 21(2), a Rules breach (R. 79(5): "The registrar may refuse to accept a document for filing if the document does not comply with these rules").

**Three differently named response books exist**, and one instruction set covers the ones relevant here:

| Vehicle | Rule |
|---|---|
| Response book (bare stay application) | R. 21(1)(a) |
| Response book for leave to appeal and stay (joined) | R. 21(1)(b) |
| Response book for leave to appeal | R. 14(1) |

The completion instructions on file are titled "…for Leave to Appeal (Civil Rules 11 to 16) **and/or** Stay of Proceedings/Execution (Civil Rules 20 and 21)", and e-CI §2.1 carries a standalone "Analysis: Stay" row for the case where "you are ONLY applying for a stay of proceedings/execution and are NOT seeking leave to appeal". One instruction set governs all three.

**Do not describe a stay response in R. 55 terms.** R. 52(2)(c) switches off Division 1 of Part 9 for stay applications, so R. 53-55 (the loose "supporting affidavits, if any / written argument, if any" model) do not apply. A stay response is a **book**, and R. 21(1) is mandatory in form ("A party who wishes to respond to a stay application **must** do one of the following"), unlike the permissive "may" in R. 55.

**No Schedule 3 form exists for any response.** Schedule 3 runs Forms 1-22 and contains no response form; Form 4 (Notice of Application) is the applicant's form. A response book is consequently not a "court form" as defined in R. 79(1), so R. 79(3)'s "with variations as the circumstances or the proceedings require" latitude does not apply to it.

---

## 3. Response book: required parts in order (e-CI §1.2)

Verbatim, in the order the instructions list them:

| # | Part | Instruction (verbatim) | Status |
|---|---|---|---|
| 1 | **Cover Page** | "Required / You may use this Word template to create your cover page / Include Sealing Order, Publication Ban, or Anonymity order (if any) referencing legislative provision (or inherent jurisdiction) that authorises the order or ban and precise terms." | **Required** |
| 2 | **Table of Contents** | "Required" | **Required** |
| 3 | **Part 1: Evidence, Exhibits or Affidavits** | "Include evidence, exhibits, or affidavits (if any) relevant to the application and not otherwise included in the application book or in the response book of any other respondent." | Required part; contents conditional |
| 4 | **Part 2: Written Argument** | "See content instructions in 2.0 / Maximum 5 pages or 10 pages" | Required part |
| 5 | **Optional: Part 3: Table of Authorities** | "A table of authorities, arranged alphabetically, including new cases and sections of enactments that have **not** been referenced in the application book." | **Optional** |
| 6 | **Optional: Book of Authorities** | "Authorities can be provided, which will be referenced in the chambers hearing. Book of Authorities completion instructions can be used to create books." | **Optional** |

("not" is bolded and underlined in the source at row 5.)

Two de-duplication rules run through this list, and they differ:

- **Part 1 excludes evidence** already in the application book **or in another respondent's response book** (e-CI §1.2). Where several respondents file separately, they must not reproduce each other's material.
- **Part 3 is a delta table**, not a full one: it lists only authorities **not** referenced in the application book. This constrains the *table* only. An authority already in the applicant's book is still cited normally in the body of the written argument; it simply does not get re-tabled.

The exclusion rule has **no analogue in the Rules**. R. 27(5) is a different exclusion (authorities on the registrar's published list, in a book of authorities on an appeal) and does not apply here. The rule rests solely on e-CI §1.2.

---

## 4. Application book: required parts in order (e-CI §1.1)

Needed both for reading the opposing party's book and for the eventual application-book renderer:

| # | Part | Instruction (verbatim) | Status |
|---|---|---|---|
| 1 | **Cover Page** | Same wording as the response book's cover-page row | **Required** |
| 2 | **Table of Contents** | "Required" | **Required** |
| 3 | **Part 1: Reasons for Judgment** | "Include a copy of the reasons for judgment you are seeking to appeal" | Required part |
| 4 | **Part 2: Order** | "Include the entered order, if available, or the form of order agreed to by counsel or the parties." | Required part |
| 5 | **Part 3: Evidence, Exhibits or Affidavits** | "Include those parts of the evidence, exhibits or affidavits necessary for the application" | Required part |
| 6 | **Part 4: Written Argument** | "See content instructions in 2.0 / Maximum 10 pages or 15 pages" | Required part |
| 7 | **Part 5: Table of Authorities** | "A table of the authorities, arranged alphabetically, including cases and sections of enactments referenced in the application book" | Required part |
| 8 | **Optional: Book of Authorities** | Same wording as the response book's row | Optional |

Two asymmetries against the response book, both load-bearing:

- The application book's table of authorities is **Part 5 and not marked optional**; the response book's is **"Optional: Part 3"**.
- The application book's table is **full** ("referenced in the application book"); the response book's is a **delta**.

---

## 5. Outer cover page: complete field set

Source: the court's own `ca_book_cover_page.dotx`, read from its OOXML (`word/document.xml`), supplemented by the practice directives noted. Fields in template order:

1. **Header** — court crest and the court name. (The shipped template's header text run is itself defective, reading " APPEAL FOR BRITISH COLUMBIA" / "FORM"; filed books produced from it reproduce that defect. Render the correct "COURT OF APPEAL FOR BRITISH COLUMBIA".)
2. **Top-right identification block**, three lines, right-aligned:
   - "COURT OF APPEAL FILE NO. [CA#####]" — template instruction: "If more than one case is being heard together: enter only the case number applicable to the party, case and court record being filed."
   - "[Name of First Appellant] vs. [Name of First Respondent]" — the short style, first-named party each side only.
   - The court record title, e.g. "Response Book".
3. **"COURT OF APPEAL"**, centred.
4. **"ON APPEAL FROM the order of [judge] of the [court or tribunal where the order being appealed was made, e.g. Supreme Court of B.C.] pronounced on the [date on which the order being appealed was made]"**.
5. **"BETWEEN:"** / appellant name(s) centred / "APPELLANT(S)" right-aligned / lower-court role right-aligned, e.g. "(Plaintiff)".
6. **"AND:"** / respondent name(s) centred / "RESPONDENT(S)" right-aligned / lower-court role, e.g. "(Defendant)".
7. **Publication Ban or Anonymity Order (if any)**: "Enter legislative provision (or inherent jurisdiction) and terms." Template step 4: "If none exist, remove placeholder in cover page template."
8. **Sealing Order (if any)**: same treatment.
9. **Court record title**, centred, e.g. "Appellant's Appeal Book" / "Respondents' Response Book", followed by the **name of the filing party** ("not required for joint books").
10. **Contact table**, two columns (appellant side | respondent side), each column carrying: party name(s); counsel name ("if any"); "[Address of the party or, if the party is represented, name and address of the party's law firm]"; "Telephone:"; "E-mail:"; and the role line, "Enter parties role e.g. Counsel for Appellant" / "Counsel for Respondent".

**Party naming.** Template step 3: "Enter appellant and respondent's names below in exactly the same order and format as the Notice of Appeal or Notice of Application for Leave to Appeal unless the Court of Appeal has ordered changes to the style of proceedings."

The Style of Proceedings PD (issued and effective 2022-09-12) governs the underlying style: "the style of proceedings for civil matters on all forms, orders, and reasons for judgment will list appellants first and respondents second", and "The roles of the parties to the appeal in the court below should still be identified in brackets (e.g. John Doe, Appellant (Defendant))." It applies to "all documents filed in civil matters on or after July 18, 2022 (including Forms, orders, appeal books etc. and amended documents)".

Its Appendix, Example 2 ("More than one respondent or appellant") supplies the grouping rule, which is **by role in the court below, not simply by appeal role**:

> "Group multiple appellants and respondents by their role in the court below (e.g. in the example Blue Green and Black Grey are grouped together as appellants who were claimants in the court below, but Pink Yellow is listed separately as an appellant who was a respondent in the court below)."
> "Do not change the order of appellants or respondents who had different roles in the court below."

So one side of an appeal can occupy **more than one BETWEEN/AND block** where its members held different roles below, each block carrying its own bracketed lower-court role, and the relative order of those blocks is preserved from the original style. A generator that assumes exactly two blocks (one appellant, one respondent) is wrong in that case. Where every party on a side shared the same role below — as in CA59991 — one block per side is correct. The Appendix also covers a single party each side (Example 1), cross appeals and multiple dockets (Example 3), and non-adversarial proceedings preserving "In the Matter of…" preliminary text (Example 4).

**Access restrictions.** The Publication Bans, Sealing Orders, and Anonymization Orders PD (issued and effective 2024-06-10):

> "If a publication ban, sealing order, or anonymization order applies in the Court of Appeal by operation of law, the parties must indicate the existence of those orders on the cover of their appeal record, statement, factum, appeal books, and other books."

"Other books" catches application and response books, which is the same requirement e-CI §1.2's cover-page row states. The directive adds two points that decide whether there is anything to render: publication bans and anonymization orders from the court below "typically endure in the Court of Appeal", so usually no fresh order is needed; **sealing orders generally do not carry over**, and a party wanting Court of Appeal materials sealed must apply to a justice in chambers. Where the court below initialized or redacted party names on a discretionary basis with no order requiring it, the Court of Appeal "will not always do the same" — an anonymization order must be sought.

**Note on the contact block's source.** R. 80(2) requires a party's address for service only on a notice of appeal and on "a form under these rules that requires the address for service be included". A response book is neither. The contact table is therefore a **template and completion-instruction requirement**, not a R. 80 requirement — but it is still required content, because e-CI §1.2 makes the cover page required and the template defines the cover page.

---

## 6. Written argument: its own cover page, parts, and format

The written argument inside a book is a self-contained document with its **own cover page**, distinct from the book's outer cover.

### 6.1 Content requirements (e-CI §2.1)

| Row | Instruction (verbatim) |
|---|---|
| **Cover Page** | "**Required** / You may use this Word template including cover page." |
| **Part 1: Facts** | "A brief statement of facts" |
| **Part 2: Issues** | "A statement of the points in issues on the application" |
| **Part 3 — Analysis: Leave to Appeal / Leave and Stay** | "On applications for leave to appeal, a brief statement setting out the reasons why leave should or should not be granted, which should include your position regarding: (a) the importance of the proposed appeal to the practice (e.g. would the appeal help settle an unsettled area of the law); (b) the importance of the proposed appeal to the action (which may include significance to the proposed parties); (c) the merits of the proposed appeal; (d) whether the proposed appeal would unduly hinder progress in the underlying action. — AND if the application for leave to appeal is joined with an application for a stay of proceedings/execution in accordance with Rule 20(4) (stay of proceedings), a brief statement setting out the reasons why the stay should or should not be granted which should include your position regarding: (e) the merits of the proposed appeal; (f) whether the applicant would suffer irreparable harm if the stay of proceedings/execution is not granted; (g) whether the inconvenience to the applicant if the stay is refused would be greater than the inconvenience to the respondent if the stay is granted." |
| **Analysis: Stay** (separate row) | "OR If you are ONLY applying for a stay of proceedings/execution and are NOT seeking leave to appeal, a brief statement setting out the reasons why the stay should or should not be granted which should include your position regarding (e) to (g) above." |
| **Part 4: Order Sought** | "The nature of the order (or orders) requested / Enter name of lawyer(s) or party(ies) who prepared the filing" |

Footnote 1 to §2.1: "Note that there is a different test for leave to appeal from a special tribunal. See *Queens Plate Development Ltd. v. Vancouver Assessor, Area 09* (1987), 16 B.C.L.R. (2d) 104, 22 C.P.C. (2d) 265 at 109−110 (Chambers) at para. 14."

**A stay-only response therefore addresses (e), (f) and (g) — not (a) to (d).**

### 6.2 Page limits (e-CI §2.1, bullets above the table)

- "Application Books: Maximum **10 pages** of written argument for leave or stay applications. Maximum **15 pages** of written argument for a combined application for leave and stay."
- "Response Books: Maximum **5 pages** of written argument for response to leave or stay application. Maximum **10 pages** of written argument for combined leave and stay response books."

The cap is expressed as "pages of written argument"; the §2.1 cover page is a separate required item listed above Part 1, so on the better reading it sits **outside** the count. (Inference, not stated expressly — flag it if a filing is close to the limit.) There is no page limit in the Rules themselves: the only rule-level caps are R. 61(4)(b) (intervener's factum, 10 pages) and R. 94 (transitional cross-appeal factums), neither applicable.

### 6.3 Format (e-CI §2.2; paper-CI second §2.1)

| Format | Requirement (verbatim) |
|---|---|
| Font | "Arial 12 (including citations)" |
| Spacing | "Lines spaced 1.5 lines apart with a single space between paragraphs (pre-set in template)" |
| Margins | "No less than 2.5 cm. (1 in)" |
| Paragraph Numbering | "Paragraphs numbered consecutively starting from Statement of Facts" |
| Footnotes | "Arial 12 (pre-set in template) / Footnotes can be single-spaced." |

Numbering runs **consecutively from the Statement of Facts through Order Sought** — one sequence across Parts 1-4, not restarting per part. The cover page and any preliminary matter are outside the sequence.

### 6.4 Written-argument cover page field set

From `written_argument_general.dotx` (OOXML), in template order:

1. Top-right block: "COURT OF APPEAL FILE NO. [CA#####]"; "[Name of First Appellant vs. Name of First Respondent]"; "Memorandum of Argument".
2. "COURT OF APPEAL", centred.
3. "BETWEEN:" / appellant name(s) / "APPELLANT(S)" / lower-court role; "AND:" / respondent name(s) / "RESPONDENT(S)" / lower-court role — same shape as the outer cover.
4. Publication ban / sealing order placeholders, same treatment as the outer cover.
5. Centred title: "[Enter MEMORANDUM OF ARGUMENT ON AN APPLICATION FOR …]" followed by the name of the filing party.
6. Body: Part 1: Facts / Part 2: Issues / Part 3: Analysis / Part 4: Order Sought.
7. Closing: "All of which is respectfully submitted."; "Dated at the City of [location], Province of British Columbia, this [month] [day] of [year]."; right-aligned "[Name of lawyer or party authorizing filing]".

Template step 5 glosses Part 3 as "A brief argument setting out why the justice erred in making the decision under review".

**The written-argument template does not itself include a contact table** — that appears only on the book cover template. Filed practice in this office adds one to the written-argument cover as well; that is a permissible addition, not a requirement.

**No "ON APPEAL FROM" line** appears on the written-argument cover. It belongs to the book cover only.

---

## 7. Table of contents: required shape

The TOC is required unconditionally (e-CI §1.2). Its content requirements are in e-CI §1.3 (identical text in paper-CI §1.3):

> "Create Table of Contents in Word based on sequential page numbers (or Bates numbering) in eBook (PDF portfolio) and with header style applied for title 'Table of Contents'. Page numbering (or Bates numbering) in Table of Contents must align with page numbering of the eBook (PDF portfolio)."

> "The Table of Contents must describe each **exhibit**: • by exhibit number • a full description of the document • exhibit date."

> "The Table of Contents must describe each **affidavit** by including: • the name of the deponent, • the date of the affidavit was filed, • a description of any attached exhibits"

Related pagination rules (e-CI §1.3, Page Numbering row):

> "• page numbered (1, 2, 3) sequentially (or Bates numbered) • top centre of page • can start after Table of Contents or on cover page • **Table of Contents must match page numbering** (or Bates numbering) • **Page searching must match page numbering** (or Bates numbering). If page numbering starts after the table of contents, this is done using the **Page Labels** function in Adobe; otherwise, page 1 will be the cover page when searching."

Two consequences a generator must respect:

- The TOC's page numbers can only be finalised once the combined PDF exists. A rendered mockup should carry the TOC's **structure** with page numbers pending, and the assembler fills them.
- "Page searching must match page numbering" is a second, separate artifact from the printed stamp: where numbering starts after the TOC, Adobe **Page Labels** must be set so the viewer's page field agrees with the stamped number.

The court's filed example in CA59991 (the appellants' 2026-08-27 application book) is **not** compliant on this point — its footer restarts at 1 after the index — which is a reminder that a filed book is a style reference, not an authority.

---

## 8. Technical and e-filing requirements

### 8.1 From e-CI §1.3

| Requirement | Instruction (verbatim, abridged where marked) |
|---|---|
| True Copies | "Must be an identical or true copy of the original document whether that original is scanned from paper or saved into PDF from another program, such as Microsoft Word." |
| OCR / 300 DPI | "If scanning is necessary because the original text-based document is paper or requires a handwritten signature (ex., affidavits), the scan must be Optical Character Recognized (OCR'ed) with a minimum resolution setting of 300 DPI." |
| Bookmarking | "Bookmarks must be: • consistent; • clear and; • meaningful." … "bookmarks should describe the contents of the Exhibit (e.g. 'Exhibit 1 – June 1, 2019 - Letter from John to Jane Doe.')" |
| Cover Page (styling) | "You may use this Word template to create your cover page with header style applied to document name. Example: 'Application Book: Leave to Appeal'" |
| Security Settings | "Disable any security settings that might restrict or prevent the Court from viewing, printing, saving, annotating, or searching the electronic document." |
| File Naming | "Use this file naming standard: case #-record-title-party.pdf / For example: CA12345-Application-Book-Leave-to-Appeal-Blue-Green.pdf" |
| File size | "Court Services On-Line e-filing will accept one (1) PDF file (including cover page and Table of Contents) with a file size maximum of 200MB." Over 200 MB: seek Registry/Registrar permission to file in paper. "Appeals with 4,000 pages or more: parties must seek directions from the Registrar as soon as possible, and not less than 90 days before the appeal hearing. See Registrar's Filing Directive" |

The Word header styles on the "Table of Contents" title and the cover page's document name are what generate the PDF's top-level bookmarks — they are structural, not cosmetic.

### 8.2 From the Registrar's Filing Directive (2025-09-04)

Verified line by line against `Engineering/bcca-response-inputs/coa_filing_directive.txt` (#732). Every quoted string below is verbatim from that text. A line marked **inference** is this file's reading, not the Directive's words.

- §1: the Registrar's authority to direct filing rests on **both** instruments — "Under s. 38 of the Court of Appeal Act and Rule 5 of the Court of Appeal Rules, the Registrar may provide directives on filing documents." §1 also states: "Specific instructions, including formatting requirements for the different types of documents filed in an appeal, are found in the completion instructions and the forms." The directive itself sets no font, margin, or page-size rule.
- **E-filing is mandatory for counsel in civil appeals** (§2 table: "e-filing required"). §3: "As e-filing is mandatory, lawyers should seek an exemption only in rare circumstances", examples being CSO unavailability or account access failure. The exemption is sought **from the Registry/Registrar**: "Lawyers in civil appeals who cannot e-file should seek permission from the Registry/Registrar to file in paper."
- Channel is Court Services Online (CSO) via BCeID or BC Online; support at `Courts.CSO@gov.bc.ca` — "do not contact the registry for assistance with electronic filing" (§3). Size limit 200 MB (§3).
- §4 — **paper follow-up copies**, listed for **appeal records** and for **factums and statements**: "If e-filed (required for lawyers in civil appeals) you must provide the registry with three (3) stamped paper copies of the e-filed document within two (2) weeks of e-filing." **Application and response books are not on that list** — no paper follow-up for a book. The obligation lands on the respondents' factum. The two-week period is reproduced here as the Directive's own text; deriving the date it falls due is `lawyer:docket-clerk`'s (see §11).
- §5: "Chambers records longer than 300 pages: Can be filed electronically, but a Registrar may request paper copies be provided prior to the hearing."
- §5, sound or video exhibits: "When included, indicate in the appeal book index that the electronic media is being submitted separately." and "File four (4) identical memory sticks labelled with the appeal file number (#CAXXXXX). CDs or DVDs will not be accepted." **Four** — the superseded 2021 Notice said three.
- §6: at the hearing "judges may work in paper or electronically, or both". **Inference:** a book must therefore be legible on screen and printed — the Directive does not say this.
- §7.1 (R. 83): "E-filed **or emailed** documents will be backdated to the date they were filed or deemed to be filed. The Court will try to process all e-filings on the day they are filed, but may require up to 24hrs." Backdating reaches emailed filings, not only e-filed ones.
- §7.2 (R. 79(4)): orders, certificates and evidentiary documents (affidavits) must be signed; "parties may use an electronic signature or a scan **or copy** of the original signature, unless otherwise required by law".
- §7.3: "Given the rapid development of artificial intelligence tools, the Court reminds all litigants that they are responsible for the authenticity and accuracy of all materials filed with the Court." **Inference from silence:** no AI-disclosure certificate is required — the Directive prescribes none, but nowhere says none is required.
- §7.4: "Parties are not required to retain paper documents when converting them to their electronic equivalents."
- §8 (Case Management of Large Appeals): "If an appeal involves, or is expected to involve, more than 4,000 pages of material, parties must seek directions from the Registrar as soon as possible, and not less than 90 days before the appeal hearing." This is the rule's home provision; the e-CI §1.3 row in §8.1 reproduces it and cross-references back here. The 90-day period is reproduced, not derived — see §11.
- §9 (registry contacts): Vancouver Registry, 400–800 Hornby Street, V6Z 2C5. **The phone numbers are not reliably readable from the text extraction** — the Directive prints four numbers in a column offset from their four labels, so an extraction cannot pair them. The Chambers Scheduler number **604.660.2859** is independently corroborated (Remote Appearances PD: "contact the chambers scheduler at 604.660.2859") and is safe to use. **Do not rely on** the general-inquiries, Court Scheduler or Registrar Scheduler numbers as extracted; read them off `coa_filing_directive.pdf` directly. That one corroborated pairing does fix the column offset at a constant, so the rest are recoverable — but by reading the PDF's layout, not by trusting the extracted order.

Page size comes from the Rules, not the directive: R. 79(2)(b) requires paper filings to be "legibly printed or typewritten on durable white paper having dimensions of 21.5 cm by 28 cm"; R. 79(2)(a) requires English.

---

## 9. Paper filing deltas (fallback only)

Content and ordering are substantively identical between the two instruction sets (§§1.1, 1.2, 2.1 match). The paper version adds physical-production rules and omits most technical ones. Follow the **e-filing** version unless an exemption has been granted.

| Paper-only requirement | Instruction (verbatim) |
|---|---|
| Cover and back page colours | "Application Books: **Buff** / Response Books: **Green**" (clear plastic cover not required) |
| Printed | "Double sided" |
| Binding | "Cerlox plastic comb-bound in booklet form" |
| Volumes | "Create volumes within PDF which are a maximum of 600 pages based on logical breaks for printing and binding… • Create a bookmark for each volume in the PDF • Page numbering must be sequential between volumes / Print and add to each cerlox-bound volume: • Cover page (add volume 1 of 5, 2 of 5 etc.) • Full table of contents" |
| Tabs | "Required for each part of the book" |
| Page numbering | Adds "may be stamped or handwritten"; **omits** the "page searching must match" bullet and the Page Labels instruction |
| Copies (§3.1) | "You will be required to file 2 copies for the Court, 1 copy for your records, 1 copy to serve on each party / **4 copies**" |

The e-version alone carries: OCR/300 DPI, the general bookmarking row, page-search alignment and Page Labels, security settings, file naming, and the 200 MB limit. Note that the statement "In civil appeals, e-filing is mandatory for lawyers" appears in the **paper** instructions (§3.1), not the e-filing ones.

---

## 10. Multi-party boilerplate

**No rule governs this.** B.C. Reg. 120/2022 contains no provision on style-of-proceeding format, party-name abbreviation, or pluralization. R. 6(1)(a) requires a notice of appeal to name as a respondent each person who was a party below and whose interests could be affected, but says nothing about format on later documents. The *Interpretation Act* s. 28(3) ("words in the singular include the plural") is the only pluralization aid.

The governing conventions are therefore:

1. The cover-page template's step 3 — names "in exactly the same order and format as the Notice of Appeal or Notice of Application for Leave to Appeal".
2. The Style of Proceedings PD (2022-09-12) — appellants first, respondents second; roles in brackets; multiple parties grouped **by their role in the court below** (see §5, which sets out when a single side splits into more than one block), order preserved across groups.
3. The template's own "APPELLANT(S)" / "RESPONDENT(S)" labels, which resolve to the plural where a group has more than one member.

Worked forms, from the CA59991 response book (2 appellants, 3 respondents):

- Party block: "**BRIGHTWATER OUTFITTERS INC. and THISTLE COLLECTIVE INC.**" / *Appellants* / *(Plaintiffs)*; "**NORTHFIELD CLOTHING CORPORATION, ANDREW MARLOWE (also known as DREW MARLOWE), and JESSE MARLOWE**" / *Respondents* / *(Defendants)*.
- Response line: "Response of: the **Respondents**, Northfield Clothing Corporation, Andrew Marlowe, and Jesse Marlowe".
- Responded-to line: "THIS IS A RESPONSE TO the stay application of the **Appellants**, Brightwater Outfitters Inc. and Thistle Collective Inc., filed and served [date], returnable [date] at [time]."

The set of names in each phrase is **every party sharing that role**, in the order they appear in the notice of appeal. Nothing in the instruments contemplates naming only the first party of a side outside the top-right short style ("[First Appellant] vs. [First Respondent]"), which is expressly a short form for the identification block alone.

---

## 11. Mechanics affecting the book

Filing deadlines, filing and service cut-offs, business-day counting, adjournment timing and shorter-notice scheduling are `lawyer:docket-clerk`'s (`shared/docket-clerk/references/bcca-rules.md`), never this document's.

- **File then serve**: R. 3 — "file the document, and serve on each party to the appeal **a copy of the filed version** of the document". The served copy must bear the filing stamp, so filing must precede service.
- **Who must be served**: R. 7(2)(b) — a respondent who was served the notice of appeal but filed no notice of appearance (Form 2) need not be served with further documents "unless the court or a justice orders otherwise".
- **Adjournment**: R. 65(1)(b) — a responding party can seek an adjournment only **with the applicant's consent**, by Form 9 requisition.
- **Hearing time**: Chambers Applications PD (2026-08-04): "Parties will have **30 minutes total (not 30 minutes each)** for the hearing of their application, unless otherwise directed by a Deputy Registrar."
- **Remote appearance**: the same PD, item 5 — anyone wishing to appear by Zoom must file a Request to Appear Remotely with their materials (*Remote Appearances*, Civil & Criminal Practice Directive, 18 July 2022). That directive (issued 2022-07-11, effective 2022-07-18), Part 1 item 2: "For Chambers: File a Request to Appear Remotely with their application materials or responding materials in accordance with the Chambers Applications practice directive." **This is a second artifact in the response filing package**, filed with the book. Part 2 adds that "Zoom usernames must precisely match the name(s) of parties provided on the Request to Appear Remotely."
- **Responding materials expressly bound to the directive**: Chambers Applications PD item 4 — "Person(s) responding should also file responding materials in accordance with the *Rules* and the Registrar's filing directive."
- **Relief**: Act s. 32 / R. 41 (dispense with a rule requirement; extend or shorten time); Act s. 19 (an appeal is not defeated by an irregularity or procedural error); R. 82 (a filed document may be amended only with all parties' consent or leave).

---

## 12. Citation style

The **Citation of Authorities PD (issued 2026-08-24, effective 2026-09-08)** adopts the Canadian Open Access Legal Citation Guide (COAL, 2024 CanLIIDocs 830):

> "Parties preparing factums, written arguments, memoranda of law, or any written submissions to the Court of Appeal are requested to comply with the guidance in COAL for all forms of legal citation."

Appendix A house style, applying to all Court of Appeal filings:

1. Do not cite case summaries or headnotes — "They do not form part of the judgment."
2. Name the judge at the end of a citation only when relevant.
3. Short-form rule citations are acceptable ("*Court of Appeal Rules*, R 5").
4. "Plain language is preferred. Avoid overly formal language, such as 'this Honourable Court,' 'heretofore,' 'aforesaid,' or 'learned'. Only use Latin phrases if necessary."
5. "Do not capitalize the names of documents, the titles of pleadings, or the status of litigation parties unless required in a Form" — "the appellant's notice of civil claim", not "the Appellant's Notice of Civil Claim".
6. Capitalize "court" only for a specific court; capitalize "judge"/"justice" only when naming one.

**Transitional note.** Anything filed before 2026-09-08 is governed by the previous (2022-07-18) version; from 2026-09-08 onward, COAL and Appendix A apply. Note that item 5 sits in tension with the cover-page templates, which use capitalized party blocks — the templates are the layout authority and the Forms exception in item 5 covers them; COAL governs citations and body prose.

---

## 13. Sources on file

`Engineering/bcca-response-inputs/` holds: `court-of-appeal-act-2021.txt`, `interpretation-act-96238.txt`, `ci_response_book_leave_stay_e.pdf`, `ci_response_book_leave_stay_paper.pdf`, `coa_filing_directive.pdf`, `tpl_ca_book_cover_page.dotx`, `tpl_written_argument_general.dotx`, `tpl_affidavit.docx`, and `research-findings-433.md` (the `/legal-research` memo resolving issue #433, 2026-08-29). The Court of Appeal Rules are **not** in this folder: the single verified copy is `Engineering/bcca-appeal-books-inputs/bcca-rules-120-2022.txt`, proven byte-identical to the live bclaws consolidation on 2026-09-20. Cite line numbers only from that path — a second copy that once sat here wrapped differently, so its line numbers pointed at unrelated rules (#742). The Schedule 3 **form bodies** are in neither: the HTML consolidation carries Schedule 3 as headings only, and the only on-disk source for the form text is `Engineering/bcca-appeal-books-inputs/bcca-rules-120-2022-bclaws-with-forms.txt` (the bclaws PDF extraction, #741). Read form bodies there by their `FORM n` heading, never by its List of Forms index, which extracts column-misaligned.

Templates are OOXML: read them by unzipping and parsing `word/document.xml` rather than by text extraction, which drops the layout and the table structure.

The four practice directives cited above are not held locally; they were fetched and read in full on 2026-08-30 from `https://www.bccourts.ca/Court_of_Appeal/practice_and_procedure/civil_and_criminal_practice_directives/PDF/` (`(CandC)Chambers_Applications.pdf`, `(CandC)Remote_Appearances.pdf`, `(CandC)Style_of_Proceedings.pdf`, `(CandC)Publication_Bans_Sealing_and_Anonymization_Orders.pdf`), with the index at `…/civil_practice_directives_/index.aspx`. The Citation of Authorities directive is at `(CandC)Citation_of_Authorities.pdf` on the same path. The **`/PDF/` segment is required** and was missing here until #732: without it the server answers **HTTP 200 with an HTML "File Not Found" page**, not a 404, so a status-code check passes and the download is silently worthless — check the `%PDF-` magic number, not the status code. There is no separate "notices" page — directives are the only instrument of this kind, and the index is the place to re-check for new ones.

The completion instructions cross-reference two further documents not yet on file: the **Book of Authorities completion instructions** (needed if the optional Book of Authorities is ever produced) and the court's **Systems and Software Requirements** checklist plus its PDF technical how-to library (needed at assembly time for page labels, bookmarks, and OCR).
