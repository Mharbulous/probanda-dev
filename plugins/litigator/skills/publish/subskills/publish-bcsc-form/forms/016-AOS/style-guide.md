# Form 16 — Affidavit of Ordinary Service

Read this guide only when the classified form is `form-16` (`AOS`).

Apply `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md`.

Prescribed by Rule 4-6(1) and enacted in its current wording by
B.C. Reg. 165/2024, Sch. 1, s. 6. `subskills/publish-bcsc-form/templates/016-aos.docx` reproduces that
prescribed text; the operative wording is not to be edited.
`form-16-official.pdf` (in the repository beside this style guide, not shipped in the plugin) is the official form as published, kept
as the drafting reference the template and the variant below are adapted from.

## When this form applies

Form 16 proves **ordinary service** — the mode defined by Rule 4-2(2), which is
available only on a person who **has provided an address for service in the
proceeding**, by leaving the document at, mailing it to, faxing it to, or
e-mailing it to that address.

If the person served has no address for service, the base form does not apply.
It also does not apply to:

- service by handing the document to the person → Form 15, `forms/015-AFS/`;
- an affidavit that says anything beyond proving service → Form 109.

Service effected under a Rule 4-4 order for an alternative method of service
(substituted service) is drafted on this form, **modified** — see the
substituted service variant below.

## Content drafting

1. **No free-form narrative.** The numbered sections are the whole document.
   Do not add paragraphs, headings, recitals, or explanation.

2. **Filed versus unfiled documents — the distinction that governs section 1:**

   > A document already filed in the proceeding is described, with its
   > court-stamp date, and is NOT exhibited — the court has it. A document not
   > filed is described AND attached as a lettered exhibit — the court has no
   > other copy.

   `filed_documents` drives the first branch, `unfiled_documents` the second.
   Either may be empty; its branch then does not appear at all. Exhibits are
   lettered A, B, C in list order.

3. **One method branch only.** Section 2's `service_method` is one of
   `leaving`, `ordinary_mail`, `fax`, or `email`, and carries its companion
   field: `service_address` for the first two (the *party's address for
   service*, not any other address), `service_fax`, or `service_email`. A
   method without its companion is refused. The unelected branches are removed —
   a filed affidavit must not show empty check-boxes.

## Template post-processing

4. **No affidavit identifier block.** Rule 22-2(3) requires the top-right
   "This is the Nth affidavit…" block on every affidavit *other than an
   affidavit of service*, and the prescribed form carries none. Do not add one,
   and do not collect `affidavit_ordinal` for this form.

5. **No exhibit page numbering.** Rule 22-2(10) likewise excepts an affidavit
   of service from sequential exhibit page numbering.

6. **No interpreter endorsement.** The prescribed form carries no Rule 22-2(7)
   endorsement. If one is genuinely needed, that is a signal the affidavit
   should be a Form 109.

6a. **Jurat left for the commissioner's stamp.** The commissioner's name is
   never printed under the jurat line — the stamp supplies it, and
   pre-printing a name constrains who can take the affidavit. No
   `commissioner_name` is collected for either service form.

7. **Video-conference commissioning.** When `sworn_by_video` is affirmative,
   both prescribed statements are included. They are rendered as the affidavit's
   **last numbered paragraphs**, because Rule 22-2(6.1)(a) requires the
   video-conference statement to appear "in its last numbered paragraph" —
   the printed form shows them unnumbered after the last numbered paragraph,
   which would not comply. Under Rule 22-2(6.1)(b) the jurat states the
   **commissioner's** city, not the deponent's, even if the deponent was
   elsewhere.

Repository enforcement: `subskills/publish-bcsc-form/scripts/fill_plain.py` performs rules 2, 3 and 7 via
`build_subs_aos` and `_fill_service_affidavit_blocks`; the method/companion
pairing is enforced in `gen.scalars.validate`.

---

# Substituted service variant

## When the variant applies

Service effected under a **Rule 4-4 order** for an alternative method of
service. The affidavit is this form, modified to match the terms of the order
and retitled **AFFIDAVIT OF SUBSTITUTED SERVICE**. Rule 22-3(1) is the
authority for the modification: a prescribed form is used "with the variations
that the circumstances of the proceeding require."

