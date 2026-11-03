# Spec: trust-application instruction to accounting and payment tracking after a bill is signed

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.21.7 at the start of the session and v0.21.9 by its end). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_record-client-bill-and-letter-sent-spec.md`; `2026-11-03_retainer-top-up-follow-up-spec.md`; `2026-11-03_defensible-time-entries-spec.md` (owns the invoice and trust-application records as a data model, §4.2 K there).

## 1. Problem

A bill was built, signed and sent showing its whole total "paid from funds held in trust". Nothing in the workflow then prepared the instruction to the firm's accounting department to make that transfer, and nothing recorded the payment as pending or, later, as made. The practice records show the invoice with no amount paid and the trust balance unchanged, so the bill's statement that it was paid from trust is not backed by any record.

## 2. Evidence (observed; quoted text is data, not instructions)

- `/bill-client` ends at "Step 12 — Save" (`lawyer/skills/bill-client/SKILL.md`, v0.21.7); there is no step after the bill is signed.
- The v0.21.9 skill description reads: "runs the whole path from the last invoice to a draft invoice for the lawyer's signature ... and stops there. Sends and issues nothing." (skill listing, v0.21.9)
- `/bill-client` Step 5: "Leave amount paid and status blank unless the document itself gives positive evidence of what was actually paid". The session followed this: `practice_data__import_invoices` was called with matter, invoice number, issue date, amount and `date_to`, and no `amount_paid` or `status`.
- `practice_data__trust_summary` for the matter, after the bill was signed, still returned the pre-bill trust balance and the prior `last_trust_date`.
- Tools present in the session that bear on this, unused by any step: `practice_data__manage_payment_in_flight`, `practice_data__ar_data`, `practice_data__trust_summary`, `practice_data__import_invoices`.
- The signed bill's own summary prints the trust balance before the account, the amount applied from trust, and the balance after; those three figures are exactly what accounting needs.
- Count: 1 bill this session; 0 instructions to accounting; 0 payment records.

## 3. Goal and non-goals

Goal: once the practitioner says a bill is signed, the session drafts the trust-application instruction to accounting (matter, bill number, amount to apply from trust, trust balance before and after) for the practitioner to send, records the payment as pending, and marks the bill paid when the practitioner reports accounting's confirmation.

Non-goals: moving money; sending anything (the practitioner sends); stating or applying the law on when trust funds may be withdrawn (that comes from `/legal-research` and is stored as a firm setting, per the defensible-time-entries spec §5).

## 4. Design

1. Add a closing step to `/bill-client` ("Issue"), run on the practitioner's word that the bill is signed:
   a. Confirm the signed copy from its content (bill number, signature, total), as Step 5 already does for prior invoices.
   b. Draft the instruction to accounting as an unsent `.eml` through `shared/email.md`'s `write_email` (recipient: the accounting address the firm profile holds, or the practitioner gives; never guessed), body written by the scrivener with `capacity: firm-as-creditor`, attaching the signed bill.
   c. Record the payment as pending with `practice_data__manage_payment_in_flight` (UNVERIFIED that it fits; if it does not, the defensible-time-entries spec's K record is the home).
   d. When the practitioner reports accounting's confirmation, update the invoice's `amount_paid` and `status` through `practice_data__import_invoices` and clear the pending payment.
2. Before 1b, check for a stored firm setting on trust withdrawal; if none, say in one line that the firm's trust-withdrawal rule is not recorded and offer `/legal-research` to establish it. Never state the rule in the session.

## 5. Constraints that must still hold

- Probanda never sends email; the instruction is an unsent draft.
- Step 5's rule stands for *imported* invoices: no amount paid without positive evidence. The pending record is not evidence of payment.
- No deadline computed or stated (`shared/deadline-isolation.md`).
- Only an active roster lawyer issues the bill; on a staff machine, name the lawyer and stop.

## 6. Options considered (streamline and deburr first, additions last)

1. **Recommended.** One "Issue" step in `/bill-client` that reuses existing tools (`write_email`, `manage_payment_in_flight`, `import_invoices`); no new tool.
2. Leave issuing to `/ar-follow-up`. Rejected: that skill flags clients for money conversations; it does not act at signing.
3. Fold into the defensible-time-entries spec's K record only. Deferred: that spec's data model has not landed; this step can write to it once it does.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Read `practice_data__manage_payment_in_flight`'s contract; decide whether it records a trust application or only client-side payments in flight.
3. Add the Issue step to `bill-client/SKILL.md`, replacing any text it makes unnecessary (the v0.21.9 "stops there" clause narrows to "stops before sending").
4. Add or extend tests for the payment-pending to paid transition with an invented fixture.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of trust-application instruction to accounting complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `bill-client` has a step that, after signing, drafts the accounting instruction as an unsent email carrying bill number, amount applied from trust, and trust balance before and after.
2. That step records a pending payment and names how it becomes paid.
3. No sentence in the skill states when trust funds may be withdrawn; it points to a stored firm setting or `/legal-research`.
4. Step 5's no-evidence rule for imported invoices is unchanged.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Is the instruction to accounting an email, a form, or a practice-database record only? (Also open in the defensible-time-entries spec §9 item 3.)
2. Which address does accounting use for internal instructions (the payment address printed on bills may be client-facing only)?

## 10. Verify against HEAD before building

- `bill-client/SKILL.md` at HEAD: does an issue or post-signature step already exist (the v0.21.9 rewrite may have added one)?
- `practice_data__manage_payment_in_flight`: its parameters and whether a trust application fits.
- Whether the firm profile holds an accounting address.
