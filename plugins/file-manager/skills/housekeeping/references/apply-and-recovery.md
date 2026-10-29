Read when: applying approved rows (Step 15, after its opening guard in SKILL.md), acting on the rows `housekeeping__reconcile` returns (**Recovery**), carrying out a rename or move named in Step 16's chat, or writing or interpreting review-log rows in `/housekeeping`.

# Housekeeping: apply and recovery

## Step 15 — Apply, row by row

**Row by row, in the order `housekeeping__resolve` returns them, every row except trash rows:**

- **Already journalled:** skip it.
- **`invalid`:** journal `failed` with its failure; report it.
- **`retry`:** collect its hash. After the loop, one `matter_data__housekeeping_log` call: `matter_root`, `mode: "retry"`, `hashes` every retry hash. No move, no journal line.
- **Not `ok`:** when `checks.name.verdict` is `second_pass_required` and the clash and folder checks passed, run the chosen folder's second pass on the name; a pass makes the row ok. Otherwise the file stays where it is: journal `failed` with the failure, and it is re-proposed next run. No code is ever registered in a run.
- **`answered_question` and `final`:** repeat the half-commit check (`housekeeping__preflight`), then run `ingest-unattended` on this one file (`answer: {stop_reason, choice}` from `questions.json` for an answered question, the choice being the value whose label is the row's `answer`; a label not found there journals `failed`; none for It's final). Ingested: continue with its steps, taking the store from this ingest. Otherwise the file stays untouched: journal `failed` with the reason; it reappears next run.
- **Every other `ok` row:** run the steps its kind names (**Row kinds at apply**, below), in this order, then journal. A row without `move` skips step 4 and writes no journal line.
  4. **Move:** `file_ops__move` with `matter_root`, `run_id`, the row's `row_id`, `source` = `old_path`, `destination` = `new_path`, `create_folders` = `folders_to_create`, and `draft_unchanged: true` for `draft_unchanged`. Always pass `run_id` and `row_id`: the tool then moves only a row this run's approval approves, while the file still holds the approved hash. `moved_to` must equal `new_path`: on a mismatch, halt the apply and report. `dest_exists` or any other refusal (a locked file included): journal `failed` with it; the file is re-proposed next run. `not_found` (the source has gone): do not journal; call `housekeeping__reconcile` with `run_id` and act on this row's state.
  5. **Case data:** `matter_data__relocate_source` with `matter_root`, `hash`, `store` (the row's), `old_path` and `new_path`. Outcome `relocated` or `already_current` is done. `failed` is this step's failure, with its `reason`.
  6. **Drafting data:** `drafting_data__repoint_documents` with `matter_root`, `old_path` and `new_path`. Zero rows re-pointed is normal, and `database: false` means the matter has no drafting database: both are done.
  7. **Review log:** `matter_data__housekeeping_log` with `matter_root`, `mode: "record"` and one entry in `entries`: `file_name` the new basename, `file_hash` unchanged, `folder_type` the destination folder's type name, `outcome` per kind. `ok: false` is this step's failure, with its `problems`.
  8. **Manifest:** for a file renamed inside a `6. LAW` folder whose `case-download-manifest.json` names the old file name, `research_filing__append_manifest` into that folder with `{event: "renamed", from, to, hash}`.
  
  Then `housekeeping__journal_append` `done`. Steps 5 to 8 are each safe to run twice. A failure in any of them is reported and journalled `failed` with its reason (the step and its error), so no row is left without a journal line once its failure is reported.

**Trash rows, after every other row.** For each, call `housekeeping__reconcile` with `run_id` immediately before it: it checks that the file still holds the approved hash and that its twin still exists with the same hash, at its pre-run path or where its own row moved it. Action `trash`: `file_ops__trash` on `old_path` with `run_id` and the row's `row_id` (a soft delete into `<root>\TRASH\<same relative path>`), then journal `done`. `journal_failed`: journal `failed` with its reason and report; the next run re-derives the row. `journal_done`: journal `done`. A trash row writes no review-log row.

**Rule gaps.** After the apply, write `rule_gaps.json` with `housekeeping__write_run_file`: every `rule_gaps` entry with its `outcome` filled in, always "left where it is" (a rule-gap row is `stuck`, which is information only).

## Recovery — acting on each row

| Action | Do |
|---|---|
| `apply` (not moved, checks pass) | Step 15's steps for the row's kind, then journal `done`. When `resolution.checks.name.verdict` is `second_pass_required`, run the folder's second pass first; a fail is journalled `failed` |
| `needs_ingest_status` (an answered-question or It's-final row not moved) | `ingest-status` for the file. Ingested: continue at step 4. Otherwise run `ingest-unattended` for it first (with the answer from that run's `questions.json`), then step 4 |
| `post_move_steps` (the file is at its new path: the apply stopped after the move, before any journal line) | the kind's steps after the move (5 to 8: the same tool calls with the same arguments), replayed whole, then journal `done`. A failure in one of them is reported and journalled `failed` with its reason, as in Step 15 |
| `trash` | `file_ops__trash` with `run_id` and `row_id`, then journal `done` |
| `journal_done` | journal `done` |
| `journal_failed` | journal `failed` with its `reason` and report it. "Changed since approval", "approved file not found", a clash, "duplicate at destination": the file is left as it is and comes back as an ordinary candidate (a duplicate as a Duplicate row) |

A move error is not a verdict: when a move fails because the source has gone, reconcile again and act on the row's new state.

## Row kinds at apply

| Kind (`housekeeping__resolve`) | Steps | Review log | Journal |
|---|---|---|---|
| `rename_and_file`, `rename_in_place` (a `file`, `rename` or `move` row) | 4, 5, 6, 7, 8 | `renamed` | yes |
| `answered_question`, `final` | ingest first, then 4, 5, 6, 7, 8 | `renamed` | yes |
| `ingested_by_reference` | 4, 7, 8 | `renamed` | yes |
| `file_no_ingest` | 4 when the path changes, 7; a subfolder file stays in its folder | `not_ingested` | when it moves |
| `draft_unchanged` | 4, under the current name; a clash leaves it at the root | none | yes |
| `retry` | review log `retry` only | (retry) | no |
| `trash` | `file_ops__trash`, after every other row | none | yes |

## The review log

Every applied row that moves or files a file writes one review-log row in its post-move order, except `draft_unchanged` (none, so a draft can still be ingested if it is later filed unchanged). A row left as is writes nothing: the file is offered again. `renamed` and `manual_review` (written only from a Step 16 chat answer) settle a subfolder file's name; `not_ingested` settles its name and stops the ingest arm by hash; an ingest failure is recorded by `ingest-unattended` itself, settles nothing, and only schedules retries and supplies the care row's reason. A rename that was approved but failed is not recorded, and the row comes back next run.