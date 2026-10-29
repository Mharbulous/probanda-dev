// Dispatch for the file-manager plugin's `files` server (src/file-manager-index.ts):
// the file_ops__* and housekeeping__* tools, and nothing else. The practice
// plugin's `data` server (dispatch.ts) does not know these names, so disabling
// file-manager removes every tool that renames, moves, changes or deletes a user's file
// (docs/Plans/2026-10-14_file-admin-plugin.md). Kept apart from dispatch.ts so
// the `files` bundle holds only the modules these tools use.
import { ValidationError } from "./errors.js";
import { buildFileManagerToolDefinitions } from "./schema-gen.js";
import { defineTool, dispatchFrom, type ToolReply } from "./tool-list.js";
import { fileOpsTrash } from "./file_ops/trash.js";
import { fileOpsMove } from "./file_ops/move.js";
import { fileOpsMoveFromDownloads } from "./file_ops/move-from-downloads.js";
import { fileOpsCommentPdf } from "./file_ops/comment-pdf.js";
import type { RunRow } from "./file_ops/approved-row.js";
import { type CandidatesArgs, candidates } from "./housekeeping/candidates.js";
import { journalAppend, newRun, writeRunFile } from "./housekeeping/run-files.js";
import { preflight } from "./housekeeping/preflight.js";
import { reconcile } from "./housekeeping/reconcile.js";
import { resolveRun } from "./housekeeping/resolve.js";
import { housekeepingPreview, type HousekeepingPreviewArgs } from "./housekeeping/preview.js";
import { servePage } from "./housekeeping/server.js";
import { waitApproval } from "./housekeeping/wait.js";

type Run = { matter_root: string; run_id: string };

const tools = [
  defineTool<RunRow & { path: string; dry_run?: boolean }>("file_ops__trash", ({ path, dry_run, run_id, row_id }) =>
    fileOpsTrash(path, dry_run ?? false, new Date(), { run_id, row_id })
  ),
  defineTool<RunRow & {
    matter_root: string;
    source: string;
    destination: string;
    create_folders?: unknown;
    draft_unchanged?: boolean;
    superseded?: boolean;
  }>("file_ops__move", (args) => {
    const createFolders = args.create_folders ?? [];
    if (!Array.isArray(createFolders) || createFolders.some((f) => typeof f !== "string")) {
      throw new ValidationError("file_ops__move.create_folders must be an array of strings");
    }
    return fileOpsMove(
      args.matter_root,
      args.source,
      args.destination,
      createFolders as string[],
      args.draft_unchanged ?? false,
      args.superseded ?? false,
      { run_id: args.run_id, row_id: args.row_id }
    );
  }),
  defineTool<RunRow & { matter_root: string; source_filename: string; destination: string }>(
    "file_ops__move_from_downloads",
    (args) =>
      fileOpsMoveFromDownloads(args.matter_root, args.source_filename, args.destination, process.env, {}, new Date(), {
        run_id: args.run_id,
        row_id: args.row_id,
      })
  ),
  defineTool<{ matter_root: string; path: string; expect_sha256: string; comments: Array<{ page: number; text: string }> }>(
    "file_ops__comment_pdf",
    (args) => fileOpsCommentPdf(args.matter_root, args.path, args.expect_sha256, args.comments)
  ),
  defineTool<{ matter_root: string; include_template?: boolean }>("housekeeping__preflight", (args) =>
    preflight(args.matter_root, args.include_template ?? false)
  ),
  defineTool<{ matter_root: string }>("housekeeping__new_run", (args) => newRun(args.matter_root)),
  defineTool<CandidatesArgs>("housekeeping__candidates", (args) => candidates(args)),
  defineTool<Run & { file_name: string; content: string }>("housekeeping__write_run_file", (args) =>
    writeRunFile(args.matter_root, args.run_id, args.file_name, args.content)
  ),
  defineTool<Run>("housekeeping__serve_page", (args) => servePage(args.matter_root, args.run_id)),
  defineTool<HousekeepingPreviewArgs>("housekeeping__preview", (args) => housekeepingPreview(args)),
  defineTool<Run>("housekeeping__wait_approval", (args) => waitApproval(args.matter_root, args.run_id)),
  defineTool<Run>("housekeeping__resolve", (args) => resolveRun(args.matter_root, args.run_id)),
  defineTool<{ matter_root: string; run_id?: string }>("housekeeping__reconcile", (args) => reconcile(args.matter_root, args.run_id)),
  defineTool<Run & { row_id: string; outcome: string; reason?: string }>("housekeeping__journal_append", (args) =>
    journalAppend(args.matter_root, args.run_id, args.row_id, args.outcome, args.reason)
  ),
];

/** A tool's reply text. The work list goes out unindented: indentation alone adds a third to a reply near Cowork's tool-output limit. */
export function replyText(name: string, result: unknown): string {
  return name === "housekeeping__candidates" ? JSON.stringify(result) : JSON.stringify(result, null, 2);
}

const server = dispatchFrom(buildFileManagerToolDefinitions, tools, replyText);

export function dispatchFileManagerTool(name: string, rawArgs: unknown): Promise<ToolReply> {
  return server.dispatch(undefined, name, rawArgs);
}

export function callFileManagerTool(name: string, rawArgs: unknown): Promise<unknown> {
  return server.call(undefined, name, rawArgs);
}
