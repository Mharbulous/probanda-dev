---
form_number: 32
title: Notice of Application
form_key: form-32
version: not recorded
template: subskills/publish-bcsc-form/templates/032-noa.dotx
emitter: source/probanda/mcp/src/submission/forms/render-form32-filed-face.ts
type_file: draft/CAN/BC/BCSC/Documents/notice-of-application.md
conformed_to:
  - B.C. Reg. 105/2026
---

# Form 32, Notice of Application

The identity of this BC Supreme Court form, which `publish-bcsc-form` checks after fixing the form and before filling it, as `/publish`'s "Form identity" section directs. The form a Notice of Application Writing fills. `conformed_to` lists each amending regulation the template, emitter and type file have been conformed to, recorded by the repo-session checklist at `subskills/publish-bcsc-form/references/form-update.md`.

`template` is the shipped template the fill uses. No official copy of this form is kept in the repository, so its version is not recorded. The source below is recorded in this text only, not as `page_url`, so `sources__check` does not check it.

## Source

Form 32 as substituted by B.C. Reg. 105/2026 (OIC 264/2026, Schedule 1, section 10), in force 2026-10-01, pages 8 to 10 of the order: `https://www.bclaws.gov.bc.ca/civix/document/id/oic/oic_cur/0264_2026`, a PDF with sha256 `af43a993c306a934f4266878aa6c8938787f3cf3de8c1cb6db6d751fee218546`. No B.C. Gazette Part II page address for the regulation is recorded.

## Form instructions

Each bracketed instruction of the form as substituted, and the check that proves the assembled Form 32 meets it. After an `asm32` fill, `shared.verify` runs every check named in the Check column (`subskills/publish-bcsc-form/scripts/steps/asm32/conformance.py`) and reports each failure as a warning. `placeholder` means verify's residual-placeholder check covers it, `grammar` means `asm32.validate` enforces it, `template` means the conformed template's own layout meets it, and `counsel` means it is counsel's drafting, which no check can prove.

| Instruction | Check | What the check proves |
|---|---|---|
| [Style of Proceeding] | `placeholder` | The caption's tokens are filled from the matter |
| [Rule 22-3 of the Supreme Court Civil Rules applies to all forms.] | `template` | The template's page layout |
| [The notice of application must be served in accordance with Rule 8-1. A hearing date is not fixed until a Notice of Hearing of Application is filed.] | `template` | A note to the applicant, which the template does not print |
| [name(s) of party(ies) or person(s) affected] | `to_line` | The "To:" line names at least one party or person and carries no bracket |
| [address of registry in which the proceeding is being conducted] | `placeholder` | The courthouse address is filled |
| [time estimate] | `time_estimate` | The estimate is a stated time, without "hour(s)"/"minute(s)" scaffolding or a bracket |
| [insert date, date range, or assize] | `proposed_hearing` | The proposed hearing line carries no bracket |
| [Check whichever one of the following boxes is correct.] | `associate_judge` | Exactly one associate-judge jurisdiction sentence prints |
| [Using numbered paragraphs, set out the order(s) that will be sought at the application and indicate against which party(ies) the order(s) is(are) sought.] | `part1_against` | Each order carries `against`, or its text names a party of record |
| [Using numbered paragraphs, set out a brief summary of the facts supporting the application.] | `grammar` | Part 2 is numbered paragraphs |
| [If any party sues or is sued in a representative capacity, identify the party and describe the representative capacity.] | `counsel` | Counsel's drafting of Part 2 |
| [Using paragraphs numbered sequentially from Part 2 above, specify any rule or other enactment relied on and provide a brief summary of any other legal arguments on which the applicant(s) intend(s) to rely in support of the orders sought. If appropriate, include citation of applicable cases.] | `grammar` | Part 3's numbering runs on from Part 2 |
| [Using numbered paragraphs, list the affidavits served with the notice of application and other affidavits and other documents already in the court file relevant to the application on which the applicant(s) will rely. Each affidavit included on the list must be identified as follows: "Affidavit # ....[sequential number, if any, recorded in the top right hand corner of the affidavit].... of ....[name]...., made ....[date]....".] | `part4_affidavits` | Each Part 4 affidavit line reads "Affidavit #<n> of <name>, made <Month D, YYYY>" |
| [type or print name] | `placeholder` | The lawyer's name is filled |
| To be completed by the court only (dotted blanks, no bracket) | `court_box` | The court-only box carries no bracketed prompt |
| [The following information is provided for data collection purposes only and is of no legal effect.] | `appendix` | The Appendix prints, with all 17 boxes in the form's order |
| [Check the box(es) below for the application type(s) included in this application.] | `appendix` | At least one Appendix box is checked |
