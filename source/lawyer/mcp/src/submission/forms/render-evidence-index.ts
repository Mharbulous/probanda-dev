// The VanIAC Evidence Index document.

import { fetchDocumentTenderStatus } from "./document-tenders.js";
import { exhibitNumbersForFiling, fetchFilingDocuments, fetchNotBestCopyMarkers } from "./exhibit-documents.js";
import { gapMarker, isExhibitTenderRole, printMarkerSets, unsponsoredExhibitMarker } from "./markers.js";
import { recordGlyphs } from "./proposal-inventory.js";
import type { RenderContext } from "./render-context.js";
import { frontmatterFor } from "./vaniac-frontmatter.js";

/**
 * Evidence Index: one table, Ex. N / date / description / tendered by,
 * numbered by filing_documents.ordinal (the drafting skill's citation
 * order; issue #321's exhibitNumbersFromOrderedIds is the same numbering,
 * shared with any excerpt citation that cites an exhibit). Excludes
 * role='witness_statement' rows -- those are their own rendered documents
 * (renderWitnessStatements), not exhibits (schema v3 #328/#327). Tendered
 * by (issue #330/#333/#339/#345): every included statements_of_fact row
 * whose exhibit_id is this document -- witness name, and the instrument
 * it's written in when linked -- plus every admissions row whose exhibit
 * is this document and whose derived ladder state is a genuine tender
 * (admissionRole "tenders") or still-live work ("outstanding") -- the
 * admitting party's name. A "spent" admission (denied/refused/no-knowledge/
 * struck -- it tenders nothing) is suppressed from this cell; its event
 * glyph instead prefixes 👤 in the description cell (terms-and-symbols.md:
 * "🙅🏻‍♂️→👤", "⚡️→⏳ ⊕ 👤" -- rendered for the human, not silently
 * dropped, CLAUDE.md's "document" rule). Existence is a flat check across
 * both sources and every party (not per-opposing-party -- the Evidence
 * Index has one row per exhibit, not one per party; see #339's resolution
 * comment) but is state-aware since #345: only a tendering admission
 * clears 👤. Since #398, 👤 and its spent-glyph prefix apply only to
 * role='evidence'/'other' rows (isExhibitTenderRole, markers.ts) -- shared
 * with the Notice of Application's Part 4; the Tendered-by cell itself stays
 * unconditional across every role. Also renders a trailing Source trace
 * section (issue #325) -- a human-side lookup of each exhibit's
 * matter-workspace location and PDF page range, rendered the same way as
 * Held in reserve: for the human, withheld from the forum (CLAUDE.md
 * "document" rule). A NULL file_path renders no line here and no marker
 * on the main table -- work-markers.md's 🏷️ *not recorded* is the nearest
 * glyph, but claiming it for this field is a change-controlled SSOT edit
 * this ticket does not make (issue #325).
 *
 * Known limit, not fixed (Work Board Proposals plan, Phase C defect 5; #777): 🎾, 🕹️, live-admission
 * capture (📑 📌 / 💬 🧷 on an admission) and 🏷️ print only here, on the VanIAC Evidence Index. The NoA
 * Part 4, Application Response Part 6 and BCCA material lists emit none of them, so a Work Board for
 * those filing kinds never proposes that work (design §4: Proposals come only from emitted markers).
 * Record it as a loose thread on the first filing that needs it; do not add the emissions here without that
 * ticket.
 */
export function renderEvidenceIndex(ctx: RenderContext): string {
  // Rows are this filing's own: what this round ships, plus any row the drafter linked as already
  // before the tribunal. The numbers are the proceeding's (#712), so an Opening exhibit cited
  // again in the Reply keeps its original Ex. N.
  const docs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  const exhibitMap = exhibitNumbersForFiling(ctx.dbPath, ctx.filing, docs.map((d) => d.document_id));
  const copyMarkers = fetchNotBestCopyMarkers(ctx.dbPath, ctx.proceeding.id);
  const tenderStatus = fetchDocumentTenderStatus(ctx.dbPath, docs.map((d) => d.document_id), ctx.rendered.slice(0, 10), ctx.inventory);

  const lines: string[] = [];
  lines.push(frontmatterFor("Evidence_index", ctx.proceeding, ctx.filing, ctx.revision, ctx.rendered, ctx.clientName, ctx.clientNo, ctx.matterNo, ctx.matterDescription));
  lines.push("");
  lines.push("| Ex. | Date | Description | Tendered by |");
  lines.push("| --- | --- | --- | --- |");
  docs.forEach((d) => {
    const date = d.document_date ?? "undated";
    const status = tenderStatus.get(d.document_id)!;
    const eligible = isExhibitTenderRole(d.role);
    const marker = eligible ? unsponsoredExhibitMarker(status.hasTender) : "";
    const spentGlyphs = eligible ? status.spentGlyphs : "";
    const gap = d.description ? "" : ` ${gapMarker("not_recorded")}`;
    // Site 8: 🏷️ keys on the document. 👤, the spent-admission rungs and 🏆 never generate.
    recordGlyphs(ctx.inventory, gap.trim(), ["🏷️"], { table: "documents", id: d.document_id, item: d.label });
    const copyMarker = copyMarkers.get(d.document_id) ?? "";
    // All the document's own markers, the spent rungs prefixing the 👤 they route: one set.
    const markers = printMarkerSets([[gap.trim(), spentGlyphs, marker, copyMarker].filter(Boolean).join(" ")]);
    lines.push(
      `| Ex. ${exhibitMap.get(d.document_id)} | ${date} | ${d.description ?? "(not recorded)"}${markers ? ` ${markers}` : ""} | ${status.tenderedBy} | <!-- document_id ${d.document_id} -->`
    );
  });

  if (docs.some((d) => d.file_path)) {
    lines.push("");
    lines.push("## Source trace");
    lines.push("");
    docs.forEach((d) => {
      if (!d.file_path) return;
      lines.push(`- Ex. ${exhibitMap.get(d.document_id)} — ${d.file_path} <!-- document_id ${d.document_id} -->`);
    });
  }

  return lines.join("\n").trimEnd() + "\n";
}
