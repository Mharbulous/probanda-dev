// The Procedural History page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview, the meta and data renderViewPageHtml takes. No real person, entity or matter, and
// no machine path (#140). It holds dated procedural steps in date order, a court-record basis and each
// link state.

import type { FactsPageData } from "../submission/forms/facts-pages.js";
import type { ViewPageMeta } from "../submission/view-pages.js";

export const PROCEDURAL_HISTORY_FIXTURE: { meta: ViewPageMeta; data: FactsPageData } = {
  meta: { filing: "Opening Submissions Package", matter: "L4801", client: "Ashbourne", revision: 12, rendered: "2026-01-15 09:00" },
  data: {
    order: "date",
    evidence: "read",
    facts: [
      {
        position: 1,
        date: "2025-06-02",
        text: "The buyer filed the notice of civil claim.",
        class: "provable",
        basis: "On the court record: Notice of Civil Claim",
        links: [],
      },
      {
        position: 2,
        date: "2025-06-09",
        text: "The notice of civil claim was served on the seller by personal service.",
        class: "provable",
        basis: null,
        links: [{ witness: "D. Server", cite: "Affidavit #1 of D. Server, para. 2, Exhibit A", state: "in_hand", concern: null, decided_on: null, decision: null }],
      },
      {
        position: 3,
        date: "2025-08-15",
        text: "The buyer's counsel wrote to the seller's counsel proposing dates for document production.",
        class: "pending",
        basis: null,
        links: [{ witness: "A. Sample", cite: null, state: "pending", concern: null, decided_on: null, decision: null }],
      },
    ],
  },
};
