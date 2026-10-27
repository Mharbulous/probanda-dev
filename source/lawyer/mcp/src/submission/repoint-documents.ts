// drafting_data__repoint_documents: /drafting-data's references/document-paths.md "Re-point after a move" as
// one call, for a caller that applies an approved move with no model in the loop.
//
// The drafting database is found from the matter's pointer as drafting_forms__open_session finds it. The two
// statements are the reference's own fenced SQL, read from the skill tree this server ships with, with the
// values bound as named params, so the reference stays their single source. The read is lock-free like
// drafting_data__query; the write takes drafting_data__execute's data lock and staged copy.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ValidationError } from "../errors.js";
import { resolveDbPath, validateMatterRoot } from "../files/matter-root.js";
import { resolveShippedRoot } from "../repo-root.js";
import { submissionDataQuery, submissionDataWrite } from "./backend.js";

const REFERENCE = "drafting-data/references/document-paths.md";

export interface RepointDocumentsRequest {
  matter_root: string;
  old_path: string;
  new_path: string;
}

/** `database` false: the matter has no drafting database, so nothing names the file. */
export interface RepointDocumentsResult {
  database: boolean;
  repointed: number[];
  warning?: string;
}

function fencedSql(text: string, needle: string): string {
  const block = [...text.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]).find((body) => body.includes(needle));
  if (block === undefined) throw new ValidationError(`${REFERENCE} holds no sql block containing "${needle}"`);
  return block;
}

/** The stored form (document-paths.md): matter-relative, backslash separators, no drive, no leading `\` or `.\`. */
function assertStoredForm(field: string, path: string): void {
  if (path.includes("/") || /^[A-Za-z]:/.test(path) || path.startsWith("\\") || path.startsWith(".\\")) {
    throw new ValidationError(`drafting_data__repoint_documents.${field} must be in the stored form (relative to the matter root, backslash separators): ${path}`);
  }
}

export async function repointDocuments(request: RepointDocumentsRequest, env: NodeJS.ProcessEnv = process.env): Promise<RepointDocumentsResult> {
  assertStoredForm("old_path", request.old_path);
  assertStoredForm("new_path", request.new_path);
  const dbPath = resolveDbPath(validateMatterRoot(request.matter_root));
  if (!existsSync(dbPath)) return { database: false, repointed: [] };

  const shipped = resolveShippedRoot(REFERENCE, env, { subject: "the drafting-data document-paths reference", plugin: "litigator" });
  const text = readFileSync(join(shipped.root, ...REFERENCE.split("/")), "utf-8").replace(/\r\n/g, "\n");
  const values = {
    old_path: request.old_path,
    old_absolute: `${request.matter_root.replace(/[\\/]+$/, "")}\\${request.old_path}`,
    new_path: request.new_path,
  };
  // The helper binds a mapping as named params; its declared type is the positional list.
  const params = values as unknown as unknown[];
  const rows = submissionDataQuery(dbPath, fencedSql(text, "-- document paths: rows to re-point"), params).rows;
  if (rows.length === 0) return { database: true, repointed: [] };
  const done = await submissionDataWrite(dbPath, fencedSql(text, "-- document paths: re-point"), params, env);
  const repointed = rows.map((row) => Object.values(row)[0] as number);
  return done.warning ? { database: true, repointed, warning: done.warning } : { database: true, repointed };
}
