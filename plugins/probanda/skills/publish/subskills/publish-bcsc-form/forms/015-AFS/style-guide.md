# Form 15 — Affidavit of Personal Service

Read this guide only when the classified form is `form-15` (`AFS`).

Apply `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md`.

Prescribed by Rule 4-6(1) and enacted in its current wording by
B.C. Reg. 165/2024, Sch. 1, s. 6. `subskills/publish-bcsc-form/templates/015-afs.docx` reproduces that
prescribed text; the operative wording is not to be edited.

## When this form applies

Form 15 proves **personal service** — the mode defined by Rule 4-3(2),
relevantly "leaving a copy of the document with the individual".

It does **not** apply to:

- service on a party at their address for service → Form 16, `forms/016-AOS/`;
- service effected under a Rule 4-4 order for an alternative method of service
  (substituted service) → Form 16 modified, see the substituted service variant
  in `subskills/publish-bcsc-form/forms/016-AOS/style-guide.md`;
- an affidavit that says anything beyond proving service → Form 109.

## Content drafting

1. **No free-form narrative.** The numbered sections are the whole document.
   Do not add paragraphs, headings, recitals, or explanation. Everything the
   form asks for is a fill-in; everything it does not ask for does not belong.

2. **Filed versus unfiled documents — the distinction that governs section 1:**

   > A document already filed in the proceeding is described, with its
   > court-stamp date, and is NOT exhibited — the court has it. A document not
   > filed is described AND attached as a lettered exhibit — the court has no
   > other copy.

   `filed_documents` drives the first branch, `unfiled_documents` the second.
   Either may be empty; its branch then does not appear at all. Exhibits are
   lettered A, B, C in list order.

3. **One identification branch only.** Section 3's `identification_method` is
   one of `known`, `photo_id`, or `other`, and `identification_detail` carries
   the corresponding particulars. The unelected branches are removed — a filed
   affidavit must not show empty check-boxes.

4. **Individuals only.** Personal service on a company (Rule 4-3 /
   *Business Corporations Act*) is not modelled here. `served_party_type` of
   `company` is refused rather than drafted; use a Form 109 for that.

## Template post-processing

5. **No affidavit identifier block.** Rule 22-2(3) requires the top-right
   "This is the Nth affidavit…" block on every affidavit *other than an
   affidavit of service*, and the prescribed form carries none. Do not add one,
   and do not collect `affidavit_ordinal` for this form.

6. **No exhibit page numbering.** Rule 22-2(10) likewise excepts an affidavit
   of service from sequential exhibit page numbering.

7. **No interpreter endorsement.** The prescribed form carries no Rule 22-2(7)
   endorsement. If one is genuinely needed, that is a signal the affidavit
   should be a Form 109.

8. **Video-conference commissioning.** When `sworn_by_video` is affirmative,
   both prescribed statements are included. They are rendered as the affidavit's
   **last numbered paragraphs**, because Rule 22-2(6.1)(a) requires the
   video-conference statement to appear "in its last numbered paragraph" —
   the printed form shows them unnumbered after the last numbered paragraph,
   which would not comply. Under Rule 22-2(6.1)(b) the jurat states the
   **commissioner's** city, not the deponent's, even if the deponent was
   elsewhere.

9. **Serve the order with the document.** Where the underlying service was
   ordered under Rule 4-4, Rule 4-4(2) requires a copy of the entered order to
   be served with the document unless the court otherwise orders or the method
   is advertisement — but an affidavit proving such service is not a Form 15.
   See the substituted service variant in `subskills/publish-bcsc-form/forms/016-AOS/style-guide.md`.
   Where the ordered method resembles personal delivery, this form's wording is
   the closer reference skeleton for the variant to adapt.

10. **Jurat left for the commissioner's stamp.** The commissioner's name is
   never printed under the jurat line — the stamp supplies it, and
   pre-printing a name constrains who can take the affidavit. No
   `commissioner_name` is collected for this form.

The official form as published is kept in the repository beside this style guide as `form-15-official.pdf` (not shipped in the plugin),
which the drafting reference `subskills/publish-bcsc-form/templates/015-afs.docx` reproduces.

Repository enforcement: `subskills/publish-bcsc-form/scripts/fill_plain.py` performs rules 2, 3 and 8 via
`build_subs_afs` and `_fill_service_affidavit_blocks`; rule 4 is enforced in
both `gen.scalars.validate` and `build_subs_afs`.
