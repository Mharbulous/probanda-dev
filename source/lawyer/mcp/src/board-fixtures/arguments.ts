// The Arguments page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview, the meta and data renderViewPageHtml takes. No real person, entity or matter, and
// no machine path (#140). It holds a submission, a rebuttal, a reserve and both counter-argument kinds.

import type { ArgumentsData } from "../submission/forms/arguments-page.js";
import type { ViewPageMeta } from "../submission/view-pages.js";

export const ARGUMENTS_FIXTURE: { meta: ViewPageMeta; data: ArgumentsData } = {
  meta: { filing: "Opening Submissions Package", matter: "L4801", client: "Ashbourne", revision: 12, rendered: "2026-01-15 09:00" },
  data: {
    submissions: [
      {
        id: 1,
        kind: "submission",
        contention: "The seller repudiated the agreement by refusing delivery.",
        where: "On this Writing",
        facts: ["The parties signed the purchase agreement on 3 March 2025.", "The seller refused delivery on 1 May 2025."],
        law: [{ text: "A party who refuses delivery without cause repudiates the contract.", killed_on: null }],
        rebuts: ["raised:1"],
      },
      {
        id: 2,
        kind: "rebuttal",
        contention: "The goods were ordered: the order log records the order.",
        where: "On Notice of Application for Document Production",
        facts: ["The buyer paid the deposit of $10,000 on 10 March 2025."],
        law: [{ text: "Punitive damages follow any breach.", killed_on: "2026-01-09" }],
        rebuts: ["raised:1", "anticipated:1"],
      },
      { id: 3, kind: "submission", contention: "In the alternative, the buyer is owed restitution of the deposit.", where: "Held in reserve", facts: [], law: [], rebuts: [] },
    ],
    counter_arguments: [
      { key: "raised:1", kind: "raised", text: "The goods were never ordered.", source: "Application Response, Part 3, para. 2", linked: [1, 2] },
      { key: "anticipated:1", kind: "anticipated", text: "The buyer waived delivery by silence.", source: null, linked: [2] },
    ],
  },
};
