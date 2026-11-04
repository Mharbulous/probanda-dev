// The filed render (build #359, design #358): its gates and the delivered filed face. Writes nothing to disk.

import { type FilingRow } from "./query.js";
import { CITATION_MISSING } from "./law-statement-line.js";
import { type CitedState } from "./layout-snapshot.js";
import { confirmationGate } from "./render-general.js";
import { currencyLabel } from "./projections.js";
import { ASSOCIATE_JUDGE_UNDETERMINED_LINE } from "./render-notice-of-application.js";
import { TEMPLATE_NOT_CHOSEN, UNRECOGNIZED_TEMPLATE_KEY } from "./render-requisition.js";
import { refuseUnplacedFacts } from "./unplaced-facts.js";
import { toFiledFace } from "./filed-face.js";
import { layoutFor } from "./render-context.js";
import { type DocumentOutput } from "./render-documents.js";
import { selectDocuments } from "./render-response.js";
import { type RenderResult } from "./render-result.js";
import { type PhaseTimings, withTotal } from "./timings.js";

/** Ticket 2026-08-31, decision 5: a filed-face document may never contain CITATION_MISSING. Scans
 * the pre-strip mockup markdown (toFiledFace runs after this, and would strip the very
 * <!-- statement_of_law_id N --> trace comment this needs to name the offending statement).
 * pushStatementLines (statement-lines.ts) always emits the citation line immediately
 * before the markers+id-comment line, so the trace is on the same line or the next. */
function findMissingLawCitations(markdown: string): number[] {
  const ids: number[] = [];
  const lines = markdown.split("\n");
  lines.forEach((line, i) => {
    if (!line.includes(CITATION_MISSING)) return;
    for (let j = i; j <= i + 1 && j < lines.length; j++) {
      const m = lines[j].match(/<!-- statement_of_law_id (\d+) -->/);
      if (m) {
        ids.push(Number(m[1]));
        break;
      }
    }
  });
  return ids;
}

/** #825: a deployed Form 8 order whose template_key is null or outside renderTemplate's closed
 * set renders a fallback that survives the filed face's glyph strip as a grammatical, signable
 * order that orders nothing. Scans the pre-strip mockup, like findMissingLawCitations above, so
 * the <!-- order_sought_id N --> trace is still there to name the offending order. */
function findUnrenderableOrders(markdown: string): number[] {
  const ids: number[] = [];
  for (const line of markdown.split("\n")) {
    // A crossed-out order's marker opens "<!-- order crossed-out", so the order_sought_id match below skips it.
    if (!line.includes(TEMPLATE_NOT_CHOSEN) && !line.includes(UNRECOGNIZED_TEMPLATE_KEY)) continue;
    const m = line.match(/<!-- order_sought_id (\d+) -->/);
    if (m) ids.push(Number(m[1]));
  }
  return ids;
}

/** The rest of a filed-mode drafting_forms__render, once `built` holds every document: each gate
 * refuses rather than deliver a document the forum would get wrong, then the filed faces. */
