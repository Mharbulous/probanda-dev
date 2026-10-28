// The render stamp and its sidecar manifest (#582, brief §1; stamp inputs decided
// in #581 §1).
//
// A render is a pure function of the stamp's inputs, so a filing whose stamp has
// not moved since its last render never needs rendering again -- comparing stamps
// replaces the work. The manifest is one file per filing in the matter's records folder
// (`0. DRAFT\Drafting records\`, spec 2026-10-22 §9), never inside a document body: the
// filed face is untouched by memoisation. It names the Writing's own folder in `0. DRAFT`,
// where the mockups it lists are.
//
// The Job Board is deliberately absent from `files` (#581 §2). It is rebuilt from
// SQLite on every render and bootstrap, it carries session lock tokens, and its
// data reads the ticket tables, whose writes are exempt from the revision bump.
// Hashing it would mismatch on every call and defeat the mechanism. Its marker
// inventory is a field here all the same (Work Board Proposals design §8): the board
// is not memoised, but its proposed and Shelved lanes must still be derivable
// on a stamp hit, when no advocacy renderer runs to refill the inventory.
//
// Consequence, accepted: every manifest written before that field landed reads as "no
// manifest" once. Bootstrap reports `render_state: "never"` and `existingMockupPaths`
// lists no advocacy paths for such a filing until the next render, or the background
// job, rewrites it. A hit with the field removed is a miss by construction, so no
// pending state exists anywhere -- a stale or missing inventory is never drawn,
// because it is never read.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { CASE_DATA_FOLDER, findDraftDir } from "../files/matter-root.js";
import { zoneProblem } from "../files/zones.js";
import { isInventoryEntry, type InventoryEntry } from "./forms/proposal-inventory.js";
import type { WritingLabel } from "./forms/writing-label.js";

/** The one folder in the matter's `0. DRAFT` that holds the drafting bookkeeping: each filing's render
 * manifest and the pages' state file (spec 2026-10-22 §9). */
export const RECORDS_FOLDER = "Drafting records";

/** The manifest an older build wrote inside each `<case data>\mockups\Filing <id>\` folder; read only
 * by the move into `0. DRAFT` (writing-folder.ts). */
export const LEGACY_MANIFEST_FILE = "render-manifest.json";

/**
 * Every input an advocacy document's bytes depend on (#581 §1).
 *
 * `appeal_deadline` is deliberately absent: it reaches only deriveLifecycle, and
 * lifecycle is read only by the Job Board, which sits outside the stamp. The
 * local `date` is present because today drives the admission ladder's
 * waiting -> deemed switch and the Consent Order bench line, so every live filing
 * goes stale once per local day -- the accepted cost of stamping the input rather
 * than the derived states, since a renderer that later starts reading the date
 * would otherwise have to remember to add itself.
 *
 * `schema_version` is present because migrations never move db_meta.revision.
 */
export interface RenderStamp {
  filing_id: number;
  revision: number;
  /** Greatest review_approvals.id, 0 with none: an approval is revision-exempt, so this is what
   * makes a render after one miss the manifest (practitioner-review plan Phase 5). */
  approvals: number;
  schema_version: number | null;
  build_stamp: string | null;
  /** The *resolved* client fields -- clientName falls back to proceeding.matter_reference. */
  client_name: string;
  client_no: string;
  matter_no: string;
  /** Local YYYY-MM-DD, the date part of the render's single clock read. */
  date: string;
}

export interface ManifestFile {
  document_type: string;
  file_name: string;
  sha256: string;
  /** The Job Board's Writings strip label (short text and `title` text). Absent on a manifest written
   * before 2026-10-07; the page then shows the file name until the next render that misses. */
  label?: WritingLabel;
}

