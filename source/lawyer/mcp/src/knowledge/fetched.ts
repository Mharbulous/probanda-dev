// ------------------------------------------------------------ saved copies --

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { assertContained } from "../files/scope.js";
import type { FrontMatter } from "../sources/check.js";
import { inTree, KNOWLEDGE_SKILLS, parseKnowledgePath, readLayerBytes, shippedLayer, entryType, type KnowledgePath, type KnowledgeSeams } from "./tree.js";
import { grammarCheck, overlayCanon, writableOverlayPath } from "./overlay.js";

export interface SavedCopy {
  /** The knowledge path the caller named, under `_inbox\`. */
  path: string;
  abs: string;
  /** Present when the file is a PDF: its hash and the `_fetched\` path it is copied to. */
  pdf: { sha256: string; to: KnowledgePath } | null;
}

/**
 * The practitioner's saved copy a source record's create names (#1143): a file under
 * `_inbox\`, proven there by its real path, read and hashed before anything is written.
 * A PDF (by its `%PDF-` bytes) goes to `_fetched\<host>\<first 12 hex>.pdf`, the host of
 * `pdf_url` when the record has one, else of `page_url`. Any other file is left unhashed.
 */
export function savedCopyOf(raw: unknown, record: string, front: FrontMatter, seams: KnowledgeSeams): SavedCopy {
  const label = "knowledge__write.saved_copy";
  if (typeof raw !== "string") throw new ValidationError(`${label} must be the knowledge path of a file under _inbox`);
  const kp = parseKnowledgePath(raw, label);
  if (kp.head !== "_inbox" || kp.rest.length === 0) {
    throw new DataServerError(`${label}: ${kp.path} is not a file under _inbox, where the practitioner saves a copy`, "invalid_saved_copy");
  }
  grammarCheck(kp, "file", label);
  if (typeof front.page_url !== "string" || front.page_url === "") {
    throw new DataServerError(`${label}: ${record} is not a source record (its front matter has no page_url), so it takes no saved copy`, "invalid_saved_copy");
  }
  const url = typeof front.pdf_url === "string" ? front.pdf_url : front.page_url;
  const canon = overlayCanon(seams, label);
  const inboxAbs = pathWin32.join(canon, "_inbox");
  const abs = pathWin32.join(inboxAbs, ...kp.rest);
  const inboxCanon = existsSync(inboxAbs) ? realpathSync.native(inboxAbs) : null;
  if (inboxCanon !== null) assertContained(canon, inboxCanon, label, kp.path);
  const type = entryType({ canon: inboxCanon, abs }, label, kp.path);
  if (type === null) throw new DataServerError(`${label}: ${kp.path} is not in the overlay`, "not_found");
  if (type === "dir") throw new DataServerError(`${label}: ${kp.path} is a folder; name the saved file`, "not_a_file");
  const bytes = readLayerBytes(abs, label);
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    if (front.pdf_sha256 !== undefined) {
      throw new DataServerError(`${label}: ${kp.path} is not a PDF, so ${record} records no pdf_sha256 for it; remove the field`, "invalid_saved_copy");
    }
    return { path: kp.path, abs, pdf: null };
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new ValidationError(`${record}: ${JSON.stringify(url)} is not a URL, so the saved copy has no host folder`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const to = parseKnowledgePath(`_fetched/${host}/${sha256.slice(0, 12)}.pdf`, label);
  grammarCheck(to, "file", label);
  return { path: kp.path, abs, pdf: { sha256, to } };
}

/**
 * Copy a saved PDF into `_fetched\` once its record is written, leaving the original in
 * `_inbox\`: a file Probanda did not create is only ever read or copied, never moved. The
 * record already holds its hash, so a failed copy is reported in the result, not thrown.
 */
export function copySavedCopy(saved: SavedCopy, seams: KnowledgeSeams, label: string): Record<string, unknown> {
  if (!saved.pdf) return { path: saved.path, copied: false, reason: "not_pdf" };
  try {
    copyFileSync(saved.abs, writableOverlayPath(saved.pdf.to, seams, label).abs);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code !== "string") throw err;
    return { path: saved.path, copied: false, error: code };
  }
  return { path: saved.path, copied: true, to: saved.pdf.to.path, sha256: saved.pdf.sha256 };
}

// ------------------------------------------------------------ fetched PDFs --

const PDF_SHA_LINE = /^\s*pdf_sha256:\s*["']?([0-9a-fA-F]{64})["']?\s*$/gm;

export function pdfHashesIn(text: string): string[] {
  return [...new Set([...text.matchAll(PDF_SHA_LINE)].map((m) => m[1].toLowerCase()))];
}

/**
 * The text of every live knowledge file: each skill tree in the overlay and in the shipped
 * layer, never `_superseded`, `_fetched` or `_inbox`.
 */
function liveKnowledgeTexts(canon: string, seams: KnowledgeSeams): string[] {
  const texts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = pathWin32.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".md")) texts.push(readFileSync(abs, "utf-8").toLowerCase());
    }
  };
  for (const skill of KNOWLEDGE_SKILLS) {
    const dir = pathWin32.join(canon, skill);
    if (existsSync(dir)) walk(dir);
    // A shipped root holds the skill's ordinary references beside its tree; only country folders are the tree.
    const shipped = shippedLayer(skill, [], seams).layer.canon;
    if (shipped === null) continue;
    for (const entry of readdirSync(shipped, { withFileTypes: true })) {
      if (entry.isDirectory() && inTree([entry.name])) walk(pathWin32.join(shipped, entry.name));
    }
  }
  return texts;
}

/**
 * After a retire or a refresh took `hashes` out of a file, delete each
 * `_fetched\<host>\<first 12>.pdf` whose hash no live excerpt, overlay or shipped, records
 * any more. The overlay's only deletion (shared/knowledge-tree.md section 6).
 */
export function deleteUnreferencedPdfs(hashes: string[], seams: KnowledgeSeams, label: string): string[] {
  if (hashes.length === 0) return [];
  const canon = overlayCanon(seams, label);
  const fetched = pathWin32.join(canon, "_fetched");
  if (!existsSync(fetched)) return [];
  const live = liveKnowledgeTexts(canon, seams);
  const deleted: string[] = [];
  for (const hash of hashes) {
    if (live.some((text) => text.includes(hash))) continue;
    for (const host of readdirSync(fetched, { withFileTypes: true })) {
      if (!host.isDirectory()) continue;
      const name = `${hash.slice(0, 12)}.pdf`;
      const pdf = pathWin32.join(fetched, host.name, name);
      if (!existsSync(pdf)) continue;
      try {
        unlinkSync(pdf);
      } catch (err) {
        // A concurrent retire or refresh deleted it first.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      deleted.push(`_fetched/${host.name}/${name}`);
    }
  }
  return deleted;
}
