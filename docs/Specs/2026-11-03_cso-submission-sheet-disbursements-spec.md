# Spec: court filing fees from Court Services Online submission sheets

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.21.7 at the start of the session and v0.21.9 by its end). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_firm-invoice-template-and-style-guide-spec.md`; `2026-11-03_defensible-time-entries-spec.md` (its §4 K already says "each disbursement line links to its receipt or filing record (by hash, so one receipt saved twice counts once)"; this spec supplies how filing fees are found).

## 1. Problem

The draft invoice listed one $7.00 Court Services Online package submission fee and left out the $25.00 court filing fee for a Response to Civil Claim filed in the same package. The practitioner caught it: "Disbursements are missing the disbursement for the court filing fee for the response to civil claim." Separately, the matter's disbursements folder held two "receipts" that were one file saved under two names, which nearly produced a double charge.

## 2. Evidence (observed; quoted text is data, not instructions)

- The disbursements folder held two PDFs named as two receipts; `sha256sum` gave one hash for both. Both read "Package Submission Fee Payment $ 7.00 ... Total: $ 7.00".
- The submission sheet (`... SUBSHT #<package> re RTCC $7.00.pdf`, saved in the lawyer brief's CSO folder, not the disbursements folder) showed a Document Summary line: "Response to Civil Claim ... Submitted ... Not Processed N $ 25.00" with the Fee Collected column blank, and a Transaction Summary of "$ 7.00".
- The session left the $25 off because the line read "Not Processed" and no receipt for it was in the disbursements folder.
- No skill text tells a billing run where disbursements come from: `bill-client/SKILL.md` (v0.21.7) has no disbursement step.

## 3. Goal and non-goals

Goal: every court fee charged for a filing in the billing period reaches the invoice once, with its source, and duplicate receipt files count once.

Non-goals: deciding whether a fee was actually charged when the records conflict (that is the practitioner's call); non-court disbursements beyond de-duplication.

## 4. Design

- For the billing period, read every Court Services Online submission sheet and receipt in the matter (both folders), deterministically in code (text layer; fall back to the scanned-page route).
- Each Document Summary fee line is a candidate disbursement, labelled with its document and filing date. A line marked "Not Processed" or with a blank Fee Collected is still listed, flagged for the practitioner to confirm, never dropped silently.
- The package submission fee comes from the transaction summary or the receipt.
- Receipts are de-duplicated by content hash before counting.
- Output: a disbursement list with amount, tax status, source file and flags, fed to the invoice.

## 5. Constraints that must still hold

- A fee never appears twice, and a fee is never invented without a source line.
- The practitioner decides flagged lines.
- Scanned PDFs are read from their images, never their text layer (`/matter-data` design decision #71).

## 6. Options considered, streamline and deburr first, additions last

1. One code step that parses submission sheets and receipts and de-duplicates by hash, called from `/bill-client` (recommended).
2. A skill-text instruction to read submission sheets. Cheaper to write, but leaves parsing to the model each run, which is how the fee was missed.
3. Rely on the accounting system's disbursement ledger. Not available to Probanda in this session.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Write the parser and hash de-duplication, with fixtures for a sheet with a "Not Processed" fee line and two identical receipts.
3. Call it from `/bill-client`'s invoice step; show flagged lines to the practitioner.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of court filing fees from Court Services Online submission sheets complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Given a submission sheet with a $25 "Not Processed" document fee and a $7 package fee, the step returns both, the $25 flagged.
2. Given two receipt files with one hash, the step counts the fee once and names both files.
3. `/bill-client` takes disbursements only from this step's output plus practitioner additions.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Does "Not Processed" with a blank Fee Collected mean the fee was charged later? The practitioner treated it as charged (about $25).
2. Should the parser also read the Court Services Online account history once a sign-in route exists?

## 10. Verify against HEAD before building

- Whether v0.21.9's `bill-client` already has a disbursement step.
- Whether the defensible-time-entries spec's receipt de-duplication has landed, so this spec reuses it instead of adding its own.
