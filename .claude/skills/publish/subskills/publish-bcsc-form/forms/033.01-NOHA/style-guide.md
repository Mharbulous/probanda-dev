# Form 33.01 — Notice of Hearing of Application

Read this guide only when the classified form is `form-33.01` (`NOHA`).

Apply `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md`.

Form 33.01 is added by B.C. Reg. 105/2026 (in force 2026-10-01). An applicant
files it under Rule 8-1 (14.4) (a) to set a served notice of application down
for hearing. Resetting an application adjourned generally under Rule 8-1
(21.1) uses the same form, filled the same way: nothing extra applies. This is
a generate-only form.

## Completion rules

1. Every hearing date, time of day, courthouse address and time estimate is
   the practitioner's own content, copied as given. This skill never computes,
   infers or proposes a date or an estimate. A date or deadline question goes
   to the docket-clerk agent.
2. The service dates come from the served copies (the notice of application
   and each application response), as the practitioner gives them.
3. The orders sought are the paragraph numbers from Part 1 of the notice of
   application, plus any additional terms sought by consent, as given.
4. A field the practitioner does not give keeps the form's own bracketed
   instruction or blank line, for completion in Word.
5. Check boxes:
   - Service: a box is checked when its dates are given, and the "no
     application response" box when `no_response_time_expired` is yes.
   - Date of hearing: exactly the box `hearing_date_basis` names
     (`agreed`, `not_agreed` or `unopposed`).
   - Duration: the agreed box when an agreed estimate is given; otherwise the
     not-agreed box, with the applicant's minutes, and either the respondent's
     minutes or the "has not given a time estimate" box.
   - Jurisdiction: the associate judge box `associate_judge` names, and each of
     summary trial (Rule 9-7), final order and injunctive relief marked yes.
   - Signature: `applicant` or `lawyer`.
   A box the context says nothing about stays unchecked.
6. The date beside the signature stays `[mmmm d, yyyy]`. Do not pre-sign the
   document.

Repository enforcement: `scripts/fill_subs_hearing.py::build_subs_form33_01`
and `boxes_form33_01` own the fillable fields and boxes;
`subskills/publish-bcsc-form/templates/form-33.01.docx`, built from the
form's text in OIC 264/2026, owns typography and layout.
