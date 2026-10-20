// The Raw Research page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview, the meta and data renderViewPageHtml takes. No real person, entity or matter, and
// no machine path (#140). Its authorities are invented, and it holds each class and a dead end.

import type { RawResearchData } from "../submission/forms/raw-research-page.js";
import type { ViewPageMeta } from "../submission/view-pages.js";

export const RAW_RESEARCH_FIXTURE: { meta: ViewPageMeta; data: RawResearchData } = {
  meta: { filing: "Opening Submissions Package", matter: "L4801", client: "Ashbourne", revision: 12, rendered: "2026-01-15 09:00" },
  data: {
    counts: { in_use: 2, undecided: 1, not_relevant: 1 },
    groups: [
      {
        heading: "Breach of contract",
        note: null,
        propositions: [
          {
            law_assertion_id: 1,
            text: "A party who refuses delivery without cause repudiates the contract.",
            dead_end: false,
            killed_on: null,
            class: "in_use",
            linked_to: ["Submission 1: The seller repudiated the agreement."],
            statements: [
              { statement_id: 11, class: "in_use", citation_title: "Sample Holdings Ltd. v. Example Traders Inc.", citation_rest: "2019 BCSC 0000 at para. 42", excerpt: "A refusal to deliver, without lawful excuse, is a repudiation.", status: ["Verified 2026-01-05", "Noted up 2026-01-06"] },
              { statement_id: 12, class: "undecided", citation_title: "Placeholder v. Specimen", citation_rest: "2021 BCCA 0000 at para. 17", excerpt: null, status: ["Not verified"] },
            ],
          },
        ],
      },
      {
        heading: "Damages",
        note: "Research paused until the expert report arrives.",
        propositions: [
          { law_assertion_id: 2, text: "Lost profits are recoverable when they were in the parties' contemplation.", dead_end: false, killed_on: null, class: "in_use", linked_to: [], statements: [{ statement_id: 21, class: "in_use", citation_title: "Model Industries v. Dummy Corp.", citation_rest: "2020 BCSC 0000 at para. 88", excerpt: null, status: ["Verified 2026-01-07"] }] },
          { law_assertion_id: 3, text: "Punitive damages follow any breach.", dead_end: true, killed_on: "2026-01-09", class: "not_relevant", linked_to: ["Submission 2 (killed 2026-01-09)"], statements: [] },
        ],
      },
    ],
  },
};
