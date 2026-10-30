---
name: housekeeping
disable-model-invocation: true
description: Read the loose files in a litigation matter's main folder into the case database, name each one by the firm's file naming convention (date + code + author/recipient + re/encl/srv + subject + amount) and file it into the matter's folders, and tidy files already in its subfolders that were never read in or carry non-standard names, after the practitioner approves each file on a local approval page. Use for 'housekeeping', or to clean up, organize, audit, standardize, or fix non-standard file names in a litigation matter folder. Litigation matters only.
---

<!-- file-manager v0.10.5 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Terms | A term (root, row, `matter_root`, stored form, run directory) is unclear |
| Arguments | The run is invoked with a subfolder, a file list or `--force` |
| Steps 1 to 6 | Every run, before the work list |
| Steps 7 to 10 | Building the work list, reading page 1, ingest and naming evidence: `references/work-list-and-reading.md` |
| Steps 11 and 12, Rows | Composing names and destinations, building rows, choosing a row's section, signals or action: `references/compose-and-rows.md` |
| Steps 13 and 14 | Writing the proposal, serving the page and waiting for Approve |
| Step 15 | Applying approved rows. Its row steps, the row kinds and the review log are in `references/apply-and-recovery.md` |
| Step 16 | After apply, to report and handle files left as is |
| Recovery | A run was interrupted, or after a compaction |

# Housekeeping (orchestrator)

The matter's main folder is its inbox: a file sitting loose there has not yet been read into the case database. One run reads each such file once, and that one read both records the document in the case database and supplies the evidence for its proper name and folder. Reading runs unattended. Everything is saved for one approval page, one line per file proposing one action, and **nothing is renamed or moved until the practitioner picks Approve on it and presses Submit**. Moving into the folder is always the last step for a file. Files already in the subfolders are tidied too when they were never read in, or carry a non-conforming name the practitioner has not settled.

**A file renamed or filed wrongly is worse than one left alone**: it can hide a deadline or break a search. When the evidence does not establish a name or a folder, the row proposes `stuck` (leave it where it is) with a short reason, never a guess.

This skill is the only front door, for litigation matters only, and holds **no database particulars**. It reaches data only through these public interfaces:

- `/file-naming` (in the `lawyer` plugin): the **gate** intent for Step 12's and Step 16's name checks, invoked through the Skill tool, and its references, read with `skill_source__read`.
- The `file-manager` plugin's `files` server tools (prefix `mcp__plugin_file-manager_files__`, or its Cowork-bridged name) and the `lawyer` plugin's data server tools (prefix `mcp__plugin_lawyer_data__`, or its Cowork-bridged name). Each step names the tools, the `/matter-data` and `/file-sorting` operations and the agents it calls.

## Terms

