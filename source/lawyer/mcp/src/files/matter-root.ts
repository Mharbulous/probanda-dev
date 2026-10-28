// The matter root and its matter-data folder, validated the way every matter-scoped
// tool on this surface needs them.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, resolve, win32 as pathWin32 } from "node:path";

import { caseDataFolder } from "../case/backend.js";
import { DataServerError } from "../errors.js";
import { canonicalRoot } from "./scope.js";

/** The matter pointer's file names: probanda.json first, then the legacy coclerk.json, which
 * /matter-data keeps updated with the same content so an older copy of the plugin still finds the
 * matter. Either one marks an initialized matter. */
export const POINTER_FILES: readonly string[] = ["probanda.json", "coclerk.json"];
/** The pointer schema version /matter-data writes (case/backend.ts EXPECTED_SCHEMA_VERSION). */
const POINTER_SCHEMA_VERSION = 5;
const LEGACY_ARTIFACTS_DIR = "9. AI";
const SUBMISSION_DB_FILE = "submission.sqlite";
/** /matter-data's name for a matter's own matter-data folder and for the firm root
 * (CASE_DATA_FOLDER in the matter-data skill's case_data_resolver.py). */
export const CASE_DATA_FOLDER = "0. CASE DATA";

/** root's pointer file: probanda.json when it exists, else coclerk.json when it exists, else undefined. */
export function findPointer(root: string): string | undefined {
  return POINTER_FILES.map((name) => join(root, name)).find((path) => existsSync(path));
}

/**
 * Same legitimacy contract as `matter_data__query`: an existing directory carrying
 * the initialized-matter pointer. Stateless trust decision, no registration
 * handshake for an agent to socially engineer.
 */
export function validateMatterRoot(matterRoot: string): string {
  if (typeof matterRoot !== "string" || matterRoot.length === 0) {
    throw new DataServerError("matter_root is required", "invalid_root");
  }
  if (!pathWin32.isAbsolute(matterRoot)) {
    throw new DataServerError(`matter_root must be an absolute path: ${matterRoot}`, "invalid_root");
  }

  const canon = canonicalRoot(matterRoot, `matter_root not found: ${matterRoot}`, "invalid_root");
  if (!statSync(canon).isDirectory()) {
    throw new DataServerError(`matter_root is not a directory: ${matterRoot}`, "invalid_root");
  }
  if (findPointer(canon) === undefined) {
    throw new DataServerError(
      `matter_root has no probanda.json or coclerk.json — not an initialized matter: ${matterRoot}`,
      "invalid_root"
    );
  }
  return canon;
}

/** #651: matter_root's one `0. DRAFT*` child, matched as submission/forms.ts's resolveDraftDir
 * matches it, or undefined when there is none. Two or more is an ambiguity and refuses. A junction is
 * kept as a match so the caller refuses it on its real path rather than it being skipped silently.
 * The confinement itself stays with the caller. */
export function findDraftDir(root: string): string | undefined {
  const matches = readdirSync(root, { withFileTypes: true })
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && /^0\. DRAFT/i.test(e.name))
    .map((e) => e.name)
    .sort();
  if (matches.length > 1) {
    throw new DataServerError(
      `${root} has ${matches.length} 0. DRAFT folders (${matches.map((m) => `"${m}"`).join(", ")}); ` +
        "keep one so the Litigation Strategy has a single home.",
      "draft_dir_ambiguous"
    );
  }
  return matches.length === 1 ? join(root, matches[0]) : undefined;
}

/**
 * The matter's matter-data folder, canonical: the one its pointer's `case_data_dir` names, as
 * `matter_data__query` resolves it. It must already exist; this server never creates it.
 */
export function existingCaseDataFolder(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const dir = caseDataFolder(root, env);
  const missing = `the matter's matter-data folder does not exist: ${dir}. Run /matter-data initialize on this matter first.`;
  const canon = canonicalRoot(dir, missing, "case_data_missing");
  if (!statSync(canon).isDirectory()) throw new DataServerError(missing, "case_data_missing");
  return canon;
}

function pointerRefusal(root: string, why: string): DataServerError {
  return new DataServerError(
    `${findPointer(root) ?? join(root, POINTER_FILES[0])} ${why}. Run /matter-data on this matter to initialize or repair its pointer; ` +
      "drafting_forms__open_session never rewrites it.",
    "pointer_unusable"
  );
}

