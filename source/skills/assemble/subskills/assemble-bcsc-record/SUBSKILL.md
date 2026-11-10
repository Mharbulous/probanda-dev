---
name: assemble-bcsc-record
description: >
  Binds a BC Supreme Court application record under Rule 8-1 (15) as amended
  by B.C. Reg. 105/2026: the Form 30.001 cover, an index and the documents in
  the rule's order, numbered and bookmarked. Also writes the index alone for
  service under 8-1 (17), and the separate copy of the filed notice with its
  orders sought marked under 8-1 (15.1). Routed to by the explicit
  assemble-bcsc-record token, by the Application book job, or by a
  practitioner asking to bind an application record.
---

# Assemble BCSC Record

Binds the record for one Notice of Application, once it is set down. The
scripts and their errors are in `references/record-binding-contract.md`. The
three scripts need PyMuPDF, so they run on the PC only (Error handling).

## What this produces

1. `Application Record.pdf`: the cover, the index and each document, numbered
   from 1 on the cover, with a bookmark per tab.
2. `Application Record - Index.pdf`: the index pages alone, for service under
   8-1 (17).
3. `Notice of Application - orders marked.pdf`: the filed notice with Part 1
   highlighted, for 8-1 (15.1).

## Steps

1. **Resolve the writing folder.** The Notice of Application's own folder under
   the matter's `0. DRAFT*` folder, resolved the way `/draft` step 6 resolves
   it. Every output is written there. If an output name exists, add a version
   suffix (`Application Record v2.pdf`). Never overwrite.

2. **Find the cover.** The Form 30.001 cover that `/publish` rendered, saved to
   PDF. If there is none, stop and point the practitioner at `/publish`.

3. **List the documents.** Each document is a PDF of what was filed or served:
   - the filed notice of application, from the copies saved when it was set
     down;
   - every application response served on the applicant;
   - every filed pleading, affidavit or other evidence to be relied on. Part 4
     of the notice names the material relied on;
   - any affidavit or other evidence an application respondent served on the
     applicant;
   - each filed pleading, on a Rule 9-7 application;
   - optionally a draft order, a written argument, a list of authorities and a
     draft bill of costs. A written argument goes in only when the application
     is estimated to take more than 2 hours, or with leave (8-1 (16)).

   Look in the matter folder. When a document has no PDF, or more than one file
   could be it, ask the practitioner which file it is. Never guess, and never
   use one file for two documents. An affidavit of service or a copy of an
   authority never goes in (8-1 (15) (d)). Any other document goes in only when
   the practitioner says every party of record consented.

4. **Write the documents file** with the Write tool, beside the notice's
   substance files, in the shape the contract gives, with each document's
   `kind` and the title the index shows.

5. **Bind.** Run the scripts from `/assemble`'s folder: in a repo checkout as
   `python source/skills/assemble/subskills/assemble-bcsc-record/scripts/<script>`
   from the repo root.

   ```
   python record_manifest.py "<documents .json>" "<cover .pdf>" "<writing folder>\Application Record.pdf" "<manifest .json>"
   python paginate_record.py "<manifest .json>"
   python mark_orders.py "<filed notice .pdf>" "<writing folder>\Notice of Application - orders marked.pdf"
   ```

   On a rejection, report the code and detail and stop. On `heading_not_found`
   or `no_text_layer` from `mark_orders.py`, tell the practitioner the marked
   copy must be made by hand.

6. **Present the result.** Present each file as a clickable file card
   (`shared/present-files.md`). Beside the record, list each tab with its first
   page and the file used for it, so the practitioner can check the matching.

Serving the index and providing the record and the marked copy to the registry
are the practitioner's steps in the `Application book` job. This subskill
computes no date: a deadline is the docket-clerk's.

## Error handling

- On `missing_dependency`, PyMuPDF is absent. On the PC, run
  `pip install PyMuPDF`. In Cowork, never install or fetch a package, or run or
  reimplement the scripts in any shell. Say this subskill can't run here, offer
  the Code tab, and stop.

## Boundaries

- Never bind, number or bookmark a record by any route other than these
  scripts.
- Never fill the Form 30.001 cover here. That is `/publish`.
