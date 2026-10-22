Read when: a package exists as files.
Assumes SKILL.md is loaded. Rules are not restated here.

## Entry and claim

Entered once the package exists as files (after court-ready assembly, or, for a VanIAC round, once `/assemble` with `assemble-vaniac-package` has gathered the exhibits into the mockup folder's `Package\` subfolder) and the board shows the pre-filing gate job. If the job is missing, create it under the gatekeeper's rule for it, the gate is a job, not a lifecycle state, so it claims, locks, records its steps and completes like any other, and the record of what was checked and waived survives on the board.

Claim it as an ordinary job, then call `drafting_forms__pre_filing_check` once, with the database path, the Writing, and the assembled package folder (for VanIAC, the `Package\` subfolder, never the mockup folder itself). The checks themselves are the gatekeeper's, never restated here. Record every result on the job's steps, each with the revision the check returned, in the gatekeeper's step-text format. The gate reports; a job fixes, never edit a package document to clear a finding.

## Failed check

Its own ceremony, evidence first: the offending line quoted verbatim in a fenced block with its document and page, the conflicting value beside it where there is one, then one labelled sentence of interpretation, then one decision: fix or waive. Describing a finding is not presenting it.

- **Fix:** the practitioner describes the fix, and it becomes a job they outline in a separate outlining session. The gate job stays in progress. The next gate session re-runs the tool after the fix lands.
- **Waive:** record their one-line reason verbatim, in their words, with no recommendation and no softening, and close the step.

Never edit a package document to clear a finding, a placeholder in a signed statement is cured by a corrected statement, never by touching the signed file. One decision at a time, even when several checks fail.

## Passed and exhibit index

Passed or not applicable: one line each. Show the exhibit index table once. Whether each file actually is the document its index row describes is the practitioner's read of that table, not the tool's verdict.

## Refusal

While any step is open: never say "ready to file" or "ready to serve," never present the assembled documents as final, never record the Writing as served or filed. Name the open checks and stop. A session asked "is it ready to file?" or "is it ready to serve?" with a step open answers with the open step and the finding, never with yes.

Once every step is closed, present the filing as ready for the practitioner's final approval to file, or a notice of application or application response as ready for their final approval to serve (amended Rule 8-1 serves it before it is filed), listing every waived check and its reason in that same message.
