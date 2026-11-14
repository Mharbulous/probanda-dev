// The file-manager plugin's trash CLI: `node trash-cli.js <absolute path>...`. It moves each path
// with fileOpsTrash, the same code as the file_ops__trash tool, including a path in no matter
// (the home or drive-root TRASH mirror). file-manager's trash-rewrite hook turns a lone shell
// delete into a call to it. Bundled by scripts/bundle.mjs to
// source/file-manager/files-mcp/dist/trash-cli.js.
//
// Prints one JSON line per path: the move's result, or {path, error, message} for a refusal.
// Exits 1 when any path was refused, 0 when every one moved.
import { pathToFileURL } from "node:url";

import { DataServerError } from "./errors.js";
import { fileOpsTrash } from "./file_ops/trash.js";

export function runTrashCli(paths: string[], write: (line: string) => void = (l) => process.stdout.write(l + "\n")): number {
  if (paths.length === 0) {
    write(JSON.stringify({ error: "invalid_argument", message: "usage: trash-cli.js <absolute path>..." }));
    return 1;
  }
  let failed = false;
  for (const path of paths) {
    try {
      write(JSON.stringify(fileOpsTrash(path, false, new Date(), {}, true)));
    } catch (err) {
      failed = true;
      const code = err instanceof DataServerError ? err.code : "error";
      write(JSON.stringify({ path, error: code, message: err instanceof Error ? err.message : String(err) }));
    }
  }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = runTrashCli(process.argv.slice(2));
