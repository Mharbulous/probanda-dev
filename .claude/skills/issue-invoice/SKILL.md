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

2. **Freeze the record.** Write `<matter-data folder>\issue-invoice\meta.json` as `bill-client/scripts/freeze_invoice.py`'s docstring says, with any trust amount the invoice states as `trust_application`: the balance before from `practice_data__trust_summary`, the amount applied, and the balance after. Run `bill-client/scripts/freeze_invoice.py` with `--out-dir` the matter's draft folder's `BILLING` subfolder and `--data-dir` the same working folder, and `--disbursements` the disbursements file if the bill has one. A refusal stops this skill: tell the practitioner what it says. A total that does not tie means the signed invoice differs from the vetted time, and the practitioner decides what to correct.

3. **Issue it.** Call `practice_data__issue_invoice` with the matter, the figures from step 1, and the signed copy's path and the snapshot's path and hash the script printed, with `records_file` its `issue_records.json` and `trust_application` from `meta.json`. This is one-way, so it passes only on the practitioner's approval. If the cloud answers with a question, relay it and stop.

   Once the invoice is recorded, end the bill in progress, as `/bill-client`'s "The bill record" describes. Call `time_pipeline__list` with namespace `bill` and prefix `<matter number>:`. If a key ending `:bill` holds `state` `in_progress` or `ready_for_signature`, change that value's `state` to `ended_issued`, add the invoice number and a `history` entry, and write it back with `time_pipeline__set`. With no such key, write nothing and carry on. A failed write never undoes the issue: say once, in plain words, that the bill still shows as under way.

4. **Draft the trust instruction.** If the invoice states trust applied, read `billing_settings` from `practice_data__firm_profile`. With no `trust_withdrawal` in it, say in one line that the firm's trust-withdrawal rule is not recorded and offer `/legal-research` to establish it. Then draft one email to accounting by `shared/email.md`, stating the invoice number, the amount and the balances from step 2. Ask once who receives it. `lawyer:scrivener` writes the body, with `recipient` `non-party`, `capacity` `firm-as-creditor` and those facts located in `meta.json` and the signed copy. Call `write_email` with `folder` `BILLING`, the signed copy in `attachments` and the word DRAFT in the subject. Never send it, and never state a rule or a deadline about trust.

5. **Report.** Present the signed copy, the audit report and the draft as file cards (`shared/present-files.md`). Say the invoice's records are now locked, that a later correction is recorded as an adjustment, and that the draft email is unsent. If trust was applied, say the invoice stays pending until accounting confirms the transfer.

## When accounting confirms

An issued invoice with a trust application and no amount paid is pending. When the practitioner reports accounting's confirmation, call `practice_data__import_invoices` with the matter, the invoice number, its issued amount, the `amount_paid` reported and its `status`. The issued figures stay as they are.

## When it went out

Never ask whether the invoice was sent, delivered or received until `lawyer:delivery-checker` has checked it. Dispatch it once, with `matter_root`, the sent copy (or else the signed copy) as `letter_path`, `file_name`, `file_size` and, for a PDF, `page_manifests` from `pdf_pages__images`. Report its result, which updates nothing, and ask only about what it lists under `could_not_determine`, naming what was checked. A check marked `needs page images` is reported as not checked.

When the practitioner says the invoice went out, check it first, then call `practice_data__record_invoice_sent` with the invoice number, the sent date and the sent copy's path. Then call `matter_data__procedural_history_append` with `date` the sent date, `line` `Sent invoice <number> to client` and `source_path` the sent copy, relative to the matter folder. A `duplicate_entry` refusal means it is already recorded: say so in one line.

## A correction after issue

An issued record never changes. Call `practice_data__record_adjustment` with the amount or time, the reason, who decided it and when. The frozen copy stays as it is.
