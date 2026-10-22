# Form 30.001 — Record cover

Read this guide only when the classified form is `form-30.001` (`REC`).

Apply `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md`.

Form 30.001 is the cover of a record: an application record under Rule 8-1
(15), and the records under Rules 12-3 (1), 16-1 (11) and 23-6. This is a
generate-only form. It fills the cover only. Binding the record is
`/assemble`'s.

## Completion rules

1. The record type heads the cover as given (for example `APPLICATION
   RECORD`), and the rule reference line is given whole (for example
   `(RULE 8-1 (15))`, or `(RULE 16-1 (11))` for a petition record).
2. One party block is printed per party given, each with the party's name,
   counsel if applicable, address for delivery, and telephone and fax/e-mail.
   With no parties given, the form's two blank blocks stay.
3. The appearance type (for example `Hearing`), its date and time, its place,
   and each side's time estimate are the practitioner's own content, copied as
   given. This skill never computes or infers a date or an estimate.
4. The "To be heard before" box is the one `heard_before` names (`judge`,
   `associate_judge` or `registrar`). Unnamed, all three stay unchecked.
5. The "provided by" line repeats the record type in title case
   (`Application Record provided by:`).
6. A field the practitioner does not give keeps the form's own bracketed
   instruction or blank line, for completion in Word.

Repository enforcement: `scripts/fill_subs_hearing.py::build_subs_form30_001`,
`boxes_form30_001` and `party_rows_form30_001` own the fillable fields;
`subskills/publish-bcsc-form/templates/form-30.001.docx` owns typography and
layout.
