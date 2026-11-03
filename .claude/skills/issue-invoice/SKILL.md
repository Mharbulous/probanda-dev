---
name: issue-invoice
disable-model-invocation: true
description: "Use when the practitioner says a draft invoice from /bill-client is signed and types /issue-invoice: records the signed invoice as issued, locks its lines and time entries, writes the frozen copy of what supports each line, and saves a draft email to accounting about trust. Also records when the invoice went out. Sends nothing and moves no trust money."
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# /issue-invoice

Runs only on the practitioner's word that the invoice is signed. It sends nothing and moves no trust money.

It needs `<matter-data folder>\vet-billable-time\line_map.json`, the record the bill's time work left. Without that file, say the invoice was not built from vetted time, so it cannot be issued with its support, and stop. Run scripts with the host Python (`python`; if that is the WindowsApps stub, the interpreter `COCLERK_PYTHON` names).

## Steps

1. **Read the signed invoice.** Call `pdf_pages__images` first: read a `scanned` page only from its PNGs and a `born_digital` page with `Read` `pages:`. Confirm it bears a lawyer's signature. Take the invoice number, date, total and taxes from the document, never from the file name. Take `date_to` from the latest date in the line map.

2. **Freeze the record.** Write `<matter-data folder>\issue-invoice\meta.json` as `scripts/freeze_invoice.py`'s docstring says, with any trust amount the invoice states as `trust_application`: the balance before from `practice_data__trust_summary`, the amount applied, and the balance after. Run `bill-client/scripts/freeze_invoice.py` with `--out-dir` the matter's draft folder's `BILLING` subfolder and `--data-dir` the same working folder, and `--disbursements` the disbursements file if the bill has one. A refusal stops this skill: tell the practitioner what it says. A total that does not tie means the signed invoice differs from the vetted time, and the practitioner decides what to correct.

3. **Issue it.** Call `practice_data__issue_invoice` with the matter, the figures from step 1, and the signed copy's path and the snapshot's path and hash the script printed, with `records_file` its `issue_records.json`. This is one-way, so it passes only on the practitioner's approval. If the cloud answers with a question, relay it and stop.

4. **Draft the trust instruction.** If the invoice states trust applied, draft one email to accounting with `mail__save_draft`, stating the invoice number, the amount and the balances from step 2. Ask once who receives it. Never send it, and never state a rule or a deadline about trust: any such rule comes from `/legal-research`.

5. **Report.** Present the signed copy, the audit report and the draft as file cards (`shared/present-files.md`). Say the invoice's records are now locked, that a later correction is recorded as an adjustment, and that the draft email is unsent.

## When it went out

When the practitioner says the invoice went out, call `practice_data__record_invoice_sent` with the sent date and the sent copy's path.

## A correction after issue

An issued record never changes. Call `practice_data__record_adjustment` with the amount or time, the reason, who decided it and when. The frozen copy stays as it is.
