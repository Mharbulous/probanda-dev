// Dispatch for the file-manager plugin's `files` server (src/file-manager-index.ts):
// the file_ops__* and housekeeping__* tools, and nothing else. The practice
// plugin's `data` server (dispatch.ts) does not know these names, so disabling
// file-manager removes every tool that renames, moves or deletes a user's file
// (docs/Plans/2026-10-14_file-admin-plugin.md). Kept apart from dispatch.ts so
// the `files` bundle holds only the modules these tools use.
import { DataServerError, ValidationError } from "./errors.js";
import { buildFileManagerToolDefinitions, type ToolDefinition } from "./schema-gen.js";
import { validateToolInput } from "./validate.js";
import { fileOpsTrash } from "./file_ops/trash.js";
import { fileOpsMove } from "./file_ops/move.js";
import { orderCandidates } from "./housekeeping/order.js";
import { journalAppend, newRun, writeRunFile } from "./housekeeping/run-files.js";
import { preflight } from "./housekeeping/preflight.js";
import { reconcile } from "./housekeeping/reconcile.js";
import { resolveRun } from "./housekeeping/resolve.js";
import { servePage } from "./housekeeping/server.js";
import { waitApproval } from "./housekeeping/wait.js";

let definitions: Map<string, ToolDefinition> | undefined;

function toolDefinition(name: string): ToolDefinition {
  if (!definitions) {
    definitions = new Map(buildFileManagerToolDefinitions().map((tool) => [tool.name, tool]));
  }
  const definition = definitions.get(name);
  if (!definition) throw new ValidationError(`Unknown tool "${name}"`);
  return definition;
}

export async function dispatchFileManagerTool(
  name: string,
  rawArgs: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    return textResult(await callFileManagerTool(name, rawArgs));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload = err instanceof DataServerError
      ? { error: { code: err.code, message } }
      : { error: { code: "data_error", message } };
    return { ...textResult(payload), isError: true };
  }
}

export async function callFileManagerTool(name: string, rawArgs: unknown): Promise<unknown> {
  const definition = toolDefinition(name);
  const args = validateToolInput(definition, rawArgs);

  if (name === "file_ops__trash") {
    return fileOpsTrash(args.path as string, (args.dry_run as boolean | undefined) ?? false);
  }

  if (name === "file_ops__move") {
    const createFolders = args.create_folders ?? [];
    if (!Array.isArray(createFolders) || createFolders.some((f) => typeof f !== "string")) {
      throw new ValidationError("file_ops__move.create_folders must be an array of strings");
    }
    return fileOpsMove(
      args.matter_root as string,
      args.source as string,
      args.destination as string,
      createFolders as string[],
      (args.draft_unchanged as boolean | undefined) ?? false,
      (args.superseded as boolean | undefined) ?? false
    );
  }

  if (name === "housekeeping__preflight") {
    return preflight(args.matter_root as string, (args.include_template as boolean | undefined) ?? false);
  }

  if (name === "housekeeping__new_run") {
    return newRun(args.matter_root as string);
  }

  if (name === "housekeeping__order_candidates") {
    return orderCandidates(args.matter_root as string, args.run_id as string, args.candidates);
  }

  if (name === "housekeeping__write_run_file") {
    return writeRunFile(args.matter_root as string, args.run_id as string, args.file_name as string, args.content as string);
  }

  if (name === "housekeeping__serve_page") {
    return servePage(args.matter_root as string, args.run_id as string);
  }

  if (name === "housekeeping__wait_approval") {
    return waitApproval(args.matter_root as string, args.run_id as string);
  }

  if (name === "housekeeping__resolve") {
    return resolveRun(args.matter_root as string, args.run_id as string);
  }

  if (name === "housekeeping__reconcile") {
    return reconcile(args.matter_root as string, args.run_id as string | undefined);
  }

  if (name === "housekeeping__journal_append") {
    return journalAppend(
      args.matter_root as string,
      args.run_id as string,
      args.row_id as string,
      args.outcome as string,
      args.reason as string | undefined
    );
  }

  throw new ValidationError(`Unknown tool "${name}"`);
}

function textResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
