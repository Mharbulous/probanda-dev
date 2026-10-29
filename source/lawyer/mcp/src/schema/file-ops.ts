import type { ToolDefinition } from "./shared.js";

// The file-manager plugin's tools: the soft delete into a matter's TRASH folder
// (ADR 0014), the confined move /housekeeping files approved rows with, the
// move of a download into a matter folder, and a comment on a matter PDF.
// Served only by the `files` server (src/file-manager-index.ts), never by the
// lawyer plugin's `data` server, so disabling file-manager removes them.
export function fileOpsToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "file_ops__trash",
      description:
        "Soft-delete one file or folder in a client-matter workspace: move it to `<matter root>/TRASH/<same relative path>`. Use this instead of rm, unlink or any other delete -- one call, no shell, and it works while the device mount is down. `path` is the absolute host path (the Windows path from get_device_info connectedFolders). Refuses with an error `code`, touching nothing: `not_found`; `git_worktree` (ordinary repository rules apply); `not_a_matter_file` (no probanda.json at or above the path); `protected` (the workspace root, probanda.json, TRASH or anything in it, the 0. CASE DATA folder, or a privileged/disclosed tree); `cross_device`. A taken destination gets a ` (trashed YYYY-MM-DD HHMMSS)` suffix. `dry_run: true` returns the planned move only. Every move is logged to TRASH/.trash-log.jsonl. With `run_id` and `row_id` (a /housekeeping run's approved row; pass both or neither), it refuses unless that run's approval.json approves the row and the file still holds the row's proposal.json hash: `not_approved` (no approval, or the row is not approved), `unknown_row`, `changed_since_approval`, `approval_corrupt`, `invalid_argument` (only one of the two).",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          dry_run: { type: "boolean" },
          run_id: { type: "string" },
          row_id: { type: "string" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: "file_ops__move",
      description:
        "Move one file within a client matter, for an approved /housekeeping row: rename it, file it into a folder, or both. All paths are absolute host paths. `source` must be a file under `matter_root` (not probanda.json, TRASH, 0. CASE DATA, or a privileged/disclosed tree). `destination` is the full new file path, inside a matter folder outside folders 0 and 1, TRASH and any privileged/disclosed tree; the exceptions are `draft_unchanged: true`, which moves into the matter's `0. DRAFT*` folder under the current name only, and `superseded: true` (matter-data's supersede-draft), which moves into the `Superseded` subfolder of the matter's one `0. DRAFT*` folder only, under any name, with `create_folders` naming only that subfolder; a matter with no `0. DRAFT*` folder or two refuses that move with `invalid_argument`, as does passing both flags. Missing destination folders are created only when each is listed in `create_folders` (pass housekeeping__resolve's `folders_to_create`). Never overwrites, even under a race (the destination is claimed by an exclusive create first), and never adds a suffix. Refuses with an error `code`, touching nothing: `invalid_path`, `not_found`, `not_a_file`, `path_out_of_scope`, `protected`, `invalid_filename` (also a folder in `create_folders` whose name ends in a dot or a space or is otherwise not a valid Windows name), `invalid_argument`, `draft_name_changed` (draft_unchanged with a different name), `folder_not_approved`, `dest_exists`, `cross_device`; `placeholder_left` when a failed move could not remove its own empty placeholder at the destination. Returns {moved_from, moved_to, created_folders}; `moved_to` is the path as it now reads on disk -- check it equals the expected path and halt on a mismatch. With `run_id` and `row_id` (a /housekeeping run's approved row; pass both or neither), it refuses unless that run's approval.json approves the row and the file still holds the row's proposal.json hash: `not_approved` (no approval, or the row is not approved), `unknown_row`, `changed_since_approval`, `approval_corrupt`, `invalid_argument` (only one of the two).",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          source: { type: "string" },
          destination: { type: "string" },
          create_folders: { type: "array", items: { type: "string" } },
          draft_unchanged: { type: "boolean" },
          superseded: { type: "boolean" },
          run_id: { type: "string" },
          row_id: { type: "string" },
        },
        required: ["matter_root", "source", "destination"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: "file_ops__move_from_downloads",
      description:
        "Move one file from the practitioner's Downloads folder into a client matter folder, such as a court registry's receipt, submission sheet or filed document. A move, not a copy: one rename on the same drive, so the file leaves Downloads and no duplicate is left. Use it whenever the practitioner asks to move a download into a matter; never copy the file and call that a move. `source_filename` is the bare file name in Downloads (the server finds the folder itself). `matter_root` and `destination` are absolute host paths; `destination` is the full new file path, in an existing folder inside the matter outside folders 0 and 1, TRASH and any privileged/disclosed tree. No folder is created. Never overwrites: a taken name gets the next ` v2`, ` v3` before the extension, even under a race (the name is claimed by an exclusive create first). Refuses with an error `code`, touching nothing: `invalid_filename`, `downloads_missing`, `not_found` (no such download, or the destination folder does not exist), `not_a_file`, `in_progress`, `invalid_path`, `path_out_of_scope`, `protected`, `cross_device` (Downloads and the matter are on different drives), `dest_exists` (no free version name); `placeholder_left` when a failed move could not remove its own empty placeholder at the destination. Returns {moved_from, moved_to, versioned}; `moved_to` is the path as it now reads on disk, and `versioned` is true when a ` vN` name was used, so tell the practitioner the name it got. Every move is logged to `<matter-data folder>\\file-manager\\move-log.jsonl`; `log_error` is present when that line could not be written. With `run_id` and `row_id` (a /housekeeping run's approved row; pass both or neither), it refuses unless that run's approval.json approves the row and the file still holds the row's proposal.json hash: `not_approved` (no approval, or the row is not approved), `unknown_row`, `changed_since_approval`, `approval_corrupt`, `invalid_argument` (only one of the two).",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          source_filename: { type: "string" },
          destination: { type: "string" },
          run_id: { type: "string" },
          row_id: { type: "string" },
        },
        required: ["matter_root", "source_filename", "destination"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: "file_ops__comment_pdf",
      description:
        "Add sticky-note comments to one PDF in a client matter, for matter-data's supersede-draft: one note per entry of `comments`, on its `page` (from 1), stacked down from the page's top-left. `matter_root` and `path` are absolute host paths; `path` must be under `matter_root` and outside probanda.json, TRASH, 0. CASE DATA and any privileged/disclosed tree. `expect_sha256` is the SHA-256 the matter's records hold for the file: when the file no longer has it, nothing is written. The notes are an incremental save, so the original bytes are kept unchanged and the new objects appended; the file is replaced in one rename. Refuses with an error `code`, touching nothing: `invalid_path`, `not_found`, `path_out_of_scope`, `protected`, `not_pdf`, `password_protected`, `hash_mismatch`, `bad_pages`, `save_failed`. Returns {path, old_sha256, new_sha256, comments}: the file's bytes changed, so re-point every stored record of `old_sha256` at this path to `new_sha256` at once.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          path: { type: "string" },
          expect_sha256: { type: "string" },
          comments: {
            type: "array",
            items: {
              type: "object",
              properties: { page: { type: "integer" }, text: { type: "string" } },
              required: ["page", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["matter_root", "path", "expect_sha256", "comments"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
  ];
}
