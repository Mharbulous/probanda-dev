// VanIAC submissions package renderer (build ticket #297, design doc 291 §5,
// issue #299 ratified layout, issue #288 §1 form content inventory). The
// Submissions body was restructured onto the v3/v4 schema by issue #321
// (target shape per issues #323's contention/postulate/proposition square
// and a Fable-reviewed amendment, 2026-08-23): one line per postulate/
// proposition, its own statement's verbatim excerpt as a fenced code block
// (not the ticket's literal block quote -- copy-paste fidelity and a real
// CommonMark list-fracture issue in an unindented quote). Renders: Written
// Argument, one Witness Statement per witness, Evidence Index. The
// submission-body helpers here (renderSubmissionBody and friends) are also
// used by render-notice-of-application.ts's PART 3, per #321's "same shape"
// instruction.
//
// The code lives in forms/, one module per concern; this file re-exports its public surface.

// Defined in law-statement-line.ts, which this module imports, so the two never import each
// other; re-exported here so every existing importer keeps its path.
export { CITATION_MISSING } from "./law-statement-line.js";
export type { DeployedIds, FactStatementRow, LawAssertionRow, PointerDocument, SubmissionFactRow, SubmissionRow } from "./submission-reads.js";
export { fetchDeployedIds, fetchFactStatements, fetchSubmissionFacts, fetchSubmissionLaw, fetchSubmissions } from "./submission-reads.js";
export type { FilingDocumentRow } from "./exhibit-documents.js";
export { exhibitNumbersForFiling, exhibitNumbersFromOrderedIds, fetchDocumentLabels, fetchFilingDocuments, fetchNotBestCopyMarkers, fetchProceedingExhibitNumbers } from "./exhibit-documents.js";
export type { ReviewState } from "./review-state.js";
export { fetchReviewState, orderReviewMarkerFor, reviewMarkerFor } from "./review-state.js";
export { factStatementCitationLine, pushStatementLines } from "./statement-lines.js";
export type { SubmissionFactGroup, SubmissionLawGroup } from "./submission-groups.js";
export { groupSubmissionFacts, groupSubmissionLaw } from "./submission-groups.js";
export type { RenderedParagraphs } from "./submission-paragraphs.js";
export { recordParagraph, renderSubmissionParagraphs } from "./submission-paragraphs.js";
export type { OrderSoughtRow } from "./orders-sought.js";
export { fetchJurisdictionEdges, fetchOrdersSought } from "./orders-sought.js";
export type { OpposingPointRow } from "./opposing-points.js";
export { fetchOpposingPoints } from "./opposing-points.js";
export type { LedgerEntry, RenderContext } from "./render-context.js";
export { renderWitnessStatements } from "./render-witness-statements.js";
export type { AdmissionStateRow, FactAdmissionAnnotations } from "./admission-annotations.js";
export { fetchFactAdmissionAnnotations, fetchFactAdmissionCoverage } from "./admission-annotations.js";
export type { DocumentTenderStatus } from "./document-tenders.js";
export { fetchDocumentTenderStatus } from "./document-tenders.js";
export { renderEvidenceIndex } from "./render-evidence-index.js";
