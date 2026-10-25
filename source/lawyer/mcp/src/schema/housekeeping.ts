import type { ToolDefinition } from "./shared.js";

// /housekeeping's preflight, run files, approval page, approval wait, resolve, recovery and journal
// (planning/1. Design/2026-09-23_housekeeping-redesign-spec.md §B8-§B10). Every write lands in
// the matter's `<matter-data folder>\housekeeping\<run-id>\` directory and nowhere else.
export function housekeepingToolDefinitions(): ToolDefinition[] {
  const matterRun = {
    matter_root: { type: "string" },
    run_id: { type: "string" },
  };
  return [
    {
      name: "housekeeping__preflight",
      description:
        "Read-only checks for a /housekeeping run that a Cowork session cannot make itself. `matter_root` is the absolute matter folder; one without probanda.json (or with only a legacy `9. AI` pointer) is not an error and returns {half_commit: [], case_data_found: false}. Returns {half_commit, case_data_found, template_folders?}. `half_commit` lists the absolute path of every `.coclerk_execute_*` folder in the matter's matter-data folder (found as matter_data__query and matter_data__execute find it): a non-empty list means a matter_data__execute was killed inside its commit to disk, so write nothing and follow that tool's timeout advice. `case_data_found` is false when the matter-data folder does not exist. With `include_template: true`, `template_folders` lists every folder of the firm's template matter (`ADMIN\\0. TEMPLATE\\L### Litigation`), every level, template-relative with backslash separators; fails `template_missing` when the template matter is not found.",
      inputSchema: {
        type: "object",
        properties: { matter_root: { type: "string" }, include_template: { type: "boolean" } },
        required: ["matter_root"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "housekeeping__new_run",
      description:
        "Start a /housekeeping run for a client matter: create `<matter-data folder>\\housekeeping\\<run-id>\\` under a server-minted run id to the millisecond (e.g. `20260924-204013123-a1b2`), the matter-data folder being the one probanda.json's `case_data_dir` names; `housekeeping` is created beneath it when missing. `matter_root` is the absolute matter folder (it must hold the matter pointer probanda.json, or the legacy coclerk.json). Call it before building the candidate list: the new directory stops every earlier run's page from approving, which fixes the previous run that housekeeping__candidates rotates against. Returns {run_id, run_dir}. Fails `case_data_missing` when the matter-data folder does not exist (run /matter-data initialize first).",
      inputSchema: {
        type: "object",
        properties: { matter_root: { type: "string" } },
        required: ["matter_root"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: "housekeeping__candidates",
      description:
        "Build a /housekeeping run's work list in one read-only call (Steps 6-7): list the candidates, hash them, run the name gate and its mechanical second pass, read ingest status and the review log, admit, order and cap at 50. Nothing per file goes in. `swept_folders` are the folders the folder map matches, by their on-disk names (matter-root-relative), each {path, folder_type, flag_tokens?, second_pass?}: `folder_type` the folder type's name (`Law`, `Discovery`, `Court File`, ...), `flag_tokens` the Law folder's, `second_pass: true` on Law and Discovery. `skip_folders` are the root folders the profile always skips (neither swept nor listed). `subfolder` (sweep only that folder, no root files) or `files` (only those stored-form paths) apply the run's argument; `finished` lists the stored paths Step 5's recovery finished, which are left out; `force` drops the settled-verdict condition from the name arm only. Listing: root files except `~`/`.` names, probanda.json, CLAUDE.md, AGENTS.md, ProceduralHistory.md, `.cm*`, desktop.ini and `.lnk`; a root file with a `~$` sibling is open in Word and only named in `header.open_in_word`; files with `.pdf .docx .doc .eml .msg .xls` anywhere inside a swept folder; root folders other than TRASH, `Claude outputs`, skipped and swept ones are named in `header.folders_not_looked_inside`. Admission: a root file always; a subfolder file when (its name does not conform AND no settled verdict matches) OR (it is not ingested AND no `not_ingested` row matches its hash). Order: fresh root, fresh subfolder, rotated root, rotated subfolder (rotated = offered and not approved on the previous run's page, by hash). Returns {run_id, previous_run, header, errors: [{path, error}] (unreadable files, left out of the run), admitted (at most 50, this run's rows in this order, each {path, hash, rotated, location, folder_type, admitted_by, name: {verdict conforms|fails|second_pass_required, reason, flags} or null at the root, ingest: the ingest-status entry, review: {reviewed, outcome, reviewed_at, matched_on, not_ingested, ingest_failure}}), deferred: [{path, hash}] (past the cap, for proposal.json's deferred rows)}. A file not admitted is not returned. `second_pass_required`: the name failed the gate in a Law or Discovery folder and matches neither mechanical form; judge it against the folder's notes. Fails whole past its time budget, never with a partial list. Fails `approval_corrupt` when the previous run's approval.json is unreadable.",
      inputSchema: {
        type: "object",
        properties: {
          ...matterRun,
          swept_folders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                folder_type: { type: "string" },
                flag_tokens: { type: "array", items: { type: "string" } },
                second_pass: { type: "boolean" },
              },
              required: ["path", "folder_type"],
              additionalProperties: false,
            },
          },
          skip_folders: { type: "array", items: { type: "string" } },
          subfolder: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          finished: { type: "array", items: { type: "string" } },
          force: { type: "boolean" },
        },
        required: ["matter_root", "run_id", "swept_folders", "skip_folders"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "housekeeping__write_run_file",
      description:
        "Write one file into a /housekeeping run directory. `file_name` is `proposal.json`, `questions.json` or `rule_gaps.json`; any other name is refused (`invalid_filename`), and approval.json and applied.jsonl are refused (`reserved_file`) because only the page and housekeeping__journal_append write them. `proposal.json` is the approval page's whole model: it must parse and validate (`invalid_proposal`, naming every problem), its `run_id` and `matter_root` must be this run's, its rows must be in housekeeping__candidates' order with only the rows past the first 50 `deferred` (else `proposal_out_of_order`, naming the first row out of place; the check sees only the rows written, so it cannot tell that an admitted file was left off; `approval_corrupt` when the previous run's approval.json is unreadable), and it is write-once -- the same content again is a no-op, other content is refused `proposal_exists` (start a new run instead). Written temp-then-rename. Returns {run_id, path, bytes}.",
      inputSchema: {
        type: "object",
        properties: { ...matterRun, file_name: { type: "string" }, content: { type: "string" } },
        required: ["matter_root", "run_id", "file_name", "content"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: "housekeeping__serve_page",
      description:
        "Serve a run's approval page on 127.0.0.1 and return its `url` for the practitioner (Ctrl+click opens it). The run must be the matter's newest run with a valid proposal.json (else `stale_run` or `invalid_proposal`). Serving invalidates every earlier page link for the matter in this session, so an old tab cannot approve. The link stops working when a newer run is served or the session ends. The page's Submit writes approval.json. Returns {url, run_id, rows, approved}. Then call housekeeping__wait_approval.",
      inputSchema: {
        type: "object",
        properties: matterRun,
        required: ["matter_root", "run_id"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: "housekeeping__preview",
      description:
        "Render the approval page with `overrides` (template file name to replacement text, from pages__template with page \"Housekeeping approval\") in place of its own template files, write it as `Housekeeping approval preview <n>.html`, and return {path}, never the HTML: present the file to the practitioner as a file card and never read it. An override naming no file of the page is refused. `data: \"fixture\"` draws placeholder data, before approval or, with `approved: true`, after, and writes into the fixture preview folder (`<OS temp folder>\\Probanda fixture previews`), the only preview the Suggestion Box takes. `data: \"real\"` draws one run's proposal and recorded approval (`matter_root` and `run_id`), stays on this machine, and is written in that run's folder; its Submit approves nothing.",
      inputSchema: {
        type: "object",
        properties: {
          overrides: { type: "object", additionalProperties: { type: "string" } },
          data: { type: "string", enum: ["fixture", "real"] },
          approved: { type: "boolean" },
          ...matterRun,
        },
        required: ["data"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: "housekeeping__wait_approval",
      description:
        "Wait for the practitioner to press Submit on a run's page. Returns as soon as approval.json exists: {status: \"approved\", approved_at, rows}. After about 45 s returns {status: \"pending\"} -- not an error; call again. Returns {status: \"invalidated\", newer_run} as soon as a newer run directory exists for the matter, proposal or not. Returns {status: \"corrupt\", file, problem} when approval.json is there but unreadable: tell the practitioner and apply nothing. If the practitioner says \"done\", call once more; if they say stop, end the run without applying.",
      inputSchema: {
        type: "object",
        properties: matterRun,
        required: ["matter_root", "run_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "housekeeping__resolve",
      description:
        "Resolve every approved row of a run from proposal.json and approval.json on disk (never from memory): per row its `kind` (rename_and_file, rename_in_place, answered_question, final, file_no_ingest, draft_unchanged, ingested_by_reference, retry, trash, invalid), taken from the row's one proposed action, `move`, `old_path`, `new_path`, `name`, `folder`, `folders_to_create`, `answer`, the apply-time `checks` (name gate via /file-naming's name_gate.py, destination clash, folder present or creatable from the template), `ok`, `failure` (e.g. \"name check failed: ...\"), and any `journal` line already written. A `checks.name.verdict` of `second_pass_required` means the name failed the mechanical gate in a folder with alternate formats: run that folder's prose second pass before applying. Only approved rows are returned: approval.json holds one `approve` entry per approved row, and a row left as is has none, so it is not returned and nothing is done with it (an approval with no rows resolves none). An entry on a `stuck` or `misfiled` row, which the page shows for information only, is `invalid`. Apply only rows with ok (or a passed second pass); every row with move, kind trash, or kind invalid gets one journal line. Fails `not_approved` without approval.json, and `approval_corrupt` (naming the file) when it is there but unreadable: apply nothing.",
      inputSchema: {
        type: "object",
        properties: matterRun,
        required: ["matter_root", "run_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "housekeeping__reconcile",
      description:
        "Recovery for approved /housekeeping rows. Omit `run_id` to list every interrupted run of the matter (approval.json present, some move row without a journal line); pass it for the live run after a compaction, and immediately before each trash row of a live apply. Hashes each open row's old and new paths (SHA-256) and returns per row `state` (not_moved, moved, changed, missing, clash, duplicate_at_destination, trashed, unresolvable) and `action`: `apply` (checks in `resolution`, then steps 4-8), `needs_ingest_status` (answered-question or It's-final row not moved: call /matter-data ingest-status first), `post_move_steps` (steps 5-8), `trash` (copy and twin both check out: call file_ops__trash), `journal_done`, or `journal_failed` with `reason`. A run whose move rows all have journal lines is closed, whatever retry entries it holds. Fails `approval_corrupt` (naming the file) when a run's approval.json is there but unreadable, with or without `run_id`: apply nothing. Moves and journals nothing itself.",
      inputSchema: {
        type: "object",
        properties: matterRun,
        required: ["matter_root"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "housekeeping__journal_append",
      description:
        "Append one line {row_id, outcome, reason?} to a run's applied.jsonl, after a move row's last step (`done`) or its reported failure (`failed`, with the reason). Refuses a row id not in proposal.json (`unknown_row`), a run without approval.json (`not_approved`) or with an unreadable one (`approval_corrupt`), and a second line for a row (`already_journalled`). Nothing is journalled before a move.",
      inputSchema: {
        type: "object",
        properties: {
          ...matterRun,
          row_id: { type: "string" },
          outcome: { type: "string", enum: ["done", "failed"] },
          reason: { type: "string" },
        },
        required: ["matter_root", "run_id", "row_id", "outcome"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
  ];
}
