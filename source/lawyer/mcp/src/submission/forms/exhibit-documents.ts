// Document reads and "Ex. N" exhibit numbering.

import { notBestCopyMarkers, type DocumentCopyRow } from "./markers.js";
import type { FilingRow } from "./query.js";
import { rows } from "../query-rows.js";

export function fetchDocumentLabels(dbPath: string, documentIds: number[]): Map<number, string> {
  if (documentIds.length === 0) return new Map();
  const placeholders = documentIds.map(() => "?").join(",");
  const found = rows<{ id: number; label: string }>(dbPath, `SELECT id, label FROM documents WHERE id IN (${placeholders})`, documentIds);
  return new Map(found.map((d) => [d.id, d.label]));
}

/** Per-document 🏆 map for one proceeding (issue #364) -- proceeding-wide, not
 * filing-scoped, so a sibling copy marked best elsewhere in the proceeding
 * still clears a group even when that sibling isn't referenced by this render. */
export function fetchNotBestCopyMarkers(dbPath: string, proceedingId: number): Map<number, string> {
  return notBestCopyMarkers(
    rows<DocumentCopyRow>(dbPath, `SELECT id, label, is_best_copy FROM documents WHERE proceeding_id = ?`, [proceedingId])
  );
}

/** "Ex. N" numbering shared between the Evidence Index and every excerpt citation that cites an exhibit (issue #321/#325/#330): array position over an already-ordered document id list. Pure -- every caller supplies its own ordered ids (this file's fetchFilingDocuments below, or Notice of Application's own PART 4 list) so "Ex. N" means the same document everywhere it's cited in one rendered document set. */
export function exhibitNumbersFromOrderedIds(documentIds: number[]): Map<number, number> {
  const map = new Map<number, number>();
  documentIds.forEach((id, i) => map.set(id, i + 1));
  return map;
}

/** "Ex. N" across a VanIAC proceeding's whole run of rounds (#712), not one filing: a document
 * keeps the number it was first given for the life of the proceeding, so an Opening exhibit stays
 * Ex. 3 when a Reply cites it, and the Reply's own new exhibits continue after the highest already
 * assigned. Neither forum requires this -- the VanIAC Rules never say "exhibit", and Supreme Court
 * Civil Rules 22-2 and 8-1 read complete impose nothing on labelling across rounds -- so it is the
 * firm's convention, settled on #712, recorded in /draft's VanIAC type file.
 *
 * Scoped to kind='submissions_package' deliberately. On a BCSC or BCCA face, Part 4/Part 6 lists
 * its material with form-local numbered paragraphs (render-notice-of-application, Part 4;
 * render-application-response, Part 6) while Part 5 excerpts cite Ex. N from this map; those two
 * coincide only while both are positional over the same filing-scoped list. Continuing across the
 * proceeding there would print "1., 2., 3." in the list and cite "Ex. 8" in the excerpts. In BCSC
 * the label the forum reads is the affidavit letter (#712 decision 5), and Ex. N is a pointer into
 * the form's own list -- so those emitters stay on fetchFilingDocuments.
 *
 * Ordering puts filed rounds first in the order they were filed, then drafts by filing id, each
 * round by its own ordinal, first occurrence of a document winning. The 23->24 guard triggers make
 * a filed filing's rows immutable, so every filed document's position -- and therefore its number
 * -- is fixed, while a draft's numbers still follow its ordinal. Never-filed retired drafts are
 * excluded: an abandoned draft must not consume a number. */
export function fetchProceedingExhibitNumbers(dbPath: string, proceedingId: number): Map<number, number> {
  const ordered = rows<{ document_id: number }>(
    dbPath,
    `SELECT fd.document_id
     FROM filing_documents fd
     JOIN filings f ON f.id = fd.filing_id
     WHERE f.proceeding_id = ?
       AND f.kind = 'submissions_package'
       AND fd.role != 'witness_statement'
       AND NOT (f.retired_on IS NOT NULL AND f.filed_on IS NULL)
     ORDER BY (f.filed_on IS NULL), f.filed_on, f.id, fd.ordinal`,
    [proceedingId]
  );
  const seen = new Set<number>();
  const firstOccurrence: number[] = [];
  for (const r of ordered) {
    if (seen.has(r.document_id)) continue;
    seen.add(r.document_id);
    firstOccurrence.push(r.document_id);
  }
  return exhibitNumbersFromOrderedIds(firstOccurrence);
}

/** The exhibit map a render must use, chosen by filing kind -- the one place that choice is made,
 * so no surface can drift from the others (#712).
 *
 * A VanIAC submissions package numbers across the proceeding's whole run of rounds. Every other
 * kind stays filing-scoped: on a BCSC or BCCA face, Part 4 / Part 6 lists the material with
 * form-local numbered paragraphs that are positional over the filing, while Part 5 excerpts cite
 * Ex. N from this map. The two coincide only while both are positional over the same list, so a
 * proceeding-wide sequence there would print "1., 2., 3." in the list and cite "Ex. 8" in the
 * excerpts. In BCSC the label the forum reads is the affidavit letter anyway. */
export function exhibitNumbersForFiling(
  dbPath: string,
  filing: { kind: FilingRow["kind"]; proceeding_id: number },
  filingDocumentIds: number[]
): Map<number, number> {
  return filing.kind === "submissions_package"
    ? fetchProceedingExhibitNumbers(dbPath, filing.proceeding_id)
    : exhibitNumbersFromOrderedIds(filingDocumentIds);
}

export interface FilingDocumentRow {
  id: number;
  document_id: number;
  ordinal: number;
  role: string;
  label: string;
  document_date: string | null;
  description: string | null;
  file_path: string | null;
  /** 'already_in_court_file' marks a row the drafter listed rather than shipped -- material
   * already before the forum from an earlier round (#712). The pre-filing gate reads it to tell
   * a cited-not-shipped exhibit apart from a missing one. */
  provenance: "served_with_this_response" | "already_in_court_file" | null;
}

export function fetchFilingDocuments(dbPath: string, filingId: number): FilingDocumentRow[] {
  return rows<FilingDocumentRow>(
    dbPath,
    `SELECT fd.id, fd.document_id, fd.ordinal, fd.role, fd.provenance, d.label, d.document_date, d.description, d.file_path
     FROM filing_documents fd
     JOIN documents d ON d.id = fd.document_id
     WHERE fd.filing_id = ? AND fd.role != 'witness_statement'
     ORDER BY fd.ordinal`,
    [filingId]
  );
}
