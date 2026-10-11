---
name: publish-notice-to-admit
description: >
  Draft and verify a BC Supreme Court Notice to Admit under Rule 7-7 in prescribed Form 26,
  including requested admissions of fact, document-authenticity requests, and attached copies.
  Use whenever a practitioner asks to prepare, revise, check, or assemble a notice to admit,
  even if they mention only Rule 7-7, admissions, authenticity, or Form 26.
---

# Draft Notice to Admit

Prepare one lawyer-review draft. The practitioner chooses the admissions sought; this skill
checks transcription, file consistency, prescribed wording, and assembly without silently
turning a proposed admission into an established fact.

**In Cowork, stop here.** In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_probanda_data__<name>`), stop before any tool call or file write.
This step runs on the PC, in a Claude Code session in the desktop app's Code tab, where the
Probanda plugin is installed, not in a Cowork cloud sandbox, which cannot see the matter or
case-data folders (ADR 0026). Tell the practitioner so, and how to run it there: open a Code-tab
session in their Coclerk checkout and ask for the same publish step. Do not retry or probe in
Cowork.

## Boundaries

- British Columbia Supreme Court civil actions only: Rule 7-7 and Form 26.
- Use `/case-data` for matter facts, parties, proceedings, and evidence. Keep database details
  inside that gatekeeper.
- Do not contact the client or opposing party.
- Do not decide that a disputed fact is true merely because the notice requests its admission.
- Do not research law unless the practitioner asks a separate legal question. The prescribed
  wording and layout are locked in `references/form-26.md`.
- Read the host `docx` skill after the admissions are settled and before rendering. Read the
  host `pdf` skill before assembling attached document copies.

## 1. Resolve the matter and inputs

Identify the matter from the attached workspace; fail visibly if more than one matter could
match. Collect:

- serving party, receiving party, and their litigation roles;
- proposed numbered facts;
- each document whose authenticity is requested and the exact copy to attach;
- signature date, signer name, and whether the signer is the party or lawyer.

Treat practitioner wording as proposed content, not as proof. Preserve a supplied quotation
verbatim until its source has been checked.
When revising an existing notice, do not substantively change previously approved facts unless
the practitioner instructs you to do so.

## 2. Run one bounded verification pass

Make one consolidated `/case-data` request for the proceeding profile, party roles, and records
material to the proposed admissions. Read every source document the practitioner cites. If
that pass exposes a concrete conflict, read only the single best obvious primary matter file
needed to state the conflict accurately, then stop searching.

Classify every proposed fact:

| Status | Meaning | Action |
|---|---|---|
| `verified wording` | The cited source supports the names, roles, date, amount, or quotation | Use the checked wording |
| `contradicted` | A matter source directly conflicts with the proposal | Hard gate; show both versions and obtain the practitioner's choice |
| `not independently corroborated` | The bounded pass found neither support nor contradiction | Explain the missing support and obtain express confirmation before finalizing |
| `practitioner-confirmed` | The practitioner directs inclusion after seeing the conflict or gap | Use the directed wording and record that confirmation in working notes |

Do not broaden an inconclusive search. A Notice to Admit may deliberately request admission of
a disputed fact; the stopping rule protects against transcription and identity errors, not
against disagreement. Ask once in a compact table covering all unresolved items.

For quoted contract or correspondence text, compare against the source character-for-character,
including curly quotation marks, non-ASCII hyphens, capitalization, punctuation, and source
typos. Do not add `[sic]`, italics, quotation marks, or normalized punctuation unless the
source or practitioner requires them.

## 3. Verify authenticity requests

For each requested document:

1. Confirm the exact file exists and is readable.
2. Check its visible date, author/sender, recipient, and document type against the proposed
   description; surface any mismatch.
3. Compute and retain its SHA-256 hash in working notes so the attached copy is the checked copy.
4. Use a neutral numbered description. Do not assert delivery, receipt, address status, or
   authenticity beyond the practitioner's confirmed wording.

Rule 7-7 requires copies of specified documents to accompany the notice unless an exception is
confirmed. Do not deliver a package with a listed document missing.

## 4. Build the canonical draft

Read `references/form-26.md`. Create a working Markdown record in
`<case-data folder>\publish-notice-to-admit\` containing the matter identity, verification table,
final facts, document list, attachment hashes, and practitioner confirmations, and rewrite it in
place on each run. The case-data folder is the one `coclerk.json`'s `case_data_dir` names; it
must already exist (if not, stop and name `/case-data` initialize; never create it). Keep that
record out of the filed document.

Render the lawyer-facing DOCX at the top of the draft folder as `<stem>.docx`: the draft folder
is the one folder matching `0. DRAFT*` under the matter (never created; none or more than one
fails loudly). Compose the stem from the notice under `/file-naming`'s grammar (no ` vN`, no
extension) and run its gate on it. On a fail, or a date or code you cannot pin down, ask the
practitioner; never fall back to the title. Never overwrite an existing draft: check the name in a
separate call and read the result first. If taken, even by another session, write the next ` vN`
(one above the highest copy present), and report the copy passed over as `versioned_from`. Use the
prescribed text exactly and preserve this order:

1. form citation and style of proceeding;
2. `NOTICE TO ADMIT` and Rule 22-3 line;
3. addressee, `TAKE NOTICE`, and `AND TAKE NOTICE` paragraphs;
4. date/signature block;
5. numbered facts;
6. numbered authenticity requests.

Do not introduce `PART 1` or `PART 2` headings. Keep the date/signature block immediately after
the deemed-admission paragraph. Extracts inherit their source typography; they are not italicized
merely because they are extracts.

When documents are listed, assemble a lawyer-review PDF package in the same order: Notice to
Admit, then each exact checked copy. A schedule cover page may identify an attachment, but must
not alter the attached source. Save it beside the DOCX at the top of the draft folder as
`<stem>.pdf`, never overwriting: by the same separate-call check, a taken name gets the next
` vN`, with `versioned_from` reported.

## 5. Verify before delivery

Perform all checks below against the actual output:

- Extract DOCX text and compare both prescribed notice paragraphs with
  `references/form-26.md` exactly.
- Compare each source quotation character-for-character with the checked source.
- Render every DOCX page and visually confirm the form citation, active style of proceeding,
  date/signature placement, single-spaced signature labels, numbered sections, and page flow.
- Confirm there are no `PART 1`/`PART 2` headings, stray quotation marks, unintended italics,
  malformed full-width signature rules, or duplicate signature blocks.
- Confirm every listed document is attached once, in list order, and its SHA-256 matches the
  checked copy.
- Confirm no unresolved `contradicted` or `not independently corroborated` item remains without
  recorded practitioner confirmation.

If any check fails, correct the working draft and rerun the complete verification set. Deliver
only the DOCX, the assembled PDF package when documents are requested, and a concise list of
confirmed deviations or unresolved review points.
