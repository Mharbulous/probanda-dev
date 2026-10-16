---
name: publish-small-claims-form
description: >
  Draft a defendant's Reply to a Notice of Claim in BC Small Claims Court and fill the official
  forms -- Form 2 (Reply) and Form 38 (Address for Service). Use for a small claims defence or
  any response to a small claims action.
---

# BC Small Claims Reply

Produces three deliverables for a defendant responding to a BC Small Claims Notice of Claim:
1. A Word document draft of the Reply (for review and signature)
2. Form 2 (Reply) — filled official PDF, ready to file
3. Form 38 (Address for Service) — filled official PDF, ready to file

**In Cowork, stop here.** In Cowork (this host grants the data tools as `mcp__remote-devices__plugin_legal_data__<name>`), stop before any tool call or file write. This step runs on the PC, in a Claude Code session in the desktop app's Code tab, where the Probanda plugin is installed, not in a Cowork cloud sandbox, which cannot see the matter or case-data folders (ADR 0026). Tell the practitioner so, and how to run it there: open a Code-tab session in their Coclerk checkout and ask for the same publish step. Do not retry or probe in Cowork.

All lawyer-facing outputs save into the Reply's Writing folder, `<draft folder>\<writing folder>\`. The draft folder is the matter's `0. DRAFT` folder (resolved by matching `0. DRAFT*`, since matters spell that folder variously; never created by the skill — if absent, stop and tell the user). `<writing folder>` is the name the caller passes, or else a `REPLY {description}` folder named by `/file-naming`'s grammar, created if absent. Nothing is saved at the top of the draft folder.

**Never overwrite.** Every Word and PDF output below (the Reply `.docx`, Form 2 and Form 38) follows the workspace output rule (`.claude/skills/shared/workspace-output-rule.md`): before saving, check whether the file name already exists in the Writing folder. If it does, save to the first free `<stem> vN<ext>` name instead (v2, v3, and so on). Never overwrite, rename or delete an existing file. Present each file under the name it was actually saved as.

## Bundled Forms

### Active assets (`subskills/publish-small-claims-form/assets/`)
Forms used directly in the standard Reply workflow — always available:
- `subskills/publish-small-claims-form/assets/scl002.pdf` — Form 2: Reply
- `subskills/publish-small-claims-form/assets/scl057.pdf` — Form 38: Address for Service

### Additional forms (`subskills/publish-small-claims-form/assets/`)
A library of BC Small Claims and Provincial Small Claims forms is bundled in `subskills/publish-small-claims-form/assets/`. **Do not load these into context proactively.** Read a form from this folder only when the user specifically asks to fill it.

### Complete Forms Index

Use this index to find the correct file. `subskills/publish-small-claims-form/assets/` = always bundled; `subskills/publish-small-claims-form/assets/` = load on demand; `—` = not bundled (send user to download link).

