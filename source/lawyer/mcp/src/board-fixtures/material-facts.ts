// The Provable Facts page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview, the meta and data renderViewPageHtml takes. No real person, entity or matter, and
// no machine path (#140). It holds one fact of each class, a court-record basis and each link state.

import type { ProvableFactsData } from "../submission/forms/provable-facts-page.js";
import type { ViewPageMeta } from "../submission/view-pages.js";

export const PROVABLE_FACTS_FIXTURE: { meta: ViewPageMeta; data: ProvableFactsData } = {
  meta: { filing: "Opening Submissions Package", matter: "L4801", client: "Ashbourne", revision: 12, rendered: "2026-01-15 09:00" },
  data: {
    evidence: "read",
    facts: [
      {
        position: 1,
        text: "The parties signed the purchase agreement on 3 March 2025.",
        class: "provable",
        basis: "Pleadings, para. 4 (admitted)",
        links: [{ witness: "A. Sample", cite: "Affidavit #1 of A. Sample, para. 6, Exhibit A", state: null, concern: null, decided_on: null, decision: null }],
      },
      {
        position: 2,
        text: "The buyer paid the deposit of $10,000 on 10 March 2025.",
        class: "provable",
        basis: null,
        links: [{ witness: "B. Example", cite: "Affidavit #1 of B. Example, para. 3", state: "in_hand", concern: null, decided_on: null, decision: null }],
      },
      {
        position: 3,
        text: "The seller refused delivery on 1 May 2025.",
        class: "pending",
        basis: null,
        links: [{ witness: "C. Placeholder", cite: null, state: "pending", concern: "No sworn statement yet", decided_on: null, decision: null }],
      },
      {
        position: 4,
        text: "The seller's manager said the goods were never ordered.",
        class: "inadmissible",
        basis: null,
        links: [{ witness: "B. Example", cite: "Affidavit #1 of B. Example, para. 9", state: "inadmissible", concern: "Hearsay", decided_on: "2026-01-10", decision: "Struck as hearsay; rely on the order log instead." }],
      },
    ],
  },
};
