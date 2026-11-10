# Supreme Court of British Columbia: Court Services Online (CSO)

The CSO e-filing walkthrough for an existing civil file, written from a set-down package (notice of hearing of application, notice of application, affidavits and their Electronic Filing Statements). Read `SKILL.md` section 1 first: every Next, I Agree, Submit Original and final submit below is the practitioner's click.

- Start page (signed in): `https://justice.gov.bc.ca/cso/filing/submission/efileHome.do`
- File-number look-up (opens as a pop-up from Step 1): `https://justice.gov.bc.ca/cso/filing/lookupFileNumberInit.do?courtFileNumber=<file number>`

## Before CSO

**Preconditions the practitioner confirms** for a set-down under amended Rule 8-1 (sources below). Each date goes to the docket-clerk agent.

- The notice of application and its affidavits have been served on every application respondent.
- Each respondent has served an application response, or the time to serve one has run.
- The hearing estimate, and so which list the hearing goes on and who sets the date.
- Filing and serving the notice of hearing can be done in time before the hearing date.

**Package checklist**, in the order the documents are added at Step 3:

| # | Document | CSO document type | Check |
|---|---|---|---|
| 1 | Notice of Hearing of Application (Form 33.01) | Notice of Hearing of Application | Signed by the lawyer. Part 1 shows the service date and, for each respondent, whether a response was served |
| 2 | Notice of Application (Form 32) | Notice of Application | The signed version that was served |
| 3 | Each affidavit served with it and not already filed | Affidavit in Support of Application | Sworn or affirmed, exhibits stamped |
| 4 | One Electronic Filing Statement per affidavit, added right after its affidavit | Electronic Filing Statement - Supreme | Signed by the lawyer (next section) |

An affidavit filed earlier in the proceeding is not filed again. Ask the practitioner which affidavits are already on the court file.

## Electronic Filing Statements (Form 119)

An unsigned statement is the most likely thing to stop the package. Check each one before opening CSO, as `SKILL.md` section 3 says.

- One per affidavit, or per other signed document filed for evidentiary purposes. The notice of hearing and the notice of application take none.
- Paragraph 1 names the document. Firm practice describes the affidavit by number, deponent and date, for example: "The First Affidavit of <deponent> in this case made on <date> is being submitted for filing electronically on behalf of the <party role>, <party>."
- Paragraphs 2 and 3 keep the form's wording.
- The signature line makes plain the lawyer signs, for example "Signature of lawyer for the <party role>, <lawyer>". The client's name must not read as the signer's.
- Render each statement and look: a signature on the line, paragraph 1 naming the right affidavit, and a file name that says it is signed.

## Walkthrough

From the start page, click **Add Package**. On every page, fill, report, and wait for the practitioner to click **Next**.

1. **Step 1: Identification**
    - New or existing file: **Existing**.
    - Court/Case File Number: the number alone, with no registry letters or `S` prefix. CSO's own records list it without the prefix. The **Search** button opens the look-up as a pop-up the extension cannot see. Open the look-up address above in your own tab, search, and pick the row whose style of cause is this case, because the same number can exist in another registry. Close the tab and type the location, level and class it shows.
    - Filing information, for a Vancouver civil file: Vancouver Law Courts (VLC), S - Supreme, S - Supreme Civil (General). Use the location the look-up shows for any other registry.
    - Rejected document, fee waiver, CFCSA, protection order, rush: **No** unless the practitioner says otherwise.
    - E-mail notification: **Yes**.
    - Your file number: the firm's client and matter number.
2. **Step 2: Package Access**
    - For each colleague the practitioner names, add them with the access level the practitioner gives, and click **Save** (the small link, not Next). Confirm the name appears under Users with Access.
3. **Step 3: Add Documents**, one document per Save, in the checklist's order.
    - **Document Type**, then the file by the file-upload tool, then the three questions, then **Save**. Confirm the row appears in Documents to be Submitted before adding the next. Find the Document Type select and file input again after each Save.
    - Amends a previous document: **No**. Virtual Chambers: **No**.
    - Should this document go to Scheduling? **No** for a chambers hearing of 2 hours or less: the court's Scheduling page says it cannot assist with "Chambers hearings under 2 hours". **Yes** only where the practitioner says a registrar has fixed a longer hearing.
    - Saving an empty form shows "Document Type is required." and adds nothing.
    - A row opened with **Edit** by mistake: click **Cancel** to close it unchanged. One the practitioner opened: ask first.
4. **Step 3B: Verify Flattened Documents** (appears when CSO flattens a PDF, usually a large scanned affidavit)
    - CSO's text: "The following files have been flattened for compatibility reasons. Please review to ensure accuracy of the flattened files. If you determine that a document has been damaged by the flattening process, please use the Submit Original option."
    - Click **Review** to download the flattened copy, then check it against the original as `SKILL.md` section 6 says. Compare page count and sizes, each page's text and image (signatures, commissioner stamps, exhibit stamps, highlighting) and orientation. A lost rotation setting, which displays a page turned, has been seen. It loses no content.
    - The practitioner ticks **I Agree** or **Submit Original**.
5. **Steps 4 to 6: Parties, Request Access, Review Package**
    - Parties and restricted access read "Not Applicable" on an existing file.
    - On Review Package, check the document list against the checklist and report the fees CSO shows. Clicking Next on Review Package **submits** the package. That click is the practitioner's alone.
6. **Receipt page**
    - Note the package number. Click **Print Submission Sheet** and **Print Receipt**. Each downloads a PDF to Downloads, named `CSOSubmissionReport_<date>.pdf` and `CSOReceipt_<date>.pdf`. Then click **Done**.

## After submission

The package is submitted, not yet filed. The submission sheet shows each document "Submitted", and a fee the registry has not yet collected shows "Not Processed".

- The two downloads go to `/file-manager:housekeeping`, as `SKILL.md` section 7 says.
- Once the registry returns the filed notice of hearing, it is served on each application respondent. The service deadline and the application record deadlines go to the docket-clerk agent.

## Sources

- Supreme Court Civil Rules, Rule 8-1(14.1) to (14.5), as amended by OIC 264/2026 (B.C. Reg. 105/2026), in force October 1, 2026: <https://www.bclaws.gov.bc.ca/civix/document/id/oic/oic_cur/0264_2026>
- Supreme Court Civil Rules, Rule 23-3(6) (electronic filing statement)
- Form 119, Electronic Filing Statement: <https://www2.gov.bc.ca/assets/gov/law-crime-and-justice/courthouse-services/court-files-records/court-forms/supreme-civil/119.pdf>
- PD-75 Chambers Practice: <https://www.bccourts.ca/supreme_court/practice_and_procedure/practice_directions/civil/PD-75_Chambers_Practice.pdf>
- Supreme Court of BC, Scheduling (Vancouver): <https://www.bccourts.ca/Supreme_Court/scheduling/>