/** matter_root -> the case_data_dir its pointer (findPointer) names, normalized, read-only. The pointer
 * convention is /drafting-data's; a missing or legacy pointer is refused and handed to /matter-data. */
export function resolveCaseDataDir(root: string): string {
  let pointer: Record<string, unknown>;
  try {
    pointer = JSON.parse(readFileSync(findPointer(root) ?? join(root, POINTER_FILES[0]), "utf-8").replace(/\0/g, "")) as Record<string, unknown>;
  } catch (err) {
    throw pointerRefusal(root, `is not readable JSON (${(err as Error).message})`);
  }
  if (pointer.schema_version !== POINTER_SCHEMA_VERSION) {
    throw pointerRefusal(root, `is schema_version ${JSON.stringify(pointer.schema_version)}, expected ${POINTER_SCHEMA_VERSION}`);
  }
  const stored = pointer.case_data_dir;
  if (typeof stored !== "string" || stored === "") {
    throw pointerRefusal(root, "has no case_data_dir");
  }
  const caseDataDir = normalize(isAbsolute(stored) ? stored : resolve(root, stored));
  if (caseDataDir.toLowerCase() === normalize(join(root, LEGACY_ARTIFACTS_DIR)).toLowerCase()) {
    throw pointerRefusal(root, `still points at the legacy "${LEGACY_ARTIFACTS_DIR}" folder`);
  }
  return caseDataDir;
}

/** matter_root -> db_path, read-only. A missing database whose matter-data folder's parent is also
 * missing is a pointer written on another device (another Windows profile or drive): it is refused
 * as unusable and handed to /matter-data, never to drafting_data__migrate. */
export function resolveDbPath(root: string): string {
  const caseDataDir = resolveCaseDataDir(root);
  const dbPath = join(caseDataDir, SUBMISSION_DB_FILE);
  if (!existsSync(dbPath) && !existsSync(dirname(caseDataDir))) {
    throw pointerRefusal(root, `names ${caseDataDir}, whose parent folder does not exist on this device`);
  }
  return dbPath;
}

/**
 * The case data root a matter's matter-data folder sits in, for when the per-user probanda.json is
 * absent. For a folder under the firm root it is the folder's parent, accepted only when that
 * parent is a `0. CASE DATA` folder or the folder COCLERK_CASE_DATA_ROOT names. For a matter's own
 * `0. CASE DATA` folder (ADR 0013) it is the `0. CASE DATA` folder beside the matter folder. Either
 * must be an existing directory. Anything else is null, never a guess, so the caller's
 * missing-file error stands. Writes nothing.
 */
export function caseDataRootFromCaseDataDir(dir: string, env: NodeJS.ProcessEnv): string | null {
  const normal = normalize(dir);
  const inMatter = basename(normal).toLowerCase() === CASE_DATA_FOLDER.toLowerCase();
  const parent = inMatter ? join(dirname(dirname(normal)), CASE_DATA_FOLDER) : dirname(normal);
  const override = env.COCLERK_CASE_DATA_ROOT;
  const named =
    inMatter ||
    basename(parent).toLowerCase() === CASE_DATA_FOLDER.toLowerCase() ||
    (!!override && normalize(override).toLowerCase() === parent.toLowerCase());
  if (!named) return null;
  let canon: string;
  try {
    canon = canonicalRoot(parent, `case data root not found: ${parent}`);
  } catch {
    return null;
  }
  return statSync(canon).isDirectory() ? canon : null;
}

/** The same, from a matter folder through its pointer. An invalid folder or an unusable
 * pointer refuses (invalid_root, pointer_unusable) rather than returning null. */
export function caseDataRootFromMatterRoot(matterRoot: unknown, env: NodeJS.ProcessEnv): string | null {
  const root = validateMatterRoot(matterRoot as string);
  return caseDataRootFromCaseDataDir(resolveCaseDataDir(root), env);
}

/** The same, from a drafting database, which sits directly in the matter's matter-data folder. */
export function caseDataRootFromDbPath(dbPath: string, env: NodeJS.ProcessEnv): string | null {
  return caseDataRootFromCaseDataDir(dirname(dbPath), env);
}
