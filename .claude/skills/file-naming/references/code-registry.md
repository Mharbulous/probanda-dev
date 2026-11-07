# Code registry (single source of truth)

All firm-standard file naming codes. One entry per code. Subagents: look up
codes here; your folder-notes file tells you which codes your folder typically
uses and how to handle edge cases.

## Rules

- `.eml` and `.msg` files are emails — their delivery code must always start
  with `E`. Use `ELT` not `LET` on a .msg; `ELF` not `LEF` on a .msg. The
  `L`-first variants (`LET`, `LEF`) are correct only on .pdf copies of the
  letter itself. An email that only passed among the firm's own staff has no
  delivery to name: it takes `IE` instead.
- When a code includes `#` followed by a number (e.g. `INV#7413`, `CHQ#873`),
  the `#` is part of the code and must not be stripped. No space between `#`
  and the number.
- New codes are derived per **Building a multi-word code** in
  `general-conventions.md`, including its collision rule. Codes are unique:
  one code, one meaning.

---

## Delivery / direction codes

Building blocks: L = letter, E = emailed, U = uploaded, F = fax, C = courier,
M = mailed, R = registered mail. Suffix F = from (incoming), T = to (outgoing).
Order of letters = order of sending. When the document itself states an
explicit multi-method transmittal order (e.g. a "By Fax" line printed above a
"By Email" line), build the code to match that stated order literally — even
if the same wording recurs across other letters from the same author. A
recurring template line still describes how that sender actually transmits
its letters unless the document says otherwise, so don't discount it as
"probably just boilerplate."

### Incoming