export interface RenderManifest {
  stamp: RenderStamp;
  /** The Writing's own folder, one name directly under the matter's `0. DRAFT`, which holds the files
   * listed here. Named after the document when first rendered and kept on a retitle (writing-folder.ts). */
  folder: string;
  /** The `Rendered:` minute the listed files carry. A stamp hit writes nothing, so each
   * mockup keeps its original minute and this is what `rendered_at` reports (#581 §3). */
  rendered_at: string;
  files: ManifestFile[];
  /** The marker inventory of the render that wrote these files (Work Board Proposals design §8).
   * Read on a stamp hit so buildWorkBoardData derives the Proposals without re-rendering the
   * advocacy documents. Absent or malformed reads as no manifest. */
  inventory: InventoryEntry[];
  /** A digest of the party drift the render marked (party/counsel SSOT, forms.ts). Drift reads case
   * data, whose writes move no stamp input, so a hit also needs the drift unchanged. A manifest
   * written before this field never hits, and the next render rewrites it. Bootstrap's renderState
   * compares it too, so such a manifest reads stale there (#1308). */
  parties_drift?: string;
}

export type RenderState = "fresh" | "stale" | "never";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** A filing's manifest file in the matter's records folder. */
export function manifestPath(dbPath: string, filingId: number): string {
  return join(recordsDir(dbPath), `render-manifest-${filingId}.json`);
}

/** recordsDir, or undefined when the matter has no 0. DRAFT folder, so no Writing of it has a mockup or
 * a manifest. Only a reader uses it; a writer calls recordsDir and is refused. */
export function recordsDirIfAny(dbPath: string): string | undefined {
  try {
    return recordsDir(dbPath);
  } catch (err) {
    if (err instanceof DataServerError && err.code === "draft_dir_missing") return undefined;
    throw err;
  }
}

/** Whether `name` is one folder name, as a manifest's `folder` must be. */
function isFolderName(name: unknown): name is string {
  return typeof name === "string" && name.trim() !== "" && name !== "." && name !== ".." && !/[\\/]/.test(name);
}

function parseManifest(file: string): RenderManifest | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as RenderManifest;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.stamp ||
      !Array.isArray(parsed.files) ||
      !Array.isArray(parsed.inventory) ||
      !parsed.inventory.every(isInventoryEntry)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Missing, unreadable or malformed all read as "no manifest": the next render rewrites it.
 * A corrupt sidecar costs one render, never a wrong answer. So does one naming no folder, or
 * another filing. A matter with no 0. DRAFT folder has no manifest: nothing of it was rendered. */
export function readManifest(dbPath: string, filingId: number): RenderManifest | null {
  const records = recordsDirIfAny(dbPath);
  if (records === undefined) return null;
  const parsed = parseManifest(join(records, `render-manifest-${filingId}.json`));
  return parsed !== null && isFolderName(parsed.folder) && parsed.stamp.filing_id === filingId ? parsed : null;
}

/** An older build's manifest inside a case-data mockup folder, which names no folder. */
export function readLegacyManifest(dir: string): Omit<RenderManifest, "folder"> | null {
  return parseManifest(join(dir, LEGACY_MANIFEST_FILE));
}

