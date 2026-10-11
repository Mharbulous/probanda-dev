# Routing Validation -- Expected Outcomes (v2)

Run these checks before merging any registry or harness change. For each prompt, verify the classification pipeline selects the correct sequence and step IDs.

Automated coverage of the Form 16 substituted-service variant (routing, rendering, refusals, mirror validation) lives in `tests/test_subserv.py`: `python tests/test_subserv.py`.

## Registry <-> File System Integrity

No REGISTRY entry carries a `workflow` field and no `forms/<name>/workflow.md`
exists on disk. The one that did -- Form 62's -- retired with the bill-of-costs
chain; a bill of costs is now `/calculate` then `/publish` with `publish-boc`.

## Representative Prompt -> Expected Route (v2)

| Prompt | Expected sequence | Classification path |
|--------|------------------|---------------------|
| "Draft a notice of application for [matter]" | `full` (gen -> draft -> asm) | classify: regular, form-32, none -> full |
| "Draft an NOA -- use the case data for facts" | `full` | classify: regular, form-32, none -> full |
| "Just give me a blank NOA form for [matter]" | `generate` | classify: regular, form-32, generate |
| "Fill out the NOA header for [matter]" | `generate` | classify: regular, form-32, generate |
| "Draft the substance for the [matter] NOA" | `draft` | classify: regular, form-32, draft |
| "Draft Parts 2 and 3 for my NOA" | `draft` | classify: regular, form-32, draft |
| "Assemble the NOA with the substance I've drafted" | `assemble` | classify: regular, form-32, assemble |
| "Merge my substance into the NOA form" | `assemble` | classify: regular, form-32, assemble |
| "Assemble this form-33.md into Form 33" | `asm33` | classify: regular, form-33, assemble -> asm33 |
| "Draft a petition for [matter]" | `full` | classify: regular, form-66, none -> full |
| "Generate a blank petition for [matter]" | `generate` | classify: regular, form-66, generate |
| "Draft an offer to settle costs" | `generate` | classify: regular, form-123 (generate_only) -> generate |
| "Draft a notice of civil claim for [matter]" | `full` | classify: regular, form-1, none -> full |
| "Draft an NOCC for [matter]" | `full` | classify: regular, form-1, none -> full |
| "Draft a response to counterclaim for [matter]" | `full` | classify: regular, form-4, none -> full |
| "Prepare a general requisition in Form 17" | `generate` | classify: regular, form-17 (generate_only) -> generate |
| "Prepare a default judgment in Form 8" | `generate` | classify: regular, form-8 (generate_only) -> generate |
| "Amend the NOCC for [matter]" | `amend` | classify: amend (short-circuit) |
| "I need to amend a pleading" | `amend` | classify: amend (short-circuit) |
| "Rule 6-1 amendment to the statement of defence" | `amend` | classify: amend (short-circuit) |
| "Amend the response to civil claim" | `amend` | classify: amend (short-circuit) |
| "Convert this LEAP template to bracket format" | `new-template` | classify: new-template (short-circuit) |
| "Draft an affidavit for [matter]" | `generate` | classify: regular, affidavit (generate_only) -> generate |
| "Prepare a blank affidavit for [deponent]" | `generate` | classify: regular, affidavit (generate_only) -> generate |
| "Fill out the affidavit header for [matter]" | `generate` | classify: regular, affidavit (generate_only) -> generate |
| "Draft an affidavit of personal service" | `generate` | classify: regular, form-15 (generate_only) -> generate |
| "Affidavit of service -- I handed it to him myself" | `generate` | classify: regular, form-15 (generate_only) -> generate |
| "Draft an affidavit of ordinary service" | `generate` | classify: regular, form-16 (generate_only) -> generate |
| "Affidavit of service -- we e-mailed it to their address for service" | `generate` | classify: regular, form-16 (generate_only) -> generate |
| "Draft an affidavit of service" | *(none -- halts)* | classify: ambiguous -> `ask_user` with `route_to: classify`; answer goes to `clarify`, never a filled form |
| "Draft an affidavit of substituted service" | `generate-subserv` | classify: regular, form-16, service_mode substituted -> generate-subserv |
| "Affidavit proving service under the substituted service order" | `generate-subserv` | classify: regular, form-16, service_mode substituted (not ambiguous -- the routing is settled) |
| "Affidavit of service -- we served by email and mail per the order" | `generate-subserv` | classify: regular, form-16, service_mode substituted |
| "Affidavit re service attempts and the substituted service application" | `generate` | classify: regular, affidavit (Form 109 -- says more than proving service) |
| "I have a new form export from LEAP" | `new-template` | classify: new-template (short-circuit) |

## Sequence -> Step ID Verification

Each sequence key in SEQUENCES must resolve to existing step modules:

| Sequence | Step IDs | All modules exist? |
|----------|----------|-------------------|
| `generate` | gen.matter_profile, gen.scalars, gen.fill, shared.verify | YES |
| `generate-subserv` | gen.matter_profile, gen.order, gen.scalars, gen.fill, shared.verify | YES |
| `draft` | draft.part1, draft.part2, draft.part3, draft.part4 | YES |
| `assemble` | asm.locate_inputs, asm.assemble_body, asm.fill, shared.verify | YES |
| `asm33` | asm33.locate, asm33.validate, asm33.transform, asm33.fill, shared.verify | YES |
| `asmaff` | asmaff.locate, gen.matter_profile, gen.scalars, asmaff.fill, shared.verify | YES |
| `full` | (generate + draft + assemble steps) | YES |
| `amend` | amend.identify, amend.propose, amend.spec, amend.run | YES |
| `new-template` | nt.inspect_tmpl, nt.configure, nt.convert, nt.validate | YES |

## Template Asset Verification

Each REGISTRY entry's `template` field must point to an existing file:

| Template | Exists? |
|----------|---------|
| `templates/032-noa.dotx` | YES |
| `templates/066-petition.dotx` | YES |
| `templates/123-otsc.dotx` | YES |
| `templates/001-nocc.dotx` | YES |
| `templates/004-rtc.dotx` | YES |
| `templates/015-afs.docx` | YES |
| `templates/016-aos.docx` | YES |
| `templates/form-17.docx` | YES |
| `templates/form-8.docx` | YES |
| `templates/affidavit.dotx` | YES |
| `templates/form-33.dotx` | YES |

## Trigger Eval Target

On description changes, run representative prompts against the skill matcher. Target: >=90% routed to `/publish` with `publish-bcsc-form`. Key risk phrases that must trigger this skill:
- "notice of application"
- "petition to the court"
- "offer to settle costs"
- "amend a pleading"
- "amend the NOCC"
- "Rule 6-1 amendment"
- "amended pleading"
- "blank form"
- "affidavit" / "draft an affidavit"
- "affidavit of service"
- "affidavit of personal service" / "Form 15"
- "affidavit of ordinary service" / "Form 16"
- "affidavit of substituted service" / "AOSS"
- "proof of service under a substituted service order" / "Rule 4-4 service affidavit"
- "draft substance"
- "assemble form"
