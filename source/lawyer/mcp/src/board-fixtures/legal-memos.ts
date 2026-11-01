// The Legal Memos page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview, the meta and data renderViewPageHtml takes. No real person, entity or matter, and
// no machine path (#140). It holds each status and source, and a memo with earlier versions.

import type { LegalMemosData } from "../submission/forms/legal-memos-page.js";
import type { ViewPageMeta } from "../submission/view-pages.js";

export const LEGAL_MEMOS_FIXTURE: { meta: ViewPageMeta; data: LegalMemosData } = {
  meta: { filing: "Opening Submissions Package", matter: "L4801", client: "Ashbourne", revision: 12, rendered: "2026-01-15 09:00" },
  data: {
    memos: [
      {
        title: "ML re repudiation by refusal to deliver",
        folder: "Breach of contract",
        source: "research_memo",
        status: "in_progress",
        issues: ["Does a refusal to accept delivery, without lawful excuse, repudiate a contract of sale?"],
        facts: ["The buyer refused the second delivery."],
        jobs: [{ id: 14, title: "Research repudiation" }],
        date: "2026-01-14",
        version: 3,
        earlier: [1, 2],
        file: "6. LAW\\Breach of contract\\2026-01-14 ML re repudiation by refusal to deliver v3.md",
        url: "file:///placeholder/6.%20LAW/Breach%20of%20contract/2026-01-14%20ML%20re%20repudiation%20by%20refusal%20to%20deliver%20v3.md",
        on_disk: true,
      },
      {
        title: "research-lawyer answer",
        folder: "Costs",
        source: "research_memo",
        status: "started",
        issues: ["When may costs be awarded against a non-party?"],
        facts: [],
        jobs: [{ id: 9, title: "Research non-party costs" }],
        date: "2026-01-10",
        version: 1,
        earlier: [],
        file: "6. LAW\\Costs\\2026-01-10 research-lawyer answer.md",
        url: "file:///placeholder/6.%20LAW/Costs/2026-01-10%20research-lawyer%20answer.md",
        on_disk: true,
      },
      {
        title: "Westlaw set-off against a promissory note",
        folder: "Set off",
        source: "westlaw",
        status: "completed",
        issues: ["Can equitable set-off be raised against a claim on a promissory note?"],
        facts: ["The note was signed on closing.", "The seller withheld the final instalment."],
        jobs: [{ id: 6, title: "Research set-off" }],
        date: "2026-01-08",
        version: 1,
        earlier: [],
        file: "6. LAW\\Set off\\2026-01-08 Westlaw set-off against a promissory note.docx",
        url: "file:///placeholder/6.%20LAW/Set%20off/2026-01-08%20Westlaw%20set-off%20against%20a%20promissory%20note.docx",
        on_disk: true,
      },
      {
        title: "note-up Sample Holdings Ltd. v. Example Traders Inc., 2019 BCSC 0000",
        folder: "",
        source: "note_up",
        status: "no_job",
        issues: [],
        facts: [],
        jobs: [],
        date: "2026-01-05",
        version: 2,
        earlier: [1],
        file: "6. LAW\\2026-01-05 note-up Sample Holdings Ltd. v. Example Traders Inc., 2019 BCSC 0000 v2.md",
        url: "file:///placeholder/6.%20LAW/2026-01-05%20note-up%20Sample%20Holdings%20Ltd.%20v.%20Example%20Traders%20Inc.,%202019%20BCSC%200000%20v2.md",
        on_disk: true,
      },
    ],
  },
};
