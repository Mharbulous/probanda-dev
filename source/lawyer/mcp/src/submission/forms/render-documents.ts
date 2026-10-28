// The documents one filing renders, venue document first.

import { GENERAL_DOCUMENT_TYPE, generalDocumentName, sanitizeForPath } from "../writing-folder.js";
import { requireForum } from "./query.js";
import { renderWitnessStatements, type RenderContext } from "./render-vaniac-submissions.js";
import { composeFiller } from "./filler-registry.js";
import { scalarValue, type CitedState, type StoredLayout } from "./layout-snapshot.js";
import { renderGeneral } from "./render-general.js";
import { type CurrencyWithheld, type ProseFormatHit } from "./projections.js";
import { recordReserveInventory, renderWrittenArguments } from "./render-companions.js";
import { RESERVE_INVENTORY_DOC } from "./render-work-board.js";
import { typeLabel, withSubject, witnessStatementLabel, type WritingLabel } from "./writing-label.js";
import { stampDoc } from "./proposal-inventory.js";
import { type PhaseTimings, timed } from "./timings.js";

export interface DocumentOutput {
  documentType: string;
  fileName: string;
  markdown: string;
  /** The Milestone Writings strip's short label and `title` text; stored in the manifest. */
  label: WritingLabel;
  /** A general Writing only: the parts it printed with no content, which the filed render refuses on. */
  unwritten?: string[];
  /** A general Writing only: the clause lines it tagged `[currency: ...]`, which the filed render refuses on. */
  currency_withheld?: CurrencyWithheld[];
  /** A general Writing only: the prose lines breaking a refused format rule, which the filed render refuses on. */
  prose_format?: ProseFormatHit[];
}

/** One document's render, timed as `render <fileName>`. Every inventory entry the render records is
 * stamped with this document's documentType (Goal card design §2.2), so a criterion reads "goes to
 * the forum" off NEVER_DELIVERED_DOCS by that documentType. */
function renderDocument(
  ctx: RenderContext,
  timings: PhaseTimings,
  documentType: string,
  fileName: string,
  render: () => string,
  label: WritingLabel = typeLabel(documentType, fileName)
): DocumentOutput {
  const from = ctx.inventory.length;
  const markdown = timed(timings, `render ${fileName}`, render);
  stampDoc(ctx.inventory, from, documentType);
  return { documentType, fileName, markdown, label };
}

/** The venue document(s) and the companions their type declares. A general Writing renders one
 * document from its stored layout (forms/render-general.ts), a bespoke one through the filler its
 * type file composes to (forms/filler-registry.ts), which needs the forum. */
function venueDocumentsForFiling(
  ctx: RenderContext,
  timings: PhaseTimings,
  general: StoredLayout | null,
  cited: CitedState[]
): { docs: DocumentOutput[]; companions: readonly unknown[] } {
  if (general !== null) {
    // The document's own name (spec 2026-10-22): the Writing's title on a stock type, else its type's title.
    const name = generalDocumentName(String(scalarValue(general.layout.title)), ctx.filing.title);
    const fileName = `${sanitizeForPath(name)}.md`;
    let unwritten: string[] = [];
    let currencyWithheld: CurrencyWithheld[] = [];
    let proseFormat: ProseFormatHit[] = [];
    const doc = renderDocument(
      ctx,
      timings,
      GENERAL_DOCUMENT_TYPE,
      fileName,
      () => {
        const rendered = renderGeneral(ctx, general, cited);
        unwritten = rendered.unwritten;
        currencyWithheld = rendered.currency_withheld;
        proseFormat = rendered.prose_format;
        return rendered.markdown;
      },
      { short: name, long: name }
    );
    return {
      docs: [{ ...doc, unwritten, currency_withheld: currencyWithheld, prose_format: proseFormat }],
      companions: (general.layout.companions as unknown[] | undefined) ?? [],
    };
  }
  const { filler, block } = composeFiller(requireForum(ctx.proceeding, true).forum, ctx.filing.kind);
  const docs = filler<DocumentOutput>(ctx, {
    document: (documentType, fileName, render, label) => renderDocument(ctx, timings, documentType, fileName, render, label),
    witnessStatements: () => {
      // One call renders every witness statement, so their entries share the one documentType.
      const from = ctx.inventory.length;
      const statements = timed(timings, "render Witness statements", () => renderWitnessStatements(ctx));
      stampDoc(ctx.inventory, from, "Witness_statement");
      return statements.map((ws) => ({
        documentType: "Witness_statement",
        fileName: `Witness Statement - ${sanitizeForPath(ws.witnessName)}.md`,
        markdown: ws.markdown,
        label: witnessStatementLabel(ws.witnessName),
      }));
    },
  });
  return { docs, companions: (block.companions as unknown[] | undefined) ?? [] };
}

/** #370/#380: Written Arguments renders as a true companion (document='written_argument') for
 * every type that declares `written-arguments` among its `companions` (shared/declared-layout.md
 * section 6); a type whose venue document is itself the written argument (VanIAC's submissions
 * package, the BCCA response book and factum) declares none. The reserve inventory is then
 * recorded for every filing, with no document. The Job
 * Board is no document of the filing's (#1365): the render builds its section from this render's
 * inventory, after these documents, and the filing's own Milestone page carries it. */
export function documentsForFiling(ctx: RenderContext, timings: PhaseTimings, general: StoredLayout | null, cited: CitedState[]): DocumentOutput[] {
  // ORDER IS LOAD-BEARING: recordReserveInventory reads ctx.paragraphLedger, which the venue
  // renderers and the Written Arguments companion fill as they number their own paragraphs. It
  // must stay after both, and the venue face must stay first (first-write-wins gives it
  // priority for a submission carried by both documents). Evaluation here is eager and strictly
  // ordered, so this holds -- but nothing else enforces it.
  const { docs, companions } = venueDocumentsForFiling(ctx, timings, general, cited);
  // The venue document alone carries the Writing's subject on the Milestone's Writings strip.
  docs[0] = { ...docs[0], label: withSubject(docs[0].label, ctx.filing.title) };
  if (companions.includes("written-arguments")) {
    docs.push(renderDocument(ctx, timings, "Written_arguments", "Written Arguments.md", () => renderWrittenArguments(ctx, "written_argument")));
  }
  const from = ctx.inventory.length;
  recordReserveInventory(ctx);
  stampDoc(ctx.inventory, from, RESERVE_INVENTORY_DOC);
  return docs;
}
