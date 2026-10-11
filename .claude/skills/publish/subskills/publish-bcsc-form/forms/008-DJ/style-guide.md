# Form 8 — Default Judgment

Read this guide only when the classified form is `form-8` (`DJ`).

Apply `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md`.

This is a short generate-only registrar form. The template preserves the two
source order clauses and their `to be assessed` wording. The skill fills only
confirmed caption data, the named defendant in each clause, and the supplied
amount.

## Completion rules

1. Reproduce the defendant name from the confirmed proceedings profile in both
   order clauses. Do not infer a different judgment debtor from the request.
2. Insert `amount` exactly as the practitioner supplies it. Do not calculate,
   round, characterize, or add currency wording.
3. Preserve `damages to be assessed` and the costs clause's `to be assessed`
   continuation exactly as the template provides them.
4. Leave `Date: ________________` and the `Registrar` signature block for the
   court. Do not insert a practitioner date or signature there.
5. Do not restore the removed LEAP clause-library `Last updated` footer stamps.

Repository enforcement: `scripts/fill_subs.py::build_subs_form8` owns the
fillable fields; `subskills/publish-bcsc-form/templates/form-8.docx` owns typography and layout.