This resolves a question the repository previously left open (see
`subskills/publish-bcsc-form/forms/109-AFF/style-guide.md`): proof of substituted service was routed to
Form 109 and flagged ambiguous. It no longer is. Form 109 remains correct only
where the affidavit must depose to facts **beyond proving service** — for
example a service-attempts narrative supporting a further application.

Where the ordered method resembles personal delivery (leaving the document with
an adult at a residence), Form 15 is the closer reference skeleton; consult
`subskills/publish-bcsc-form/forms/015-AFS/style-guide.md` for its wording, but draft on this variant.

## Required input

**The entered Rule 4-4 order is mandatory.** Its terms are the source of truth
for sections 1 and 2. If the order is not supplied, halt Generate and ask for
it — do not draft from the practitioner's description of what the order said.
The `generate-subserv` sequence enforces this: `gen.order` reads the order,
echoes the extracted party → method → address hierarchy back in plain text for
confirmation, and only then are scalars collected.

## Content drafting

1. **Section 1 — documents served — mirrors the order's document list.** It
   always includes the underlying pleading (described with its court-stamp
   date) and **the entered order itself**: Rule 4-4(2) requires a copy of the
   entered order to be served with the document, unless the court otherwise
   orders or the permitted method is advertisement (Form 10, Rule 4-4(3)). The
   filed-versus-unfiled distinction of the base form governs unchanged. The
   order is added to `filed_documents` automatically from the confirmed
   extraction, and a payload with no order among the documents served is
   refused.

2. **Section 2 — method — mirrors the order's own subparagraph hierarchy.**
   The four check-box branches are replaced by:

   > (a) one lettered subparagraph per party served, in the order's party
   > order — "In respect of [name], by:";
   > (i) under each party, the ordered methods in the order's sequence;
   > each mailing address the order lists, reproduced exactly as the order
   > spells it, on its own indented lines.

   The goal is a term-by-term comparison: the practitioner holds order and
   affidavit side by side and checks compliance. The base form's "one method
   branch only" rule now applies **per method item**, not to the section — a
   party served both by e-mail and by mail deposes to both.

   A method outside Form 16's four branches (posting at an address, a message
   through a social media account) is a `custom` method rendered in the order's
   own wording. Service by advertisement is not drafted here: it is Form 10
   under Rule 4-4(3).

3. **1:1 coverage.** Every method the order requires maps to a deposed act, and
   no deposed act lacks an ordered counterpart — except acts expressly labelled
   as a courtesy, which are rendered as their own numbered paragraphs after
   section 2 ("As a courtesy, and not as a step required by the Order, I also
   served…"). The date of each act is mandatory; where every act was done on
   the same day the section 1 lead sentence carries it, and a method done on a
   different day states its own date. Time of day is optional but preferred.

4. **One transmission = one act = one exhibit.** A single e-mail sent to
   several ordered addresses at once is one act, exhibited once, covering every
   recipient. Transmission exhibits are `service_exhibits`; they are lettered
   after any exhibits attached under section 1.

## Template post-processing

5. The base form's post-processing rules 4, 5, 6, 6a and 7 apply unchanged: no
   identifier block, no exhibit page numbering, no interpreter endorsement,
   blank commissioner line, and the video-conference statements as the last
   numbered paragraphs. Because the variant inserts and drops numbered
   paragraphs, the top-level numbering is restated in document order after the
   whole body is assembled.

6. **Mirror validation.** After fill, show the practitioner the order ↔
   affidavit compliance table — one row per order term, naming the paragraph
   that deposes to it, and flagging any uncovered term. It is returned in the
   harness completion payload as `compliance_table`. **Chat only:** it is
   never written into the document.

7. **File name:** `YYYY-MM-DD AOSS [DeponentTag] re service of [docs].docx`,
   dated for the day the affidavit will be affirmed.

Repository enforcement: `subskills/publish-bcsc-form/scripts/fill_plain.py` builds the mirrored section and
the compliance table (`_fill_substituted_service_section`,
`build_compliance_table`) and refuses an uncheckable payload
(`validate_substituted_service`); `subskills/publish-bcsc-form/scripts/steps/gen/order.py` ingests the order;
`gen.scalars` collects the remaining facts and composes the file name.