export function writeManifest(dbPath: string, filingId: number, manifest: RenderManifest): void {
  mkdirSync(recordsDir(dbPath), { recursive: true });
  writeFileSync(manifestPath(dbPath, filingId), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/** The folder a manifest's files are in. */
export function manifestDir(dbPath: string, manifest: RenderManifest): string {
  return join(draftDirOf(dbPath), manifest.folder);
}

export function stampsEqual(a: RenderStamp, b: RenderStamp): boolean {
  return (
    a.filing_id === b.filing_id &&
    a.revision === b.revision &&
    a.approvals === b.approvals &&
    a.schema_version === b.schema_version &&
    a.build_stamp === b.build_stamp &&
    a.client_name === b.client_name &&
    a.client_no === b.client_no &&
    a.matter_no === b.matter_no &&
    a.date === b.date
  );
}

/**
 * What bootstrap reports per filing, from the manifest, the party drift digest and file
 * existence only -- it opens no mockup file (#581 §5). The draft folder is cloud-synced,
 * where reading a placeholder costs a download on the critical path; existence is
 * answerable from the directory entry alone.
 */
export function renderState(dbPath: string, filingId: number, stamp: RenderStamp, partiesDrift: string): RenderState {
  const manifest = readManifest(dbPath, filingId);
  if (manifest === null) return "never";
  if (!stampsEqual(manifest.stamp, stamp) || manifest.parties_drift !== partiesDrift) return "stale";
  const dir = manifestDir(dbPath, manifest);
  return manifest.files.every((f) => existsSync(join(dir, f.file_name))) ? "fresh" : "stale";
}

export interface FreshRender {
  manifest: RenderManifest;
  /** The Writing's folder the files were read from. */
  dir: string;
  /** file_name -> the bytes just verified, so a hit never reads the same file twice. */
  contents: Map<string, string>;
}

/**
 * The manifest when every stamp field matches, the party drift digest matches, and every
 * file it lists is still byte-for-byte what it recorded; null otherwise.
 *
 * Unlike renderState above, this opens each file: a mockup edited by hand, or
 * reverted by the sync client, must not be served as fresh. A mismatch returns null
 * and the caller renders as it always has -- which rewrites the file without
 * archiving, because db_meta.revision has not moved and archiveIfStale only archives
 * when it has.
 */
export function freshManifest(dbPath: string, filingId: number, stamp: RenderStamp, partiesDrift: string): FreshRender | null {
  const manifest = readManifest(dbPath, filingId);
  if (manifest === null || !stampsEqual(manifest.stamp, stamp) || manifest.parties_drift !== partiesDrift) return null;
  const dir = manifestDir(dbPath, manifest);
  const contents = new Map<string, string>();
  for (const f of manifest.files) {
    const file = join(dir, f.file_name);
    if (!existsSync(file)) return null;
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      return null;
    }
    if (sha256(text) !== f.sha256) return null;
    contents.set(f.file_name, text);
  }
  return { manifest, dir, contents };
}

/** #585 (#583 §4, ADR 0012's confinement extended): bootstrap's draft_dir (and render's, #689) must be the matter's
 * `0. DRAFT*` folder itself, existing, and outside any privileged or disclosed tree. Checked on the
 * real path, so a junction named `0. DRAFT` that leads elsewhere is refused. */
export function resolveDraftDir(draftDir: string, param = "drafting_forms__bootstrap.draft_dir"): string {
  const refuse = (why: string) => new ValidationError(`${param} ${draftDir}: ${why}`);
  if (!isAbsolute(draftDir)) throw refuse("must be an absolute path");
  const dir = resolve(draftDir);
  let real: string;
  try {
    real = realpathSync.native(dir);
  } catch {
    throw refuse("does not exist");
  }
  if (!/^0\. DRAFT/i.test(basename(real))) throw refuse("must be the matter's 0. DRAFT folder");
  if (zoneProblem("write", real)) throw refuse("it lies inside a privileged or disclosed tree, TRASH or 0. CASE DATA");
  return dir;
}

/**
 * The matter's `0. DRAFT` folder for a drafting database (spec 2026-10-22 §9): the one `0. DRAFT*`
 * folder of the matter folder whose `0. CASE DATA` holds the database (ADR 0013), confined as
 * resolveDraftDir confines it. Every Writing's mockups, its Job Board page and the records folder
 * are in it, so a database with none is refused, never given a folder elsewhere.
 */
export function draftDirOf(dbPath: string): string {
  const caseData = dirname(resolve(dbPath));
  const matter = dirname(caseData);
  let found: string | undefined;
  if (basename(caseData).toLowerCase() === CASE_DATA_FOLDER.toLowerCase()) {
    try {
      found = findDraftDir(matter);
    } catch (err) {
      if (err instanceof DataServerError) throw err;
      found = undefined;
    }
  }
  if (found === undefined) {
    throw new DataServerError(
      `no 0. DRAFT folder beside ${caseData}. A Writing's mockups are written in its matter's 0. DRAFT folder, found ` +
        "beside the matter's own 0. CASE DATA folder that holds the database. Create the matter's 0. DRAFT folder; a matter " +
        "whose case data is still under the firm's 0. CASE DATA folder is moved into the matter folder first with /matter-data relocate.",
      "draft_dir_missing"
    );
  }
  return resolveDraftDir(found, `the 0. DRAFT folder of ${matter}`);
}

/** The matter's records folder, which holds every render manifest and the pages' state file. */
export function recordsDir(dbPath: string): string {
  return join(draftDirOf(dbPath), RECORDS_FOLDER);
}