| Code | Meaning | Typical folders |
|---|---|---|
| `LF` | Letter from (unknown delivery) | 2, 3 |
| `LMF` | Letter from (envelope scanned) | 3 |
| `EF` | Email from (no attached letter) | 2, 3 |
| `LEF` | Letter emailed from (letter attached) | 2, 3 |
| `ELF` | Email letter from (letter received by email) | 3 |
| `FF` | Fax from (no cover letter) | 3 |
| `LFF` | Letter faxed from | 3 |
| `RF` | Registered mail from | 3 |
| `LRF` | Registered mail from (letter scanned) | 3 |
| `HF` | By hand from | 2, 3 |
| `LHF` | Letter by hand from (process server) | 3 |
| `EMF` | Email & mailed from (no letter) | 3 |
| `LEFF` | Letter, email & faxed from (letter's transmittal line states email before fax) | 3 |
| `LFEF` | Letter, faxed & emailed from (letter's transmittal line states fax before email) | 3 |
| `EFF` | Email & fax from | 3 |
| `EFMF` | Email & fax & mailed from | 3 |
| `EFRF` | Email & fax & registered mail from | 3 |
| `FLF` | Faxed letter from (letter received by fax) | 3 |
| `FRF` | Fax & registered mail from | 3 |
| `LEFMF` | Letter, email & fax & mailed from | 3 |
| `CF` | Courier from (no cover letter) | 3 |
| `LCF` | Letter couriered from (incoming courier delivery) | 3 |

Note — `LEFF` vs `LFEF`: not interchangeable, and neither is the "closest
match" for the other. Per the order-of-sending rule above, the letter itself
decides which one applies — read its own transmittal line (e.g. which of "By
Fax" / "By Email" is printed first) rather than defaulting to `LEFF`.

### Outgoing

| Code | Meaning | Typical folders |
|---|---|---|
| `LT` | Letter mail to (no envelope scanned) | 2, 3 |
| `ET` | Email to (email only) | 2, 3 |
| `ELT` | Emailed first, original letter mailed to follow | 2, 3 |
| `LET` | Letter emailed to (letter sent first, then emailed) | 2, 3 |
| `EFT` | Email & fax to | 3 |
| `LEFT` | Letter, email & fax to | 3 |
| `EFRT` | Email & fax & registered mail to | 3 |
| `LCT` | Letter couriered to | 3 |
| `LFT` | Letter faxed to | 3 |
| `FT` | Fax to (no cover letter) | 3 |
| `FRT` | Fax & registered mail to (no letter) | 3 |
| `LRT` | Letter, registered mail to | 3 |
| `RLT` | Registered mail letter to (Canada Post) | 3 |
| `RT` | Registered mail to (no tracking info) | 3 |
| `HT` | By hand to (e.g. process server) | 2, 3 |
| `UP` | Uploaded by cloud | 2, 3 |
| `LEUFCHT` | Letter, emailed, uploaded, faxed, couriered and hand-delivered to | 3 |

---

## Court document codes

### Pleadings

| Code | Meaning | Typical folders |
|---|---|---|
| `NOCC` | Notice of Civil Claim (BC Supreme Court) | 5 |
| `SCNOC` | Notice of Claim (BC Provincial Court, Small Claims) | 5 |
| `RNOCC` | Response to Civil Claim | 5 |
| `CC` | Counterclaim | 5 |
| `RCC` | Response to Counterclaim | 5 |
| `3PN` | Third Party Notice | 5 |
| `RT3PN` | Response to Third Party Notice | 5 |
| `REPLY` | Reply | 5 |
| `PET` | Petition | 5 |
| `RTP` | Response to Petition | 5 |

Note — amended pleadings: an amended pleading keeps the code of the pleading
it amends, and the amendment word the document's own title uses ("amended",
"further amended", "re-amended") is the first word of the subject. No separate
code exists for an amended version, so a search on the code finds every
version. Its date is the court stamp on the amended filing.
Example: an Amended Response to Civil Claim filed 2024-06-11 →
`2024-06-11 RNOCC SmithJ amended FILED.pdf`.

### Affidavits and service

| Code | Meaning | Typical folders |
|---|---|---|
| `AFF#` | Regular affidavit (# = sequential number, e.g. AFF1, AFF2) | 5 |
| `AFFPS` | Affidavit of personal service (service completed) | 5 |
| `AAPS` | Affidavit of Attempted Personal Service (service attempted, not completed) | 5 |
| `AFFOS` | Affidavit of ordinary service | 5 |
| `AOS` | Affidavit of Service (generic) | 5 |
| `AOD` | Affidavit of delivery | 5 |

### Notices and applications

| Code | Meaning | Typical folders |
|---|---|---|
| `APPEAL` | Notice of Appeal (BC Court of Appeal Form 1) | 5 |
| `NACL` | Notice of Appointment or Change of Lawyer (BC Supreme Court Form 110; Rule 22-6) | 5 |
| `NOA` | Notice of application | 5 |
| `NOAFS` | Notice of address for service | 5 |
| `NOAIP` | Notice of intent to act in person | 5 |
| `NOAPR` | Notice of Appearance (BC Court of Appeal Form 2) | 5 |
| `NOCOA` | Notice of change of address | 5 |
| `NOD` | Notice of discontinuance | 5 |
| `DISPUTE` | Notice of Dispute (Wills Variation Act / estate — Rule 25-10(3); opposes issuance of a grant of probate/administration) | 5 |
| `GRANT` | Grant of probate or administration (BC Supreme Court Form P19) | 4, 6 |
| `NOH` | Notice of hearing | 5 |
| `NOITW` | Notice of intent to withdraw as lawyer | 5 |
| `NIP` | Notice of Intention to Proceed (Rule 22-7(7); signals intent to proceed after inactivity) | 5 |
| `NOT` | Notice of trial | 5 |
| `NOWOL` | Notice of withdrawal of lawyer | 5 |
| `NTA` | Notice to admit | 5, 7 |
| `NTC` | Notice to commence | 5 |
| `NTM` | Notice to mediate | 5 |
| `NTW` | Notice to withdraw | 5 |

Note — `NOD` vs `DISPUTE`: `NOD` = Notice of Discontinuance (ends a
proceeding); `DISPUTE` = Notice of Dispute (opposes a grant of
probate/administration in an estate matter). They are not interchangeable.

Note — `NOA` vs `APPEAL`: `NOA` = Notice of Application (chambers application
in an existing proceeding); `APPEAL` = Notice of Appeal (starts an appeal in
the Court of Appeal). Never use `NOA` for an appeal.

Note — `NACL` vs `NOWOL` / `NOAIP` / `NOITW`: `NACL` = a new or changed lawyer
of record; `NOWOL` = a lawyer's withdrawal with no replacement (the party
becomes self-represented at its Rule 4-2(7) last-known address); `NOAIP` = the
party's own notice that it will act in person; `NOITW` = a lawyer's *intention*
to withdraw, which changes nothing until the withdrawal is filed or ordered.

### Orders and judgments

| Code | Meaning | Typical folders |
|---|---|---|
| `ORDR` | Order | 5 |
| `CO` | Consent order | 5 |
| `CDO` | Consent dismissal order | 5 |
| `DJ` | Default judgment | 5 |
| `COJ` | Certificate of judgment | 5 |
| `RFJ` | Reasons for Judgment (oral or written) | 5 |

Note — `RFJ` vs `ORDR`: `RFJ` = the court's reasons; `ORDR` = the formal
entered order that follows. Both may exist for one decision. Oral reasons take
`RFJ` too — say "oral reasons" or "transcript" in the subject if it matters.

### Other court documents

| Code | Meaning | Typical folders |
|---|---|---|
| `AFS` | Address for service | 5 |
| `APPT` | Appointment | 5 |
| `AR` | Application response | 5 |
| `CHR` | Application record / chambers record | 5 |
| `CPL` | Certificate of pending litigation | 5 |
| `CPP` | Case planning proposal | 5 |
| `CRT` | Civil Resolution Tribunal | 5 |
| `CVP` | Cover page | 5 |
| `DFP` | Demand for particulars | 5 |
| `EFS` | Electronic Filing Statement (BC Supreme Court e-filing cover) | 5 |
| `FACTUM` | Factum (BC Court of Appeal) | 5 |
| `GNR` | Garnishee's response (filed with court registry) | 5 |
| `RGN` | Registrar's notice | 5 |
| `REQ` | Requisition | 5 |
| `RTDFP` | Reply to demand for particulars | 5 |
| `RTNTA` | Reply to notice to admit | 5, 7 |
| `TB` | Trial brief | 5, 8 |
| `XFD` / `EFD` | Examination for discovery | 5, 7 |

---

## Discovery codes

| Code | Meaning | Typical folders |
|---|---|---|
| `LOD` | List of Documents (Rule 7-1; append #1, #2 for sequence) | 7 |

(Note: `NTA`, `RTNTA`, `XFD`/`EFD` are listed under Court document codes with typical folder 5, 7.)

---

## Accounting codes

| Code | Meaning | Typical folders |
|---|---|---|
| `RCPT` | Receipt | 2, 9 |
| `INV#` | Invoice # (firm's account to client; # = invoice number) | 2, 9 |
| `STMT` | Statement of account | 2, 9 |
| `CHQ#` | Cheque # (# = cheque number; for void cheques use `CHQ#VOID`) | 2, 9 |
| `INTERAC` | Interac e-Transfer | 2, 9 |
| `DEP` | Trust deposit | 2, 9 |
| `CASH` | Cash (scanned) | 9 |
| `DTP` | Direction to Pay (client's signed instruction to disburse trust funds) | 2, 9 |

---

## Intake / onboarding codes

| Code | Meaning | Typical folders |
|---|---|---|
| `ICCF` | Identification & Conflict Check Form (LSBC client ID & conflict check) | 2 |
| `ID` | Government-issued client identification scan (BCID, driver's licence, passport) | 2 |
| `CCARD` | Credit/payment card scan kept on file (distinct from a government ID scan) | 2 |
| `CCS` | Casemap Conflict Search with no approval stamp | 2 |
| `CONF` | Casemap Conflict Search bearing the supervising lawyer's approval stamp | 2 |
| `RET` | Retainer / engagement agreement (signed retainer letter or engagement contract) | 2 |

Note — `CCS` vs `CONF`: the approval is a green stamp reading "APPROVED / By
<name> at <time>, <date>". Nothing else marks it: no initials, no sign-off
page. The stamp sits on the rendered page, not in the text layer, so extracted
text never shows it. Look at each page image. Its position varies: below the
results on some printouts, top right over the summary on others. On a
printout of more than one page, check every page, not only the last. A stamp
anywhere → `CONF`. No stamp on any page → `CCS`.

---

## Internal work-product codes

| Code | Meaning | Typical folders |
|---|---|---|
| `MT` | Memorandum to (named person) | 4 |
| `MTF` | Memo to file | 2, 4 |
| `IE` | Internal email: an email or chain among the firm's own staff only (no client or outside party on it) | 2 |
| `ML` | Memorandum of law (firm-authored research memo) | 4, 6 |
| `Notes` | Notes | 2, 4 |
| `SRCH` | Title search | 4 |
| `MORTGAGE` | LTO registered charge instrument, full copy (e.g. a Land Title Act Form B mortgage) — distinct from SRCH, which is the title search print, not the charge instrument itself | 4 |
| `SMRY` | Corporate summary | 4 |
| `NOCD` | Notice of Change of Directors (BC Form 10) | 4 |
| `REQUEST` | Skip-trace / investigative request or listing form sent to a third-party vendor | 4 |
| `SUBSHT` | Submission sheet (Court Services Online) — save in `4. LAWYER BRIEF/CSO/`; name as `SUBSHT re PKG <id> <code>` | 4/CSO |
| `REJN` | CSO Registry rejection notice (electronic notice that a filing was rejected) — save in `4. LAWYER BRIEF/CSO/`; name as `REJN re PKG <id> <code>`; pair with matching RCPT in disbursements | 4/CSO |
| `RPT` | Expert report (opinion from a retained expert witness) | 2, 4 |
| `AGMT` | Signed third-party contract/agreement central to the litigation | 4 |
| `RMA` | Rental/property management agreement (specific AGMT subtype) | 4 |
| `LTSANOR` | myLTSA Notice of Receipt / Notice of Registration (system-generated) | 4 |
| `LTSAREL` | LTSA charge release/discharge (Land Title Act Form C Release) | 4 |
| `CALCN` | Financial model / damages calculation (interest, quantum) | 4 |

---

## Expert and witness codes

| Code | Meaning | Typical folders |
|---|---|---|
| `WSS` | Will-say / will-state statement | 7, 8 |
| `CHRON` | Chronology of events | 4, 7 |
| `SCR` | Settlement conference record / submission | 4 |

---

## Evidence and discovery codes (exhibits / disclosure)

| Code | Meaning | Typical folders |
|---|---|---|
| `VR` | Veterinary or medical record | 7 |
| `RAD` | Radiograph / X-ray | 7 |
| `PHO` | Photograph | 7 |
| `CNSNT` | Signed consent or authorization form | 7 |
| `BUNDLE` | Single PDF combining multiple distinct documents — use as the CODE component; describe contents in subject | any |

---

## Deprecated / synonym codes

| Legacy code | Canonical replacement | Notes |
|---|---|---|
| `BILL#` | `INV#` | Common legacy synonym for invoice |
| `RTCC` | `RNOCC` | Informal shorthand; rename to RNOCC |
| `SLIP` | `DEP` | Deprecated trust deposit slip code |
| `PAY` | *(manual review)* | Deprecated trust payment code |
| `NOP` | `NIP` | Former code for Notice of Intention to Proceed; use NIP |
| `OMAA` | `ORDR` | Order Made After Application; use ORDR whenever OMAA is encountered |
