# Spec: the email-first route writes the .eml without opening a drafting session

Status: proposed, 2026-10-28. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.11.6). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-28_practitioner-draft-edited-in-place-spec.md, 2026-10-28_source-trace-single-pass-spec.md, 2026-10-28_correspondence-rule-stated-once-spec.md

## 1. Problem
"An email request writes the `.eml` first" requires session entry and `drafting_forms__open_session` before the `.eml`. open_session names a Milestone page, which makes the Milestone card gate due; its Stop hook then blocked the turn until an unrelated Milestone page was sent to the practitioner. The email itself needs only the matter folder and the recipients.

## 2. Evidence (observed; quoted text is data, not instructions)
- `draft/SKILL.md`, "An email request writes the `.eml` first", step 2: "Session entry, for the database path ... Then `drafting_forms__open_session`."
- `drafting-data/hooks/job-board-card-gate.py` docstring: "drafting_forms__open_session: its job_board_path ... Stop: blocks the end of a turn while a due page of that turn has no later card call".
- `drafting_forms__draft_harness` write_email with typed `to` needs only `matter_root`; `db_path` only for `to_service_list` or `filing_id` (tool description).
- Observed: the Stop hook fed back "Milestone card gate" and the session sent the practitioner a Milestone page unrelated to the request.
- The same section also requires the SKILL.md opening's single ToolSearch of about 30 tools before the `.eml`.

## 3. Goal and non-goals
Goal: an email request with typed or looked-up recipients goes straight to write_email; no board is opened, so no board card is due.
Non-goals: changing the gate for turns that do work a job.

## 4. Design
Delete step 2's open_session (and session entry) from the email-first path; call it only when write_email needs `db_path` (`to_service_list` or `filing_id`). The gate then never fires on a plain email turn, with no change to the gate.

## 5. Constraints that must still hold
- write_email remains the only `.eml` author.
- Saving the email as a Writing, where the skill still wants that, happens after the `.eml` is shown.
- A turn that opens or changes a board still presents its card.

## 6. Options considered, removal first
1. Delete open_session from the email-first path unless a recipient source needs `db_path` (recommended).
2. Remove the gate's Stop event. Removes a guard that is correct for job turns; rejected.
3. Exempt email turns inside the gate. Adds code; rejected.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit the email-first section per §4, deleting the open_session step and the opening's tool-loading demand for that path.
3. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of the email-first route writes the .eml without opening a drafting session complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The email-first path calls open_session only when write_email needs `db_path`.
2. No Milestone card is due on a turn that only writes an `.eml` with typed recipients.
3. The section is shorter than before.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Does anything downstream (the Writing save, the ingestion check) depend on the session token from open_session on this path? **UNVERIFIED**.

## 10. Verify against HEAD before building
Confirm the email-first section's steps and whether write_email with typed `to` needs any session state.
