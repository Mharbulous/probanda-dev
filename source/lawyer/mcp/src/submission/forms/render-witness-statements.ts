// The VanIAC Witness Statement documents, one per witness.

import { fetchFactAdmissionCoverage } from "./admission-annotations.js";
import { styleOfProceedingCaption, type CaptionParty } from "./components.js";
import { exhibitNumbersForFiling, fetchFilingDocuments } from "./exhibit-documents.js";
import { dedupeLineMarkers, doubtMarker, exhibitPinpointMarker, gapMarker, isAdmittedGuard, printMarkerSets, statementOfFactMarkers } from "./markers.js";
import { recordCriterionGlyphs, recordFactStatementGlyphs, recordGlyphs } from "./proposal-inventory.js";
import { captionHeadingFor, opposingPartyIds } from "./query.js";
import type { RenderContext } from "./render-context.js";
import { frontmatterFor } from "./vaniac-frontmatter.js";
import {
  fetchDocumentsReliedOn,
  fetchIncludedStatementsOfFactForWitness,
  fetchParagraphFacts,
  fetchStatementParagraphs,
  fetchWitnessStatements,
  type WitnessFactRow,
} from "./witness-statement-reads.js";

/** Fact-side ladder for a statement of fact not yet linked to any paragraph of its witness statement (work-markers.md 1a: 🗣️ talk to witness / ✍️ draft it -- never 🖋️/✒️, since "unlinked" means not yet written in this instrument; instrument_id: null makes that structural, not a convention to remember). 🧷 never rides here: the instrument is null by construction. 📌 does (Phase C, #777): an exhibit can be linked before the statement is drafted into the instrument, and §5 says 📌 still fires with no instrument. Build #329, decision #320. */
function unlinkedFactMarkers(f: WitnessFactRow, admitted: boolean): string {
  const courtRecordLinked = f.fact_court_record !== null;
  if (isAdmittedGuard(courtRecordLinked, admitted)) return doubtMarker(f.doubt);
  return dedupeLineMarkers([
    exhibitPinpointMarker(f.exhibit_id, f.exhibit_pinpoint),
    statementOfFactMarkers({
      interviewed: f.interviewed,
      instrument_id: null,
      instrument_kind: null,
      instrument_execution: null,
      fact_court_record_linked: courtRecordLinked,
      fact_admitted_by_all_opposing: admitted,
    }),
    doubtMarker(f.doubt),
  ]);
}

