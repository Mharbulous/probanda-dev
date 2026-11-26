// The Arguments page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview, the meta and data renderViewPageHtml takes. No real person, entity or matter, and
// no machine path (#140). It holds our arguments, a reserve, a raised and an anticipated opposing argument, and a rebuttal.

import type { ArgumentsData } from "../submission/forms/arguments-page.js";
import type { ViewPageMeta } from "../submission/view-pages.js";

export const ARGUMENTS_FIXTURE: { meta: ViewPageMeta; data: ArgumentsData } = {
  meta: { filing: "Opening Submissions Package", matter: "L4801", client: "Ashbourne", revision: 12, rendered: "2026-01-15 09:00" },
  data: {
    arguments: [
      {
        id: 1,
        label: "#1",
        number: 1,
        side: "ours",
        contention: "The seller repudiated the agreement by refusing delivery.",
        where: "On this Writing",
        tags: [],
        killed: false,
        facts: ["The parties signed the purchase agreement on 3 March 2025.", "The seller refused delivery on 1 May 2025."],
        law: [{ text: "A party who refuses delivery without cause repudiates the contract.", killed_on: null }],
        rebuts: [],
        rebutted_by: [],
      },
      {
        id: 4,
        label: "#2",
        number: 2,
        side: "opposing",
        contention: "The goods were never ordered.",
        where: "Application Response, Part 3, para. 2",
        tags: [],
        killed: false,
        facts: [],
        law: [],
        rebuts: [],
        rebutted_by: ["#2"],
      },
      {
        id: 5,
        label: "#3",
        number: 3,
        side: "opposing",
        contention: "The buyer waived delivery by silence.",
        where: null,
        tags: ["Anticipated"],
        killed: false,
        facts: [],
        law: [],
        rebuts: [],
        rebutted_by: [],
      },
      {
        id: 3,
        label: "#4",
        number: 4,
        side: "ours",
        contention: "In the alternative, the buyer is owed restitution of the deposit.",
        where: null,
        tags: ["Held in reserve"],
        killed: false,
        facts: [],
        law: [],
        rebuts: [],
        rebutted_by: [],
      },
    ],
    rebuttals: [
      {
        id: 2,
        label: "#2",
        number: 2,
        side: "ours",
        contention: "The goods were ordered: the order log records the order.",
        where: "On Notice of Application for Document Production",
        tags: [],
        killed: false,
        facts: ["The buyer paid the deposit of $10,000 on 10 March 2025."],
        law: [{ text: "Punitive damages follow any breach.", killed_on: "2026-01-09" }],
        rebuts: ["#2"],
        rebutted_by: [],
      },
    ],
  },
};
