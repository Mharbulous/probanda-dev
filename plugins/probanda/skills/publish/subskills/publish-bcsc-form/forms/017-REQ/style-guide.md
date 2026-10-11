# Form 17 — Requisition – General

Read this guide only when the classified form is `form-17` (`REQ`).

Apply `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md`.

This is a short generate-only form. The calling practitioner supplies the
substantive text for `Required:`; this skill does not draft or revise the
relief sought.

## Completion rules

1. `Filed by:` identifies the filing party exactly as supplied.
2. `Required:` reproduces the supplied order or relief text without adding a
   legal basis, amount, condition, or recital.
3. List each supporting affidavit in the convention:

   `Affidavit # [number] of [deponent name], made [mmmm d, yyyy].`

   When a complete `affidavit_description` is supplied, it replaces that whole
   line. Otherwise the bracket fields remain for manual completion.
4. The date remains `[mmmm d, yyyy]` for manual completion unless the template
   context expressly supplies a completed affidavit-list entry.
5. The signature block uses the confirmed client and lawyer names. Do not
   pre-sign the document.

Repository enforcement: `scripts/fill_subs.py::build_subs_form17` owns the
fillable fields; `subskills/publish-bcsc-form/templates/form-17.docx` owns typography and layout.