/** One Witness Statement document per filing_documents(role='witness_statement') row on this filing. Returns one markdown string per witness. */
export function renderWitnessStatements(ctx: RenderContext): { witnessName: string; markdown: string }[] {
  const statements = fetchWitnessStatements(ctx.dbPath, ctx.filing.id);
  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const opposing = opposingPartyIds(ctx.parties);
  const today = ctx.rendered.slice(0, 10);
  // Same exhibit numbering the Evidence Index uses (renderEvidenceIndex),
  // so "Documents relied on" cites the identical Ex. N for a shared document.
  // Same numbering the Evidence Index uses, so "Documents relied on" cites the identical Ex. N
  // for a shared document -- proceeding-wide for a VanIAC package since #712, so a statement may
  // rely on a document first exhibited in an earlier round and print the number it was given there.
  const exhibitMap = exhibitNumbersForFiling(ctx.dbPath, ctx.filing, fetchFilingDocuments(ctx.dbPath, ctx.filing.id).map((d) => d.document_id));

  return statements.map((s) => {
    const paragraphs = fetchStatementParagraphs(ctx.dbPath, s.id);
    const links = fetchParagraphFacts(
      ctx.dbPath,
      paragraphs.map((p) => p.id)
    );
    const factsByParagraph = new Map<number, number[]>();
    for (const link of links) {
      const list = factsByParagraph.get(link.statement_paragraph_id) ?? [];
      list.push(link.fact_id);
      factsByParagraph.set(link.statement_paragraph_id, list);
    }

    const witnessFacts = fetchIncludedStatementsOfFactForWitness(ctx.dbPath, s.witness_id);
    const linkedSofIds = new Set(links.map((l) => l.statement_of_fact_id));
    const unlinkedFacts = witnessFacts.filter((f) => !linkedSofIds.has(f.id));
    const admittedFactIds = fetchFactAdmissionCoverage(
      ctx.dbPath,
      unlinkedFacts.map((f) => f.fact_id),
      opposing,
      today
    );

    const lines: string[] = [];
    lines.push(
      frontmatterFor("Witness_statement", ctx.proceeding, ctx.filing, ctx.revision, ctx.rendered, ctx.clientName, ctx.clientNo, ctx.matterNo, ctx.matterDescription)
    );
    lines.push("");
    lines.push(
      styleOfProceedingCaption(captionParties, {
        heading: captionHeadingFor(ctx.filing, ctx.proceeding),
        registry: ctx.proceeding.registry,
        fileNumber: ctx.proceeding.file_number,
        titleLine: `WITNESS STATEMENT OF ${s.witness_name.toUpperCase()}`,
      })
    );
    lines.push("");
    lines.push(`I, ${s.witness_name}, state as follows:`);
    lines.push("");

    paragraphs.forEach((p, i) => {
      const factIds = factsByParagraph.get(p.id) ?? [];
      const tag =
        factIds.length > 0
          ? ` [facts ${factIds.map((id) => `F${id}`).join(", ")}]`
          : ` ${gapMarker("gap")} [GAP -- no fact linked]`;
      // Each 🧩 is an open item keyed on its own row (#1226).
      recordCriterionGlyphs(ctx.inventory, tag, ["🧩"], { table: "statement_paragraphs", id: p.id, item: `${s.witness_name}'s witness statement, paragraph ${i + 1}: linked fact` });
      lines.push(`${i + 1}. ${p.text}${tag} <!-- statement_paragraph ${i + 1} -->`);
    });
    if (witnessFacts.length === 0) {
      // Statement-level gap (work-markers.md 1a line 21, derived; build #329/#320): this witness has
      // no included statements_of_fact row at all -- nothing yet attributed, so nothing to sign either.
      const line = `${gapMarker("gap")} no facts attributed to this witness`;
      recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { table: "witnesses", id: s.witness_id, item: `${s.witness_name}'s witness statement: attributed facts` });
      lines.push(line);
    }
    lines.push("");

    // Rule 18(b)(v): identify with specificity any document relied on. Only
    // rendered when this statement's own paragraphs actually cite an
    // exhibit -- an empty list is silent, matching every other open slot.
    const reliedOn = fetchDocumentsReliedOn(ctx.dbPath, s.id);
    if (reliedOn.length > 0) {
      lines.push("**Documents relied on**");
      lines.push("");
      for (const d of reliedOn) {
        const exhibitNo = exhibitMap.get(d.id);
        const cite = exhibitNo !== undefined ? `Ex. ${exhibitNo}` : d.label;
        const dated = d.document_date ? `, dated ${d.document_date}` : "";
        lines.push(`- ${cite} — ${d.label}${dated} <!-- document_id ${d.id} -->`);
      }
      lines.push("");
    }

    // sign-it: documents.execution IS NULL AND >=1 paragraph linked (work-markers.md 1a line 34's
    // compound predicate; build #329/#320 -- an unsigned statement with nothing drafted shows the
    // gap above, not this).
    const swearMarker = s.execution === null && links.length > 0 ? "🖋️" : "";
    // Site 6: this instrument's own 🖋️, keyed on the witness statement document.
    recordGlyphs(ctx.inventory, swearMarker, ["🖋️"], { table: "documents", id: s.id, item: s.label, witness_id: s.witness_id });
    lines.push(`I make this statement believing its contents to be true. ${swearMarker}`.trim());
    lines.push("");
    // Rule 18(b)(iv): be signed by the witness, with the date and place of
    // signature. Rule 18(c): need not be sworn or affirmed -- a plain
    // signature line, never a jurat.
    lines.push("________________________________");
    lines.push(s.witness_name);
    lines.push("");
    lines.push(`Signed at: ${s.signed_at ?? "________________"}`);
    lines.push(`Date: ${s.execution ?? "________________"}`);

    if (unlinkedFacts.length > 0) {
      // Rendered for the human, withheld from the filed face -- same mechanism as Held in reserve
      // (build #329, decision #320(a)).
      lines.push("");
      lines.push("## Facts attributed to this witness, not yet in this statement");
      lines.push("");
      for (const f of unlinkedFacts) {
        const rung = unlinkedFactMarkers(f, admittedFactIds.has(f.fact_id));
        // Sites 7 / 7': 📌 keys on the statement, 🗣️/✍️ on the witness. "Unlinked" means no
        // instrument by construction, so no 🖋️/✒️ entry can arise here.
        recordFactStatementGlyphs(
          ctx.inventory,
          rung,
          { statement_id: f.id, witness_id: s.witness_id, witness_name: s.witness_name, instrument_id: null, instrument_label: null },
          f.postulate
        );
        const printed = printMarkerSets([rung]);
        lines.push(`- ${f.postulate}${printed ? ` ${printed}` : ""} <!-- statement_of_fact_id ${f.id} -->`);
      }
    }

    return { witnessName: s.witness_name, markdown: lines.join("\n").trimEnd() + "\n" };
  });
}