export function finishFiledRender({
  dbPath,
  filingId,
  revision,
  filing,
  built,
  cited,
  documentTypes,
  timings,
  started,
}: {
  dbPath: string;
  filingId: number;
  revision: number;
  filing: FilingRow;
  built: DocumentOutput[];
  cited: CitedState[];
  documentTypes?: string[];
  timings: PhaseTimings;
  started: number;
}): RenderResult {
  const deliverable = built; // every built document goes to the forum

  // Filing gate (ticket 2026-08-31, decision 5): refuse rather than deliver a document
  // containing CITATION_MISSING -- mirrors the bundle_outdated refusal shape below.
  const missing = deliverable
    .map((doc) => ({ doc, ids: findMissingLawCitations(doc.markdown) }))
    .filter((r) => r.ids.length > 0);
  if (missing.length > 0) {
    return {
      filing_id: filingId,
      revision,
      documents: [],
      citation_gate_failed: true,
      note:
        `Refusing to render the filed face: statement(s) of law with no authorities.citation would print "${CITATION_MISSING}". ` +
        missing.map((r) => `${r.doc.documentType}: statement_of_law id(s) ${r.ids.join(", ")}`).join("; ") +
        ". Add the missing citation(s), or remove those statements from this filing's deployed submissions, then call drafting_forms__render again.",
      timings: withTotal(timings, started),
    };
  }

  // #451: the mockup shows ⬜ in the jurisdiction sentence's place; the filed face never prints
  // either sentence for a value nobody confirmed.
  if (deliverable.some((doc) => doc.markdown.includes(ASSOCIATE_JUDGE_UNDETERMINED_LINE))) {
    return {
      filing_id: filingId,
      revision,
      documents: [],
      associate_judge_gate_failed: true,
      note:
        "Refusing to render the filed face: hearing_details.associate_judge is not yet determined, so neither Form 32 jurisdiction sentence can be printed. " +
        "Set it to 1 (within the jurisdiction of an associate judge) or 0 (not within), then call drafting_forms__render again.",
      timings: withTotal(timings, started),
    };
  }

  // #825: the mockup shows the ⬜/🏷️ fallback where the operative provision belongs; the filed
  // face never delivers a signable order that orders nothing. Same shape as the two gates above.
  const unrenderable = deliverable
    .map((doc) => ({ doc, ids: findUnrenderableOrders(doc.markdown) }))
    .filter((r) => r.ids.length > 0);
  if (unrenderable.length > 0) {
    return {
      filing_id: filingId,
      revision,
      documents: [],
      template_key_gate_failed: true,
      note:
        "Refusing to render the filed face: deployed order(s) with no usable order_sought.template_key would print an operative sentence that orders nothing. " +
        unrenderable.map((r) => `${r.doc.documentType}: order_sought id(s) ${r.ids.join(", ")}`).join("; ") +
        ". Set each template_key to one of renderTemplate's eight values, or remove those orders from this filing's deployed orders, then call drafting_forms__render again.",
      timings: withTotal(timings, started),
    };
  }

  // Spec §6 piece 5: a general Writing's filed face waits on the confirmation of every item its
  // stored layout cites, at this firm. A passage that moved since the snapshot is reported either way.
  const gate = confirmationGate(cited);
  const changed = gate.changed_since_snapshot.length > 0 ? { changed_since_snapshot: gate.changed_since_snapshot } : {};
  if (gate.unconfirmed.length > 0) {
    return {
      filing_id: filingId,
      revision,
      documents: [],
      confirmation_gate_failed: true,
      unconfirmed: gate.unconfirmed,
      ...changed,
      note:
        `Refusing to render the filed face: the stored layout cites item(s) no roster lawyer has confirmed: ${gate.unconfirmed.join(", ")}. ` +
        "The mockup tags each one [unverified: ...]; confirm each through /localize at mockup review, then call drafting_forms__render again." +
        (gate.changed_since_snapshot.length > 0
          ? ` Changed since the snapshot: ${gate.changed_since_snapshot.map((c) => c.rule_ref).join(", ")}; re-snapshot the Writing, then confirm.`
          : ""),
      timings: withTotal(timings, started),
    };
  }

  // A general Writing's part with no content prints a mockup-only line the filed face drops,
  // which would deliver its heading with nothing under it; the filed render refuses instead.
  const unwritten = deliverable.flatMap((doc) => doc.unwritten ?? []);
  if (unwritten.length > 0) {
    return {
      filing_id: filingId,
      revision,
      documents: [],
      unwritten_gate_failed: true,
      unwritten,
      ...changed,
      note:
        `Refusing to render the filed face: part(s) of the stored layout have no content: ${unwritten.join(", ")}. ` +
        "The mockup shows each as a 🧩 line; write each slot's filing_prose row, or add the rows each projection reads, then call drafting_forms__render again.",
      timings: withTotal(timings, started),
    };
  }

  // Plan 2026-10-07 step 5: a general Writing's prose holds only printed wording. The mockup flags
  // a line holding anything else; the filed face would deliver it, so the filed render refuses.
  const proseFormat = deliverable.flatMap((doc) => doc.prose_format ?? []);
  if (proseFormat.length > 0) {
    return {
      filing_id: filingId,
      revision,
      documents: [],
      prose_format_gate_failed: true,
      prose_format: proseFormat,
      ...changed,
      note:
        "Refusing to render the filed face: prose line(s) hold text that is not printed wording: " +
        proseFormat.map((h) => `${h.slot} (${h.rules.join(", ")}): "${h.line}"`).join("; ") +
        ". The mockup flags each with `🧩 <!-- format: ... -->`; rewrite each line as printed wording, a blank as ________, then call drafting_forms__render again.",
      timings: withTotal(timings, started),
    };
  }

  // #1181: the mockup tags an implied clause naming an enactment whose stored statute-currency
  // result is not `current`; the filed face never prints that line, so the filed render refuses.
  // A sent Writing's filed face is what was sent, whose clauses no longer change (#1227): it
  // renders, and the mockup keeps the tag.
  const currencyWithheld = deliverable.flatMap((doc) => doc.currency_withheld ?? []);
  if (currencyWithheld.length > 0 && !filing.filed_on) {
    return {
      filing_id: filingId,
      revision,
      documents: [],
      currency_gate_failed: true,
      currency_withheld: currencyWithheld,
      ...changed,
      note:
        "Refusing to render the filed face: implied clause(s) name an enactment whose statute-currency result is not `current`: " +
        currencyWithheld.map((w) => `clause_id ${w.clause_id} (${currencyLabel(w)})`).join(", ") +
        ". Reword each clause without the enactment, or record `current` results for the enactment and its cited provision, relayed by /legal-research, through /drafting-data, then call drafting_forms__render again.",
      timings: withTotal(timings, started),
    };
  }

  // Schema v59: the mockup names a submission's fact missing from the facts Part NOT PLACED in a
  // comment, which toFiledFace strips, so a drafting Writing's filed face refuses instead.
  refuseUnplacedFacts(dbPath, filing, "drafting_forms__render");

  const documents = deliverable.map((doc) => ({
    document_type: doc.documentType,
    file_name: doc.fileName,
    markdown: toFiledFace(doc.markdown),
  }));
  // Spec §6 piece 6: publish-general receives the filed text and the stored layout in one response.
  const layout = layoutFor(filing);
  return { filing_id: filingId, revision, documents: selectDocuments(documents, documentTypes), ...changed, ...(layout ? { stored_layout: layout } : {}), timings: withTotal(timings, started) };
}
