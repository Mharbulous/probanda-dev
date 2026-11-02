// The Legal Research page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview, the meta and data renderViewPageHtml takes. No real person, entity or matter, and
// no machine path (#140). It holds each proposition class, each brief status, each note-up status, each memo
// status and source, a statute checked and one never checked, and a memo with earlier versions.

import type { LegalResearchData } from "../submission/forms/legal-research-page.js";
import type { ViewPageMeta } from "../submission/view-pages.js";

export const LEGAL_RESEARCH_FIXTURE: { meta: ViewPageMeta; data: LegalResearchData } = {
  meta: { filing: "Opening Submissions Package", matter: "L4801", client: "Ashbourne", revision: 12, rendered: "2026-01-15 09:00" },
  data: {
    propositions: {
      counts: { in_use: 1, undecided: 1, not_relevant: 1 },
      groups: [
        {
          heading: "The refusal repudiated the contract",
          note: "Submission on this Writing",
          propositions: [
            {
              law_assertion_id: 1,
              text: "A refusal to accept delivery, without lawful excuse, repudiates a contract of sale.",
              dead_end: false,
              killed_on: null,
              class: "in_use",
              linked_to: ["The refusal repudiated the contract"],
              statements: [
                {
                  statement_id: 1,
                  class: "in_use",
                  citation_title: "Sample Holdings Ltd. v. Example Traders Inc.",
                  citation_rest: ", 2019 BCSC 0000, para 12.",
                  excerpt: "A refusal of this kind goes to the root of the contract.",
                  status: ["Verification: verified 2026-01-10", "Note-up: good law"],
                  note_up: { label: "Case noted up: negative treatment only", noted: true },
                },
                {
                  statement_id: 2,
                  class: "in_use",
                  citation_title: "Sale of Goods Act",
                  citation_rest: ", RSBC 0000, c 0, s 15.",
                  excerpt: null,
                  status: ["Verification: verified 2026-01-10", "Currency: current"],
                  note_up: { label: "Statute level: in-force check done", noted: true },
                },
              ],
            },
          ],
        },
        {
          heading: "Not linked",
          note: null,
          propositions: [
            { law_assertion_id: 2, text: "Set-off may be raised against a promissory note in narrow cases.", dead_end: false, killed_on: null, class: "undecided", linked_to: [], statements: [] },
            { law_assertion_id: 3, text: "A buyer need not mitigate after repudiation.", dead_end: false, killed_on: "2026-01-12", class: "not_relevant", linked_to: [], statements: [] },
          ],
        },
      ],
    },
    statutes: {
      statutes: [
        {
          title: "Sale of Goods Act",
          citation: "RSBC 0000, c 0",
          relied_on: true,
          currency_status: "current",
          currency_checked_on: "2026-01-10",
          note_up: { label: "Not noted up", noted: false },
          provisions: [{ provision: "s 15", currency_status: "current", checked_on: "2026-01-10" }, { provision: "s 16", currency_status: null, checked_on: null }],
        },
        { title: "Limitation Act", citation: "SBC 0000, c 0", relied_on: false, currency_status: null, currency_checked_on: null, note_up: { label: "Not noted up", noted: false }, provisions: [] },
      ],
    },
    briefs: {
      cases: [
        {
          title: "Sample Holdings Ltd. v. Example Traders Inc.",
          citation: "2019 BCSC 0000",
          status: "briefed",
          relied_on: true,
          jobs: [],
          note_up: { label: "Noted up: negative treatment only", noted: true },
          results: ["good law"],
          brief: {
            date: "2026-01-11",
            version: 2,
            earlier: [1],
            earlier_files: [
              {
                version: 1,
                date: "2026-01-11",
                file: "6. LAW\\Breach of contract\\2026-01-11 case brief Sample Holdings Ltd. v. Example Traders Inc., 2019 BCSC 0000.md",
                url: "file:///placeholder/6.%20LAW/Breach%20of%20contract/2026-01-11%20case%20brief.md",
                on_disk: true,
              },
            ],
            file: "6. LAW\\Breach of contract\\2026-01-11 case brief Sample Holdings Ltd. v. Example Traders Inc., 2019 BCSC 0000 v2.md",
            url: "file:///placeholder/6.%20LAW/Breach%20of%20contract/2026-01-11%20case%20brief%20v2.md",
            on_disk: true,
          },
        },
        { title: "Placeholder Co. v. Specimen Ltd.", citation: "2021 BCCA 0000", status: "requested", relied_on: true, jobs: [{ id: 21, title: "Brief the case: Placeholder Co. v. Specimen Ltd., 2021 BCCA 0000" }], brief: null, note_up: { label: "Not noted up", noted: false }, results: [] },
        { title: "Model Ltd. v. Dummy Corp.", citation: "2020 BCSC 0000", status: "not_briefed", relied_on: true, jobs: [], brief: null, note_up: { label: "Not noted up", noted: false }, results: [] },
        {
          title: "Instance v. Pattern",
          citation: "2018 BCCA 0000",
          status: "briefed",
          relied_on: false,
          jobs: [],
          note_up: { label: "Noted up: negative treatment only", noted: true },
          results: ["distinguishable"],
          brief: { date: "2026-01-06", version: 1, earlier: [], earlier_files: [], file: "6. LAW\\Costs\\2026-01-06 case brief Instance v. Pattern, 2018 BCCA 0000.md", url: "file:///placeholder/6.%20LAW/Costs/2026-01-06%20case%20brief.md", on_disk: true },
        },
      ],
    },
    memos: { memos: [
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
    ] },
  },
};
