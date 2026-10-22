---
form_number: 33
title: Application Response
form_key: form-33
version: not recorded
template: subskills/publish-bcsc-form/templates/form-33.dotx
emitter: source/lawyer/mcp/src/submission/forms/render-form33-filed-face.ts
type_file: draft/CAN/BC/BCSC/Documents/application-response.md
conformed_to:
  - B.C. Reg. 105/2026
---

# Form 33, Application Response

The identity of this BC Supreme Court form, which `publish-bcsc-form` checks after fixing the form and before filling it, as `/publish`'s "Form identity" section directs. The form an Application Response Writing fills. `conformed_to` lists each amending regulation the template, emitter and type file have been conformed to, recorded when a plugin release conforms the form.

`template` is the shipped template the fill uses. No official copy of this form is kept in the repository, so its version is not recorded. The source below is recorded in this text only, not as `page_url`, so `sources__check` does not check it.

## Source

Form 33 as substituted by B.C. Reg. 105/2026 (OIC 264/2026, Schedule 1, section 10), in force 2026-10-01, pages 10 to 12 of the order: `https://www.bclaws.gov.bc.ca/civix/document/id/oic/oic_cur/0264_2026`, a PDF with sha256 `af43a993c306a934f4266878aa6c8938787f3cf3de8c1cb6db6d751fee218546`. No B.C. Gazette Part II page address for the regulation is recorded.

## Form instructions

Each bracketed instruction of the form as substituted, and what proves the assembled Form 33 meets it. Form 33 has no conformance checks of its own after the fill, as Form 32 has. `placeholder` means the residual-placeholder scan, which puts any unfilled blank on the NOT FINAL cover page, covers it. `grammar` means `asm33`'s parser (`subskills/publish-bcsc-form/scripts/steps/asm33/common.py`) enforces it. `template` means the conformed template's own layout meets it. `counsel` means it is counsel's drafting, which no check can prove. `none` means nothing checks it yet.

| Instruction | Check | What proves it |
|---|---|---|
| [Style of Proceeding] | `placeholder` | The caption's tokens are filled from the matter |
| [Rule 22-3 of the Supreme Court Civil Rules applies to all forms.] | `template` | The template's page layout |
| [The application response must be served then filed in accordance with Rule 8-1. A hearing date is not fixed until a Notice of Hearing of Application is filed.] | `template` | A note to the respondent, which the template does not print |
| Application response of: [party(ies)] | `placeholder` | The respondent's name is filled |
| THIS IS A RESPONSE TO the notice of application of [party(ies)] dated [date] | `grammar` | `notice_dated` is required. The notice is served unfiled, so the line names it by the date it bears |
| [Check whichever one of the following boxes is correct and complete the required information.] agree to the applicant's hearing date of [date] / do not agree to the applicant's hearing date and propose the following date(s): [date(s)] | `grammar` | `hearing_date` is required: the one line that applies, or `Nil.` when the applicant proposed no date (Rule 8-1(10)(b)(iv)), so only the chosen line prints |
| [time estimate] | `placeholder` | The estimate is filled |
| [set out paragraph numbers and any proposed terms] | `grammar` | Part 1 renders from the consented `orders` and their terms |
| [list paragraph numbers] (Parts 2 and 3) | `grammar` | Each order carries exactly one position, and the opposed and no-position numbers fill these, or `Nil` |
| [Using numbered paragraphs, set out a brief summary of the facts on which the orders sought in the application should not be granted.] | `grammar` | Part 4 is numbered paragraphs, or `Nil.` with `pure_law_confirmed: true` |
| [Using paragraphs numbered sequentially from Part 4 above, specify any rule or other enactment relied on and provide a brief summary of any other legal arguments on which the application respondent(s) intend(s) to rely in opposing the orders sought in the application. If appropriate, include citation of applicable cases.] | `grammar` | Part 5's numbering runs on from Part 4 |
| [Using numbered paragraphs, list the affidavits served with this application response and other affidavits and other documents already in the court file relevant to the application on which the application respondent(s) will rely. Each affidavit included on the list must be identified as follows: "Affidavit #....[sequential number, if any, recorded in the top right hand corner of the affidavit].... of ....[name]...., made ....[date]...."] | `none` | Part 6 is a flat list. The emitter prints each document's recorded label, and nothing checks the "Affidavit #<n> of <name>, made <date>" form |
| [Check whichever one of the following boxes is correct and complete any required information.] (address for service) | `none` | The template has no address-for-service boxes: its `[SERVICE CHECK]` blank prints empty |
| [Set out the address(es) for service in compliance with Rule 4-1 (1) of the Supreme Court Civil Rules and any additional address(es) under Rule 4-1 (2) that the application respondent wishes to include.] | `none` | As above |
| [type or print name] | `placeholder` | The lawyer's name is filled |

An application response must not exceed 10 pages (Rule 8-1(10)). `asm33` counts the rendered pages, the NOT FINAL cover page not counted, and returns an advisory in `done`'s `advisories` when it runs over. The advisory never blocks the publish.