- **Root**: the matter folder itself. **Run**: one `/housekeeping` invocation on one matter. **Row**: one file on the page.
- **Swept folder**: a folder the practitioner's folder map matches, and every folder inside it, excluding folders the profile always skips, folders numbered 0 or 1, `TRASH`, and anything inside a folder the map does not match.
- **`matter_root`**: the matter folder's live host path, as `/matter-data` derives it. Every `housekeeping__*`, `file_ops__*` and `/matter-data` call takes it. **`matter_folder`**: the same folder as this session's own filesystem sees it (the mounted folder in a Cowork session, `matter_root` itself locally). Listing, hashing and reading happen there.
- **Stored form** of a path: matter-root-relative, backslash separators, no drive letter, no leading `\` or `.\`. Every path in `proposal.json` and every path handed to `/matter-data` or `/drafting-data` uses it.
- **Run directory**: `<matter-data folder>\housekeeping\<run-id>\`, the matter-data folder being the one `probanda.json`'s `case_data_dir` names. It must already exist (`housekeeping__new_run` fails `case_data_missing` otherwise); the server creates `housekeeping` beneath it. The server writes every file in it; this session only reads it, in a Cowork session after requesting access to the matter-data folder itself (never a parent). Run directories are never deleted.

## Arguments

| Argument | Effect |
|---|---|
| none, or the matter root | the full run |
| a subfolder path | sweep only that folder (and the folders inside it), per the profile's argument rule. No root files |
| a file list | only those files, root or subfolder |
| `--force` | the review log's settled verdicts no longer keep a subfolder file off the work list (the name arm of Step 7's admission). It never overrides the ingest arm. Say so in the opening message |

## Step 1 — Model

No model gate. Reading runs on the session's model, this session's page-1 reads and inline reads included, except three agents that are pinned: the ingest extractors run on Opus at high effort (`/matter-data`'s design decision #70), the page-1 reader on Haiku (Step 10) and the namer on Haiku (Step 11).

## Step 2 — Profile

Invoke `/file-sorting`'s **detect-profile** on the connected folder (or the folder argument). If no folder is connected, or it matches no profile, offer a picker (`mcp__cowork__request_cowork_directory` with no `path`), re-run detect-profile, and if it still matches nothing, say so and ask; never guess a profile.

**On any Kind other than `rename-in-place`, print one line and end:** "This is the accounting root. /housekeeping handles litigation matters only; use /route-accounting for it." No hand-off: the Skill tool refuses a skill that carries `disable-model-invocation`.

Then invoke `/file-sorting`'s **scope** for the root: the folder types the practitioner's folder map gives the matter's folders, with each type's notes file, the always-skip rules, the disambiguation tips, the verbatim-path rule, the argument rule, the extension whitelist, the name-gate second pass and the Law folder's flag tokens. Record each matched folder's on-disk name verbatim and reuse it everywhere. Two folders of one folder type (an old copy beside the current one) are both swept and both offered, by their on-disk names. This flow writes no `hashes.json` or `rename-plan.json`: its run files are the run directory's, written by the server.

## Step 3 — Half-commit check

Call `housekeeping__preflight` (`matter_root`). A non-empty `half_commit` means a write to this matter's case database was cut off inside its commit to disk. Then **write nothing**: stop the run and hand the state to the practitioner, naming each path in `half_commit`, with the `matter_data__execute` timeout advice: the case databases may be a mix of new and previous state, nothing is written to them until they are reconciled, and each listed folder is deleted once they are. A `case_data_found` of false is not a halt here; Step 4 deals with a missing case database. A matter folder with no pointer (neither `probanda.json` nor `coclerk.json`, or only a legacy `9. AI` pointer) is not an error either: `housekeeping__preflight` returns an empty `half_commit` and `case_data_found` false, and the run goes on to Step 4, which offers to set the case database up.

Repeat this check, a fresh `housekeeping__preflight` call, before every write phase (Step 5's recovery, Step 9's ingest, Step 15's apply, and an answered-question or It's-final ingest at apply).

## Step 4 — Case database and schema

Follow the profile's **record-backend** protocol: invoke `/matter-data`, ask whether the matter has a case database, run its `pointer-health`, and show the result as its one line.

- **A schema-version failure** (the case database is older than this build needs): halt the whole run and say so in chat. Nothing is ingested against an old schema, and no page is built. Name the fix: `/matter-data`'s migrate operation, run through its `lawyer:migration-runner` agent.
- **No case database:** this flow cannot run without one, because every file it files is read into the case database and its review log lives there. Of the profile's two options, offer only **set up the case database now**. If it is set up, give the profile's verbatim message and end the run. If it is declined, end the run.
- **A stale pointer, or the `matter_data__*` tools absent:** halt and name the error.

## Step 5 — Finish interrupted approvals

Run **Recovery** (below) for every interrupted run of this matter before building anything. Rows it finishes take no place in this run's 50. Keep its summary for the page header, for example "Finished 16 files you approved on 23 Sep. 2 could not be finished and are shown below."

## Step 6 — Start the run

Call `housekeeping__new_run` (`matter_root`) for this run's `run_id`. The new run directory stops every earlier page from approving, so the previous run that Step 7's order rotates against cannot change under this run. A run that stops before Step 13 leaves its directory without a `proposal.json`; later runs read past it.

## Step 7 — Build the work list

One `housekeeping__candidates` call returns the admitted files, in order, up to 50. Read `references/work-list-and-reading.md` before making it: it holds Steps 7 to 10.

## Step 8 — Page-1 routing read

Read page 1 of each file that needs ingest, and flag firm drafts: `references/work-list-and-reading.md`.

## Step 9 — Ingest

Repeat the half-commit check (Step 3), then make one capped `ingest-unattended` call: `references/work-list-and-reading.md`.

## Step 10 — Naming evidence from page 1

Dispatch the page-1 readers and assemble each row's naming-evidence block: `references/work-list-and-reading.md`.

## Step 11 — Compose

Compose names and destinations, dispatching the namer: `references/compose-and-rows.md`.

## Step 12 — Rows: checks, signals and precomputes

Build the rows and run the destination, collision and name checks: `references/compose-and-rows.md`, which also holds **Rows**.

## Step 13 — Write `proposal.json` and serve the page

Write `proposal.json` into this run (Step 6's `run_id`) with `housekeeping__write_run_file`; it must validate, keep Step 7's order and cap (`proposal_out_of_order` names the first row out of place), and is write-once, so build it whole first. Its shape:

- `run_id`, `matter_root` (the host path), `created_at` (ISO timestamp);
- `header`: `open_in_word`, `folders_not_looked_inside` (names), and `finished_line` from Step 5 when it has one;
- `folders`: `{path, exists, flag_tokens?, second_pass?}` for each filing folder (Step 12's list), `flag_tokens` on the Law folder, `second_pass: true` on Law and Discovery;
- `draft_folder`: the on-disk `0. DRAFT*` folder, or null;
- `rows`: `{row_id, current_path, hash, ingest_outcome, store?, source_ids, section, action?, name_checks, notes, twin?}` in `housekeeping__candidates`' order, its `admitted` files then its `deferred` ones, `row_id` short and unique (`r001`), arrays empty where there is nothing. `section` is `offered`, `ingested_only` or `deferred`; `action` (**Rows**, `references/compose-and-rows.md`) is present exactly on `offered` rows. `twin` is `{path, row_id?, ingested}`; its `row_id` is required when the twin is itself a row on the page. `ingest_outcome` is the file's state as the page is built (`ingest-unattended`'s `not_ingested` is `none`). Signals, reasons and evidence are this session's working and are not written: the page shows none of them;
- `rule_gaps` (Step 12).

When any row's action carries an `answer`, also write `questions.json`: per row id, the `stop_reason` and the options as `{value, label}`. The action's `answer` is the label this session picked; apply maps it back to its value.

Then call `housekeeping__serve_page`. Serving invalidates every earlier page for this matter. Give the practitioner the `url` ("Ctrl+click to open it in Chrome"), and the three counts: to decide (not counting `stuck` and `misfiled` rows), ingested with nothing to approve, left for the next run.

## Step 14 — Wait for Approve

Call `housekeeping__wait_approval` and re-issue it on every `pending` (the page's Submit writes the approval). The page shows every row with a radio pair, **Approve** and **Leave as is**, starting on Leave as is, except `stuck` and `misfiled` rows, which it shows for information only (no radio pair, no group box, not counted); Submit posts one `approve` entry per approved row and nothing for a row left as is, and the server refuses an entry on a `stuck` or `misfiled` row. On `approved`, go to Step 15; an approval with no rows is valid, applies nothing, and goes on to Step 16's report. On `invalidated`, a newer run for this matter has started: stop without applying and say so. On `corrupt`, `approval.json` is there but cannot be read: tell the practitioner, naming the `file` and its `problem`, and apply nothing. If the practitioner says "done", call it once more. If they say to stop, end the run without applying anything. Closing the tab is not an action; the link works while this run is live.

## Step 15 — Apply

Everything here is read back from disk, never from memory: `housekeeping__resolve` (`matter_root`, `run_id`) resolves each approved row (every `approval.json` entry is `approve`; a row left as is has no entry and is not resolved) from `proposal.json` and `approval.json` into its `kind`, `move`, `old_path`, `new_path`, `name`, `folder`, `folders_to_create`, `answer`, apply-time `checks` (name gate, destination clash, folder present or creatable from the template), `ok` and `failure`, and any journal line already written. A row's hash, store and current path come from its `proposal.json` row, read from the run directory. Nothing that is not in both files is applied. If `housekeeping__resolve` fails `approval_corrupt`, the saved approval cannot be read: tell the practitioner, naming the file its message gives, and apply nothing. Repeat the half-commit check (`housekeeping__preflight`) first. After a compaction, call `housekeeping__reconcile` with this `run_id` and continue from its answer (**Recovery**).

Then apply row by row, trash rows last, and write `rule_gaps.json`, by `references/apply-and-recovery.md`, which also holds the row kinds and the review log.

## Step 16 — Report

In chat: what was renamed and filed, what was filed without ingest, moved to `0. DRAFT` or moved to `TRASH`; what was skipped or failed and why (a destination clash as "possible duplicate of <path>"); any defect; the deferred count with an invitation to run `/housekeeping` again; and "N naming-rule gaps recorded for the convention maintainer" when `rule_gaps` is non-empty. For every `misfiled` row, name the matter and say that housekeeping never moves a file between matters: the practitioner moves it into that matter's main folder, and its next run reads and files it. List every `stuck` row once with its reason, apart from the left-as-is count.

**Leave as is.** Then give the number of files left as is (offered rows other than `stuck` and `misfiled` with no `approval.json` entry), and say that any of them can be named in this chat to rename it, move it, or have housekeeping leave it alone for good. Ask nothing about them. When the practitioner names one, carry out the instruction in this chat as an ordinary instruction: a rename or move goes through a fresh `housekeeping__preflight`, the name gate and the destination folder's check on any new name, then `file_ops__move` and Step 15's steps 5 to 8 for the matching kind (`references/apply-and-recovery.md`). No approval page is involved. These moves sit outside the run's journal, so an interruption leaves the file wherever it is and the next run re-derives it. "Leave it alone for good" on a subfolder file is one `matter_data__housekeeping_log` call, `mode: "record"`, with one entry: its current name and hash, `folder_type` the type of the folder it sits in, `outcome` `manual_review`. A file left as is and not named needs nothing: it is offered again next run.

---

## Recovery

An **interrupted run** is a run directory holding `approval.json` in which some move row has no journal line. A run directory with `proposal.json` and no `approval.json` is a page closed without Approve: it is finished, not interrupted, and its rows come back through the usual admission and rotate.

Call `housekeeping__reconcile` with `matter_root` and no `run_id` (Step 5), or with the live `run_id` after a compaction. It hashes each open row's old and new paths, re-runs the apply-time checks, and returns per row a `state` and an `action`. It moves and journals nothing itself. If it fails `approval_corrupt`, a run's saved approval cannot be read: stop, tell the practitioner, naming the file its message gives, and apply nothing. Act on each row, trash rows last, by the table in `references/apply-and-recovery.md`.

Repeat the half-commit check (`housekeeping__preflight`) before any recovery write.