| Form name | Form # | File |
|-----------|--------|------|
| Acceptance of offer | SCR Form 19, SCL805 | `subskills/publish-small-claims-form/assets/scl805.pdf` |
| Acknowledgment of payment | SCL800 | `subskills/publish-small-claims-form/assets/scl800.pdf` |
| Additional page | SCL029 | — |
| Address for service | SCR Form 38, SCL057 | `subskills/publish-small-claims-form/assets/scl057.pdf` |
| Affidavit | SCL848 | `subskills/publish-small-claims-form/assets/scl848.pdf` |
| Affidavit in support of garnishing order after judgment | COEA Form B, PSC014 | `subskills/publish-small-claims-form/assets/psc014.pdf` |
| Affidavit in support of garnishing order before action | COEA Form A, SCL806 | `subskills/publish-small-claims-form/assets/scl806.pdf` |
| Affidavit in support of garnishing order/judgment | COEA Form C, PSC003 | `subskills/publish-small-claims-form/assets/psc003.pdf` |
| Affidavit of non-compliance | SCL808 | `subskills/publish-small-claims-form/assets/scl808.pdf` |
| Affidavit of service | SCL004c | `subskills/publish-small-claims-form/assets/scl004c.pdf` |
| Affidavit to cancel a dismissal or default order | SCL020 | `subskills/publish-small-claims-form/assets/scl020.pdf` |
| Agreement | SCL028 | `subskills/publish-small-claims-form/assets/scl028.pdf` |
| Application (Local Government Act) | ADM865 | `subskills/publish-small-claims-form/assets/adm865.pdf` |
| Application for default order | SCR Form 5, SCL005 | `subskills/publish-small-claims-form/assets/scl005.pdf` |
| Application for exemption | SCR Form 36, SCL055 | `subskills/publish-small-claims-form/assets/scl055.pdf` |
| Application record/order | SCL026 | `subskills/publish-small-claims-form/assets/scl026.pdf` |
| Application registration/renewal of a judgment | SCL815 | `subskills/publish-small-claims-form/assets/scl815.pdf` |
| Application to a judge — Filing Assistant | SCR Form 17, SCL017 | `subskills/publish-small-claims-form/assets/scl017.pdf` |
| Application to the registrar — Filing Assistant | SCR Form 16, SCL016 | `subskills/publish-small-claims-form/assets/scl016.pdf` |
| Certificate | SCL804 | `subskills/publish-small-claims-form/assets/scl804.pdf` |
| Certificate of amounts owing | SCL840 | `subskills/publish-small-claims-form/assets/scl840.pdf` |
| Certificate of compliance | SCR Form 37, SCL056 | `subskills/publish-small-claims-form/assets/scl056.pdf` |
| Certificate of readiness | SCR Form 7, SCL007 | `subskills/publish-small-claims-form/assets/scl007.pdf` |
| Certificate of service | SCR Form 4, SCL004f | `subskills/publish-small-claims-form/assets/scl004f.pdf` |
| Consent order | SCL021 | `subskills/publish-small-claims-form/assets/scl021.pdf` |
| Consent to act as guardian ad litem | SCL807 | `subskills/publish-small-claims-form/assets/scl807.pdf` |
| Consent to adjourn settlement conference | SCL829 | `subskills/publish-small-claims-form/assets/scl829.pdf` |
| Consent to adjourn trial conference | SCL828 | — |
| Electronic filing statement | SCR Form 28, SCL830 | `subskills/publish-small-claims-form/assets/scl830.pdf` |
| Fax cover sheet | SCR Form 20, ADM833smcl | — |
| Fee declaration | SCR Form 30, SCL833 | `subskills/publish-small-claims-form/assets/scl833.pdf` |
| Garnishing order (absolute) | COEA Form E, SCL839 | `subskills/publish-small-claims-form/assets/scl839.pdf` |
| Garnishing order (after judgment) | COEA Form D, PSC013 | `subskills/publish-small-claims-form/assets/psc013.pdf` |
| Garnishing order (before judgment) | COEA Form F, PSC002 | `subskills/publish-small-claims-form/assets/psc002.pdf` |
| Garnishment application (Federal) | GAR form | — |
| Mediation agreement | SCR Form 25, SCL044 | `subskills/publish-small-claims-form/assets/scl044.pdf` |
| Mediation compensation order | SCR Form 26, SCL827 | `subskills/publish-small-claims-form/assets/scl827.pdf` |
| Notice of claim — Filing Assistant | SCR Form 1, SCL001 | `subskills/publish-small-claims-form/assets/scl001.pdf` |
| Notice of civil resolution tribunal claim | SCR Form 34, SCL053 | `subskills/publish-small-claims-form/assets/scl053.pdf` |
| Notice of payment hearing | SCR Form 13, SCL013 | `subskills/publish-small-claims-form/assets/scl013.pdf` |
| Notice of payment out | PSC024 | `subskills/publish-small-claims-form/assets/psc024.pdf` |
| Notice of withdrawal | SCL019 | `subskills/publish-small-claims-form/assets/scl019.pdf` |
| Notice to mediate ($10,000–$35,000) | SCR Form 29, SCL832 | `subskills/publish-small-claims-form/assets/scl832.pdf` |
| Notice to the claimant | SCL025 | `subskills/publish-small-claims-form/assets/scl025.pdf` |
| Offer to settle | SCR Form 18, SCL803 | `subskills/publish-small-claims-form/assets/scl803.pdf` |
| Order | SCL809 | `subskills/publish-small-claims-form/assets/scl809.pdf` |
| Order for seizure and sale | SCR Form 11, SCL011 | `subskills/publish-small-claims-form/assets/scl011.pdf` |
| Payment order | SCR Form 10, SCL010 | `subskills/publish-small-claims-form/assets/scl010.pdf` |
| Personal information for document service by sheriff | SHS852 | `subskills/publish-small-claims-form/assets/shs852.pdf` |
| Reply — Filing Assistant | SCR Form 2, SCL002 | `subskills/publish-small-claims-form/assets/scl002.pdf` |
| Reply to third party notice | Form 3.1, SCL801 | `subskills/publish-small-claims-form/assets/scl801.pdf` |
| Request for judgment or for dismissal | SCR Form 23, SCL042 | `subskills/publish-small-claims-form/assets/scl042.pdf` |
| Request for payment out | SCL841 | `subskills/publish-small-claims-form/assets/scl841.pdf` |
| Result of mediation | SCR Form 24, SCL043 | `subskills/publish-small-claims-form/assets/scl043.pdf` |
| Statement of finances | Form 40, SCL024 | `subskills/publish-small-claims-form/assets/scl024.pdf` |
| Summary trial for financial debt cover sheet | SCL838 | `subskills/publish-small-claims-form/assets/scl838.pdf` |
| Summons to a default hearing | SCR Form 14, SCL014 | `subskills/publish-small-claims-form/assets/scl014.pdf` |
| Summons to a payment hearing | SCR Form 12, SCL012 | `subskills/publish-small-claims-form/assets/scl012.pdf` |
| Summons to witness | SCR Form 8, SCL008 | `subskills/publish-small-claims-form/assets/scl008.pdf` |
| Supporting materials cover sheet | Form 39, SCL849 | `subskills/publish-small-claims-form/assets/scl849.pdf` |
| Third party notice — Filing Assistant | SCR Form 3, SCL003 | — |
| Trial statement | SCR Form 33, SCL045 | `subskills/publish-small-claims-form/assets/scl045.pdf` |
| Verification of default | SCR Form 31, SCL834 | `subskills/publish-small-claims-form/assets/scl834.pdf` |

