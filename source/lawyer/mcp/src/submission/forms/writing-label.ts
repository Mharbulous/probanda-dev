// The Work Board's Writings strip labels: a short label drawn on each Writing's thumbnail and a
// fuller description for its title. Computed at render time and stored on the render manifest's
// file entries (render-manifest.ts ManifestFile.label).
//
// The codes are copied from the firm's file-naming code registry
// (.claude/skills/file-naming/references/code-registry.md) because the runtime reads no skill
// file. The three with no registry entry (RB, WA, INDEX) are chosen here.

import type { AffidavitRow } from "./render-bcsc-affidavit.js";

export interface WritingLabel {
  short: string;
  long: string;
}

const DOCUMENT_CODES: Record<string, { code: string; name: string }> = {
  Notice_of_application: { code: "NOA", name: "Notice of Application" },
  Application_response: { code: "AR", name: "Application Response" },
  Requisition: { code: "REQ", name: "Requisition" },
  Default_judgment: { code: "DJ", name: "Default Judgment" },
  Consent_order: { code: "CO", name: "Consent Order" },
  Factum: { code: "FACTUM", name: "Factum" },
  Response_book: { code: "RB", name: "Response Book" },
  Written_arguments: { code: "WA", name: "Written Arguments" },
  Evidence_index: { code: "INDEX", name: "Evidence Index" },
};

/** The stored layout title every stock type carries (`unstructured.md`, `unstructured-<recipient>.md`):
 * such a Writing's document name is its own title (spec 2026-10-22). */
const STOCK_TITLE = "Unstructured";

/** A general Writing's document name, for its file name, its strip label and its header's Document
 * Type: its own title on a stock type, else its type's title. */
export function generalDocumentName(layoutTitle: string, writingTitle: string): string {
  return layoutTitle === STOCK_TITLE ? writingTitle : layoutTitle;
}

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

/** The document type's code and name, or the file name without its extension for both. */
export function typeLabel(documentType: string, fileName: string): WritingLabel {
  const row = DOCUMENT_CODES[documentType];
  if (row !== undefined) return { short: row.code, long: row.name };
  const stem = fileName.replace(/\.[^.]+$/, "");
  return { short: stem, long: stem };
}

/** The venue document's label with the Writing's subject: its title less the kind's name at the front. */
export function withSubject(label: WritingLabel, title: string): WritingLabel {
  let subject = title.trim();
  if (subject.toLowerCase().startsWith(label.long.toLowerCase())) {
    subject = subject.slice(label.long.length).replace(/^(?:[:\s\-–—]|re\b)+/i, "");
  }
  subject = subject.trim();
  if (subject === "") return label;
  return { short: `${label.short} ${subject}`, long: `${label.long} - ${subject}` };
}

/** An affidavit's label from its number and deponent; the row's own label when no deponent is recorded. */
export function affidavitLabel(a: Pick<AffidavitRow, "affidavit_number" | "deponent_name" | "label">): WritingLabel {
  const n = a.affidavit_number === null ? null : a.affidavit_number.trim().replace(/^#/, "");
  const code = n === null ? "AFF" : `AFF#${n}`;
  if (a.deponent_name === null) return { short: code, long: a.label };
  const deponent = a.deponent_name;
  let long: string;
  if (n === null) long = `Affidavit of ${deponent}`;
  else if (/^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= 10) long = `${ORDINALS[Number(n) - 1]} affidavit of ${deponent}`;
  else long = `Affidavit #${n} of ${deponent}`;
  return { short: `${code} ${deponent}`, long };
}

/** A VanIAC witness statement's label. */
export function witnessStatementLabel(witnessName: string): WritingLabel {
  return { short: `WSS ${witnessName}`, long: `Witness statement of ${witnessName}` };
}
