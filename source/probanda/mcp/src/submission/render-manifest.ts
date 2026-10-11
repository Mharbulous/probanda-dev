// The render stamp and its sidecar manifest (#582, brief §1; stamp inputs decided
// in #581 §1).
//
// A render is a pure function of the stamp's inputs, so a filing whose stamp has
// not moved since its last render never needs rendering again -- comparing stamps
// replaces the work. The manifest lives beside the mockups it describes, one per
// filing, and never inside a document body: the filed face is untouched by
// memoisation.
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
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DataServerError } from "../errors.js";
import { isInventoryEntry, type InventoryEntry } from "./forms/proposal-inventory.js";
import type { WritingLabel } from "./forms/writing-label.js";

export const RENDER_MANIFEST_FILE = "render-manifest.json";

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

export function manifestPath(baseDir: string): string {
  return join(baseDir, RENDER_MANIFEST_FILE);
}

/** Missing, unreadable or malformed all read as "no manifest": the next render rewrites it.
 * A corrupt sidecar costs one render, never a wrong answer. */
export function readManifest(baseDir: string): RenderManifest | null {
  const file = manifestPath(baseDir);
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

export function writeManifest(baseDir: string, manifest: RenderManifest): void {
  writeFileSync(manifestPath(baseDir), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
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
 * existence only -- it opens no mockup file (#581 §5). The mockups tree is OneDrive-synced,
 * where reading a placeholder costs a download on the critical path; existence is
 * answerable from the directory entry alone.
 */
export function renderState(baseDir: string, stamp: RenderStamp, partiesDrift: string): RenderState {
  const manifest = readManifest(baseDir);
  if (manifest === null) return "never";
  if (!stampsEqual(manifest.stamp, stamp) || manifest.parties_drift !== partiesDrift) return "stale";
  return manifest.files.every((f) => existsSync(join(baseDir, f.file_name))) ? "fresh" : "stale";
}

export interface FreshRender {
  manifest: RenderManifest;
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
export function freshManifest(baseDir: string, stamp: RenderStamp, partiesDrift: string): FreshRender | null {
  const manifest = readManifest(baseDir);
  if (manifest === null || !stampsEqual(manifest.stamp, stamp) || manifest.parties_drift !== partiesDrift) return null;
  const contents = new Map<string, string>();
  for (const f of manifest.files) {
    const file = join(baseDir, f.file_name);
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
  return { manifest, contents };
}

/** The folder beside the database that holds every filing's canonical mockup folder. */
export function mockupsRoot(dbPath: string): string {
  return join(dirname(dbPath), "mockups");
}

function filingFolderName(filingId: number): string {
  return `Filing ${filingId}`;
}

/**
 * The title-keyed folders an earlier build wrote (#1317), by the filing id their manifest names.
 * Where two claim one filing (rendered under one title, retitled, rendered again), the later
 * render's wins: the higher revision, then the later `rendered_at`, then the first in directory
 * order. A folder with no readable manifest, or that is already the id folder of the filing its
 * manifest names, is not a candidate.
 */
export function legacyMockupDirs(dbPath: string): Map<number, string> {
  const root = mockupsRoot(dbPath);
  const found = new Map<number, { dir: string; stamp: RenderStamp; renderedAt: string }>();
  if (!existsSync(root)) return new Map();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const manifest = readManifest(dir);
    if (manifest === null || entry.name === filingFolderName(manifest.stamp.filing_id)) continue;
    const held = found.get(manifest.stamp.filing_id);
    const later =
      held === undefined ||
      manifest.stamp.revision > held.stamp.revision ||
      (manifest.stamp.revision === held.stamp.revision && manifest.rendered_at > held.renderedAt);
    if (later) found.set(manifest.stamp.filing_id, { dir, stamp: manifest.stamp, renderedAt: manifest.rendered_at });
  }
  return new Map([...found].map(([id, { dir }]) => [id, dir]));
}

/**
 * The one lookup of a filing's canonical mockup folder (#1317), read-only: `mockups/Filing <id>`
 * when it exists, else the legacy title-keyed folder whose manifest names this filing, else
 * `mockups/Filing <id>`, which the filing's first render creates. Keyed by id, so a retitle never
 * moves the folder and no filing inherits another's by sharing a title. `legacy` is called only
 * when the id folder is missing, so bootstrap can scan once for every filing it lists.
 */
export function mockupDir(dbPath: string, filingId: number, legacy: () => Map<number, string> = () => legacyMockupDirs(dbPath)): string {
  const own = join(mockupsRoot(dbPath), filingFolderName(filingId));
  return existsSync(own) ? own : (legacy().get(filingId) ?? own);
}

/**
 * mockupDir for a mockup render, the folder's only writer. A legacy folder is renamed to
 * `Filing <id>` first, once. A failed rename (the sync client holding the folder) fails the render
 * rather than writing into the legacy folder, which would split the filing across two folders. A
 * `Filing <id>` folder whose manifest names another filing (an older database backup restored, so
 * the id was issued again) is refused, never written or archived into.
 */
export function mockupDirForRender(dbPath: string, filingId: number): string {
  const own = join(mockupsRoot(dbPath), filingFolderName(filingId));
  const dir = mockupDir(dbPath, filingId);
  if (dir !== own) {
    try {
      renameSync(dir, own);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? String(err);
      throw new DataServerError(`could not rename filing ${filingId}'s mockup folder ${dir} to ${own} (${code}); render again once the sync client releases it`);
    }
  }
  const owner = readManifest(own)?.stamp.filing_id;
  if (owner !== undefined && owner !== filingId) {
    throw new DataServerError(`${own}'s render manifest names filing ${owner}, not filing ${filingId}; move that folder aside before rendering filing ${filingId}`);
  }
  return own;
}