If the user asks to fill a form marked `—`, respond:
> "That form isn't bundled with this skill. You can download it here: https://www2.gov.bc.ca/gov/content/justice/courthouse-services/documents-forms-records/court-forms/small-claims-forms — please upload it and I'll fill it in."

## Solicitor Details (from the firm profile)

Fill every solicitor/lawyer field through `/practice-data`: the firm profile (`practice_data__firm_profile`), the matter lookup, and this machine's Roaming `Coclerk\coclerk.json` (layout owned by `/practice-data`):

| Field | Source |
|-------|--------|
| Name | the solicitor's roster entry, `name` |
| Firm | the firm profile's `firm_name` |
| Email (solicitor contact) | the solicitor's roster entry, `email` |
| Street / Suite / City / Province / Postal | split from `coclerk.json`'s `firm.address` |

**The solicitor** is an active roster entry whose `role` is `lawyer`, chosen in this order:

1. The matter's responsible lawyer, from `/practice-data`'s matter lookup, matched by name to an active `lawyer` entry. Confirm the match with the practitioner.
2. If the matter records no responsible lawyer, the entry named by the firm profile's `person` (this machine's roster key), when it is an active `lawyer`.
3. Otherwise, including a responsible lawyer who matches no active `lawyer` entry, ask the practitioner which active lawyer is the solicitor.

Never fill a solicitor field from a `staff` entry. The choice belongs to this form and is not written back.

Split `firm.address` into street, suite (if any), city, province and postal code. If the split is not unambiguous, show it to the practitioner and confirm before filling.

Never fill these fields from memory or from an earlier form. A form fill does not use the letterhead, so a null `letterhead` is not a gap. If the firm profile or its `firm_name` is missing, or a value the chosen step uses (`person` in step 2, the solicitor's `name` or `email`) is missing or empty, ask the practitioner once and write the answer back with `practice_data__upsert_firm_profile` before proceeding; a new roster entry needs every roster field. If the `firm` block is missing, ask the practitioner for its values and write them back to `coclerk.json` before proceeding.

---

## Workflow

### Step 1 — Read the Notice of Claim

The PDF is often a scanned image. Extract text with OCR:

```bash
# Convert to images
pdftoppm -r 200 "<input.pdf>" /tmp/noc_page

# OCR each page
for f in /tmp/noc_page*.ppm; do
  echo "=== $f ===" && tesseract "$f" stdout 2>/dev/null
done
```

Extract from the OCR output:
- Court file number and registry location
- Claimant name(s) and address
- Defendant name(s)
- Each factual allegation under "What Happened"
- Relief sought

### Step 2 — Clarify the Defendant's Position

Use `AskUserQuestion` to confirm the defendant's position on each material allegation. Base questions on what was actually alleged — not generic prompts.

Structure: one question per major disputed fact, with options such as "Deny entirely," "Admit in part," or a specific factual alternative. Always include a question on whether the defendant wants to include a counterclaim.

If there are more than 4 material disputes, use two rounds of AskUserQuestion.

### Step 3 — Draft the Word Reply

Read the `docx` skill's SKILL.md, then produce a Word document with:

**Header block:**
- Court: "PROVINCIAL COURT OF BRITISH COLUMBIA — SMALL CLAIMS DIVISION"
- Registry location and court file number
- Parties
- Title: "REPLY OF THE DEFENDANT"

**Body:**
- **Part 1 — Disagreement:** Defendant disagrees with the claim in its entirety (or in part, as applicable). State clearly which allegations are denied.
- **Part 2 — Reason for Disagreement:** Numbered paragraphs, one per disputed allegation. Each paragraph states the defendant's version of events for that allegation.
- **Part 3 — Counterclaim** *(include only if instructed)*: State the nature of the counterclaim, facts relied on, and relief sought.

**Signature block:**
- Date
- Defendant's name (printed)
- Signature line

Save as `Reply_[Defendant]_[FileNumber].docx` in the Writing folder. First check the name in a separate call and read the result: if taken, even by another session, save at the next free ` vN` name.

### Step 4 — Fill Form 2 (Reply)

Use `subskills/publish-small-claims-form/assets/scl002.pdf`. Fill via pypdf annotation walking — do NOT use `update_page_form_field_values` (it fails on button fields).

**Known field names for scl002.pdf:**

| Field | Content |
|-------|---------|
| `cfn` | Court file number |
| `location` | Registry location |
| `claimant` | Claimant name(s) |
| `defendant` | Defendant name(s) |
| `from` | Defendant's name (filer) |
| `part1` to `part5` | Dispute narrative (sections a-e) |
| `party` | Defendant's name |
| `amount` | Amount in dispute (if applicable) |
| `schedule3` | Additional reasons / continuation |
| `rebuttle` | Rebuttal to claimant's evidence |
| `Check Box1` | Checkbox: disagrees with claim |
| `cb2` | Checkbox: counterclaim |
| `pages` | Number of additional pages |
| `parta` / `amounta` | Counterclaim item A and amount |
| `partb` / `amountb` | Counterclaim item B and amount |
| `partc` / `amountc` | Counterclaim item C and amount |
| `filing fee` | Filing fee amount |
| `ca` | Total counterclaim amount |

**Fill pattern (pypdf):**

```python
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, create_string_object, BooleanObject

reader = PdfReader("subskills/publish-small-claims-form/assets/scl002.pdf")
writer = PdfWriter()
writer.append(reader)

text_values = {
    "cfn": court_file_number,
    "location": registry,
    "claimant": claimant_name,
    "defendant": defendant_name,
    "from": defendant_name,
    "part1": dispute_text,
    # ... remaining fields
}

checkbox_fields = {"Check Box1"}  # add "cb2" if counterclaim

for page in writer.pages:
    if "/Annots" not in page:
        continue
    for annot_ref in page["/Annots"]:
        annot = annot_ref.get_object()
        t = str(annot.get("/T", ""))
        ft = str(annot.get("/FT", ""))
        if ft == "/Tx" and t in text_values:
            annot.update({NameObject("/V"): create_string_object(text_values[t])})
            if "/AP" in annot:
                del annot["/AP"]
        elif ft == "/Btn" and t in checkbox_fields:
            annot.update({
                NameObject("/V"): NameObject("/Yes"),
                NameObject("/AS"): NameObject("/Yes"),
            })
            if "/AP" in annot:
                del annot["/AP"]

root = writer._root_object
acroform = root["/AcroForm"].get_object()
acroform.update({NameObject("/NeedAppearances"): BooleanObject(True)})
for field_ref in acroform.get("/Fields", []):
    field = field_ref.get_object()
    t = str(field.get("/T", ""))
    ft = str(field.get("/FT", ""))
    if ft == "/Tx" and t in text_values:
        field.update({NameObject("/V"): create_string_object(text_values[t])})

def next_free_path(path):
    """path if unused, else the first unused "<stem> vN<ext>" sibling."""
    path, n = Path(path), 1
    candidate = path
    while candidate.exists():
        n += 1
        candidate = path.with_name(f"{path.stem} v{n}{path.suffix}")
    return candidate

output_path = next_free_path(output_path)  # never overwrite an earlier form
with open(output_path, "wb") as f:
    writer.write(f)
```

Save as `Reply_Form_[Defendant]_[FileNumber].pdf`, with `output_path` resolved through `next_free_path` as above.

### Step 5 — Fill Form 38 (Address for Service)

Use `subskills/publish-small-claims-form/assets/scl057.pdf`. Apply the same pypdf annotation-walking pattern.

**Known field names for scl057.pdf:**

| Field | Content |
|-------|---------|
| `1` | Court file number |
| `2` | Registry location |
| `3` | Claimant name(s) |
| `4` | Defendant name(s) |
| `7` | Filer's name (solicitor or party) |
| `8` | Checkbox: service by email |
| `9` | Email address |
| `10` | Checkbox: service by mail |
| `11` | Street address |
| `12` | Suite / unit |
| `14` | City |
| `15` | Province |
| `16` | Postal code |
| `18` | Checkbox: delivery address same as mailing address |
| `28` | Date (DD/Mon/YYYY format) |
| `29` | Print name |

When the firm is the address for service, use the configured solicitor details above, with `firm.email` as the service e-mail. Check `10` (mail), and check `8` (email) only when `firm.email` is non-empty. Set `18` if delivery address is the same as mailing.

Save as `AddressForService_[Defendant]_[FileNumber].pdf`, with the output path resolved through `next_free_path` as in Step 4.

### Step 6 — Deliver Outputs

Present all three files to the user, each under the name it was saved as (a ` vN` suffix where an earlier file held the name):
1. `Reply_[Defendant]_[FileNumber].docx` — Word draft for review and signature
2. `Reply_Form_[Defendant]_[FileNumber].pdf` — Form 2, ready to file
3. `AddressForService_[Defendant]_[FileNumber].pdf` — Form 38, ready to file

Remind the user that Form 2 must be filed within **14 days** of being served with the Notice of Claim (or such other deadline as stamped on the Notice). Advise them to check the filing deadline on the Notice of Claim itself.
